from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTasks
from sqlalchemy import delete, func, select

from app.database import engine, AsyncSessionLocal
from app.models import AuthSession, MeasurementCategory, PasswordResetToken, User, UserRole
from app.measurement_catalog import default_category_rows
from app.config import settings
from app.auth import hash_password
from app.email_service import deliver_pending_notification_emails
from app.production_startup import apply_pending_migrations
from app import (
    addresses,
    admin,
    auth,
    deliveries,
    designs,
    measurements,
    media,
    notifications,
    orders,
    payments,
    products,
    vendors,
    vendor_customers,
    vendor_designs,
)


async def init_db_and_seed_admin():
    async with AsyncSessionLocal() as db:
        await db.execute(
            delete(AuthSession).where(
                AuthSession.expires_at <= datetime.now(timezone.utc)
            )
        )
        await db.execute(
            delete(PasswordResetToken).where(
                PasswordResetToken.expires_at
                <= datetime.now(timezone.utc) - timedelta(days=1)
            )
        )
        await db.commit()
        category_count = await db.scalar(select(func.count(MeasurementCategory.id)))
        if not category_count:
            db.add_all([MeasurementCategory(**row) for row in default_category_rows()])
            await db.commit()

        admin = None
        if settings.ADMIN_EMAIL:
            result = await db.execute(
                select(User).where(
                    func.lower(User.email) == str(settings.ADMIN_EMAIL).lower()
                )
            )
            admin = result.scalar_one_or_none()

        if settings.ADMIN_EMAIL and settings.ADMIN_PASSWORD and not admin:
            admin_user = User(
                full_name=settings.ADMIN_NAME,
                email=settings.ADMIN_EMAIL,
                hashed_password=hash_password(settings.ADMIN_PASSWORD),
                role=UserRole.SUPER_ADMIN.value,
            )
            db.add(admin_user)
            await db.commit()
            print(f"Admin user initialized: {settings.ADMIN_EMAIL}")
        elif admin and (
            admin.role != UserRole.SUPER_ADMIN.value or not admin.is_active
        ):
            admin.role = UserRole.SUPER_ADMIN.value
            admin.is_active = True
            await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Cloud Run can retain a service-level command override that bypasses the
    # image's Docker CMD. Keep the same guarded migration gate in application
    # lifespan so even a direct `python -m uvicorn ...` launch is safe.
    await apply_pending_migrations()
    await init_db_and_seed_admin()
    yield
    await engine.dispose()


app = FastAPI(title=settings.PROJECT_NAME, lifespan=lifespan)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(self), payment=(self)",
    )
    if not settings.is_development:
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains",
        )
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self' https://checkout.razorpay.com https://*.razorpay.com; "
            "img-src 'self' blob: data: https://*.razorpay.com; "
            "style-src 'self' 'unsafe-inline'; font-src 'self'; "
            "connect-src 'self' https://api.razorpay.com https://*.razorpay.com; "
            "frame-src https://api.razorpay.com https://*.razorpay.com; "
            "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; "
            "form-action 'self' https://api.razorpay.com",
        )
    if (
        request.method in {"POST", "PUT", "PATCH", "DELETE"}
        and response.status_code < 400
        and settings.EMAIL_NOTIFICATIONS_ENABLED
    ):
        # Starlette runs these after the response is sent but before the ASGI
        # request finishes, which works with Cloud Run's request-based CPU.
        tasks = BackgroundTasks()
        if response.background is not None:
            tasks.tasks.append(response.background)
        tasks.add_task(deliver_pending_notification_emails)
        response.background = tasks
    return response

app.include_router(auth.router)
app.include_router(designs.router)
app.include_router(measurements.router)
app.include_router(measurements.admin_router)
app.include_router(addresses.router)
app.include_router(orders.router)
app.include_router(orders.admin_router)
app.include_router(payments.router)
app.include_router(products.catalog_router)
app.include_router(products.vendor_router)
app.include_router(products.admin_router)
app.include_router(products.orders_router)
app.include_router(products.admin_orders_router)
app.include_router(deliveries.router)
app.include_router(deliveries.admin_router)
app.include_router(deliveries.agent_router)
app.include_router(vendor_designs.router)
app.include_router(vendors.router)
app.include_router(vendor_customers.router)
app.include_router(vendor_customers.customer_router)
app.include_router(admin.router)
app.include_router(notifications.router)
app.include_router(media.router)


@app.get("/api/public/config", include_in_schema=False)
async def public_app_config():
    """Return the small allowlist of non-secret settings used before sign-in."""
    return {
        "vendor_contact_email": str(settings.VENDOR_CONTACT_EMAIL),
        "support_email": str(settings.VENDOR_CONTACT_EMAIL),
        "business_legal_name": settings.BUSINESS_LEGAL_NAME,
        "business_address": settings.BUSINESS_ADDRESS,
        "support_phone": settings.SUPPORT_PHONE,
    }


@app.get("/sitemap.xml", include_in_schema=False)
async def sitemap_xml():
    """Serve the sitemap before the SPA fallback can handle this path."""
    canonical_root = settings.PUBLIC_APP_URL.rstrip("/")
    public_paths = ("/", "/contact", "/pricing", "/shipping", "/cancellation-refunds", "/privacy", "/terms")
    urls = "".join(
        "  <url>\n"
        f"    <loc>{canonical_root}{path}</loc>\n"
        "  </url>\n"
        for path in public_paths
    )
    content = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{urls}"
        "</urlset>\n"
    )
    return Response(
        content=content,
        media_type="application/xml",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@app.get("/robots.txt", include_in_schema=False)
async def robots_txt():
    """Advertise the sitemap while keeping private application paths unlisted."""
    canonical_root = settings.PUBLIC_APP_URL.rstrip("/")
    content = "\n".join([
        "User-agent: *",
        "Allow: /",
        "Disallow: /api/",
        "Disallow: /admin",
        "Disallow: /cart",
        "Disallow: /forgot-password",
        "Disallow: /login",
        "Disallow: /orders",
        "Disallow: /profile",
        "Disallow: /register",
        "Disallow: /reset-password",
        "Disallow: /shop",
        "Disallow: /vendor",
        "Disallow: /vendors",
        "",
        f"Sitemap: {canonical_root}/sitemap.xml",
        "",
    ])
    return Response(
        content=content,
        media_type="text/plain",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@app.get("/health")
async def health_check():
    return {"status": "ok"}


# In production, Vite's compiled files are served by FastAPI so Cloud Run only
# needs one ingress container and one PORT. Development keeps using Vite's HMR
# server on port 5173.
frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if settings.SERVE_FRONTEND and frontend_dist.is_dir():
    frontend_assets = frontend_dist / "assets"
    if frontend_assets.is_dir():
        app.mount(
            "/assets",
            StaticFiles(directory=frontend_assets),
            name="frontend-assets",
        )

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API route not found")

        requested_file = (frontend_dist / full_path).resolve()
        if (
            requested_file.is_relative_to(frontend_dist.resolve())
            and requested_file.is_file()
        ):
            return FileResponse(requested_file)
        return FileResponse(frontend_dist / "index.html")
