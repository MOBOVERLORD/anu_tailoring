from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTasks
from sqlalchemy import delete, func, select
from sqlalchemy import text

from app.database import engine, Base, AsyncSessionLocal
from app.models import AuthSession, MeasurementCategory, PasswordResetToken, User, UserRole
from app.measurement_catalog import default_category_rows
from app.config import settings
from app.auth import hash_password
from app.email_service import deliver_pending_notification_emails
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
    products,
    vendors,
    vendor_designs,
)


async def init_db_and_seed_admin():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # The project does not use Alembic yet. Keep existing development
        # databases compatible while the initial schema is still evolving.
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS location VARCHAR(150)"
        ))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20)"
        ))
        await conn.execute(text(
            "UPDATE users SET role = 'customer' WHERE role IS NULL"
        ))
        await conn.execute(text(
            "ALTER TABLE users ALTER COLUMN role SET DEFAULT 'customer'"
        ))
        await conn.execute(text(
            "ALTER TABLE users ALTER COLUMN role SET NOT NULL"
        ))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN"
        ))
        await conn.execute(text(
            "UPDATE users SET is_active = TRUE WHERE is_active IS NULL"
        ))
        await conn.execute(text(
            "ALTER TABLE users ALTER COLUMN is_active SET DEFAULT TRUE"
        ))
        await conn.execute(text(
            "ALTER TABLE users ALTER COLUMN is_active SET NOT NULL"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_users_is_active ON users (is_active)"
        ))
        await conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower "
            "ON users (LOWER(email))"
        ))
        await conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone_not_null "
            "ON users (phone) WHERE phone IS NOT NULL"
        ))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_pickup_address VARCHAR(500)"
        ))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_pickup_place_id VARCHAR(255)"
        ))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_pickup_latitude DOUBLE PRECISION"
        ))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_pickup_longitude DOUBLE PRECISION"
        ))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_pickup_geocoded_at TIMESTAMPTZ"
        ))
        for statement in (
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_bucket_name VARCHAR(255)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_object_name VARCHAR(1024)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_content_type VARCHAR(100)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_original_filename VARCHAR(255)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_size_bytes INTEGER",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS shop_name VARCHAR(150)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS shop_description TEXT",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_logo_bucket_name VARCHAR(255)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_logo_object_name VARCHAR(1024)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_logo_content_type VARCHAR(100)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_logo_original_filename VARCHAR(255)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_logo_size_bytes INTEGER",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_request_status VARCHAR(20)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_request_shop_name VARCHAR(150)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_request_message TEXT",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_request_review_comment TEXT",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_requested_at TIMESTAMPTZ",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_request_reviewed_at TIMESTAMPTZ",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_request_reviewed_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
        ):
            await conn.execute(text(statement))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_users_shop_name ON users (shop_name)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_users_vendor_request_status ON users (vendor_request_status)"
        ))
        await conn.execute(text(
            "ALTER TABLE delivery_addresses ADD COLUMN IF NOT EXISTS google_place_id VARCHAR(255)"
        ))
        await conn.execute(text(
            "ALTER TABLE delivery_addresses ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION"
        ))
        await conn.execute(text(
            "ALTER TABLE delivery_addresses ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION"
        ))
        await conn.execute(text(
            "ALTER TABLE delivery_addresses ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMPTZ"
        ))
        await conn.execute(text(
            "ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS maps_provider "
            "VARCHAR(30) NOT NULL DEFAULT 'google'"
        ))
        await conn.execute(text(
            "ALTER TABLE measurement_profiles "
            "ADD COLUMN IF NOT EXISTS garment_type VARCHAR(50) NOT NULL DEFAULT 'general'"
        ))
        await conn.execute(text(
            "ALTER TABLE measurement_profiles "
            "ADD COLUMN IF NOT EXISTS measurements JSONB NOT NULL DEFAULT '{}'::jsonb"
        ))
        await conn.execute(text(
            "ALTER TABLE measurement_profiles "
            "ADD COLUMN IF NOT EXISTS standard_size VARCHAR(30)"
        ))
        await conn.execute(text(
            "ALTER TABLE designs ALTER COLUMN image_url DROP NOT NULL"
        ))
        await conn.execute(text(
            "ALTER TABLE designs ADD COLUMN IF NOT EXISTS vendor_id INTEGER "
            "REFERENCES users(id) ON DELETE RESTRICT"
        ))
        await conn.execute(text(
            "ALTER TABLE designs ADD COLUMN IF NOT EXISTS status VARCHAR(20)"
        ))
        await conn.execute(text(
            "UPDATE designs SET status = 'approved' WHERE status IS NULL"
        ))
        await conn.execute(text(
            "ALTER TABLE designs ALTER COLUMN status SET DEFAULT 'draft'"
        ))
        await conn.execute(text(
            "ALTER TABLE designs ALTER COLUMN status SET NOT NULL"
        ))
        await conn.execute(text(
            "ALTER TABLE designs ADD COLUMN IF NOT EXISTS rejection_comment TEXT"
        ))
        await conn.execute(text(
            "ALTER TABLE designs ADD COLUMN IF NOT EXISTS reviewed_by_id INTEGER "
            "REFERENCES users(id) ON DELETE SET NULL"
        ))
        await conn.execute(text(
            "ALTER TABLE designs ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ"
        ))
        await conn.execute(text(
            "ALTER TABLE designs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ"
        ))
        await conn.execute(text(
            "ALTER TABLE designs ADD COLUMN IF NOT EXISTS is_custom_request_template "
            "BOOLEAN NOT NULL DEFAULT FALSE"
        ))
        await conn.execute(text(
            "UPDATE designs SET updated_at = created_at WHERE updated_at IS NULL"
        ))
        await conn.execute(text(
            "ALTER TABLE designs ALTER COLUMN updated_at SET DEFAULT NOW()"
        ))
        await conn.execute(text(
            "ALTER TABLE designs ALTER COLUMN updated_at SET NOT NULL"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_designs_vendor_id ON designs (vendor_id)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_designs_status ON designs (status)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_designs_custom_request_template "
            "ON designs (is_custom_request_template)"
        ))
        await conn.execute(text(
            "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS work_status "
            "VARCHAR(30) NOT NULL DEFAULT 'awaiting_invoice'"
        ))
        await conn.execute(text(
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS vendor_id INTEGER "
            "REFERENCES users(id) ON DELETE RESTRICT"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_orders_vendor_created_at "
            "ON orders (vendor_id, created_at DESC)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_order_items_work_status "
            "ON order_items (work_status)"
        ))
        await conn.execute(text(
            "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cloth_source "
            "VARCHAR(30) NOT NULL DEFAULT 'customer_provided'"
        ))
        await conn.execute(text(
            "UPDATE order_items AS oi SET cloth_source = vi.cloth_source "
            "FROM vendor_invoices AS vi WHERE vi.order_item_id = oi.id"
        ))
        await conn.execute(text(
            "ALTER TABLE vendor_invoices ADD COLUMN IF NOT EXISTS "
            "cloth_bill_bucket_name VARCHAR(255)"
        ))
        await conn.execute(text(
            "ALTER TABLE vendor_invoices ADD COLUMN IF NOT EXISTS "
            "cloth_bill_object_name VARCHAR(1024)"
        ))
        await conn.execute(text(
            "ALTER TABLE vendor_invoices ADD COLUMN IF NOT EXISTS "
            "cloth_bill_original_filename VARCHAR(255)"
        ))
        await conn.execute(text(
            "ALTER TABLE vendor_invoices ADD COLUMN IF NOT EXISTS "
            "cloth_bill_content_type VARCHAR(100)"
        ))
        await conn.execute(text(
            "ALTER TABLE vendor_invoices ADD COLUMN IF NOT EXISTS "
            "cloth_bill_size_bytes INTEGER"
        ))
        await conn.execute(text(
            "ALTER TABLE vendor_invoices ADD COLUMN IF NOT EXISTS "
            "cloth_bill_uploaded_at TIMESTAMPTZ"
        ))
        await conn.execute(text(
            "ALTER TABLE vendor_invoices ADD COLUMN IF NOT EXISTS "
            "revision INTEGER NOT NULL DEFAULT 1"
        ))
        # Hot list/detail paths. PostgreSQL does not automatically index foreign
        # keys, so create the composite indexes the paginated APIs rely on.
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_orders_user_created_at "
            "ON orders (user_id, created_at DESC)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_orders_created_at "
            "ON orders (created_at DESC)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_order_items_order_id "
            "ON order_items (order_id)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_order_items_design_id "
            "ON order_items (design_id)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_order_comments_item_created_at "
            "ON order_comments (order_item_id, created_at)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_order_comments_item_id "
            "ON order_comments (order_item_id, id)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_notifications_user_created_at "
            "ON notifications (user_id, created_at DESC)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_notifications_user_unread_created_at "
            "ON notifications (user_id, created_at DESC) WHERE read_at IS NULL"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_designs_vendor_status_updated "
            "ON designs (vendor_id, status, updated_at DESC)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_deliveries_status_created_at "
            "ON deliveries (status, created_at DESC)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_deliveries_vendor_created_at "
            "ON deliveries (vendor_id, created_at DESC)"
        ))
        # Product-shop orders share delivery tracking with tailoring orders.
        # Existing databases need these ALTERs because create_all does not
        # evolve tables that already exist.
        await conn.execute(text(
            "ALTER TABLE deliveries ALTER COLUMN order_id DROP NOT NULL"
        ))
        await conn.execute(text(
            "ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS product_order_id INTEGER"
        ))
        await conn.execute(text("""
            DO $$ BEGIN
                ALTER TABLE deliveries ADD CONSTRAINT fk_deliveries_product_order
                FOREIGN KEY (product_order_id) REFERENCES product_orders(id) ON DELETE CASCADE;
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$
        """))
        await conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_deliveries_product_order_id "
            "ON deliveries (product_order_id) WHERE product_order_id IS NOT NULL"
        ))
        await conn.execute(text("""
            DO $$ BEGIN
                ALTER TABLE deliveries ADD CONSTRAINT ck_delivery_exactly_one_order
                CHECK ((order_id IS NOT NULL) <> (product_order_id IS NOT NULL));
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$
        """))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_products_vendor_status_updated "
            "ON products (vendor_id, status, updated_at DESC)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_products_catalog "
            "ON products (status, category, product_type, updated_at DESC)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_product_orders_customer_created "
            "ON product_orders (user_id, created_at DESC)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_product_orders_vendor_created "
            "ON product_orders (vendor_id, created_at DESC)"
        ))

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
        "camera=(), microphone=(), geolocation=(), payment=()",
    )
    if not settings.is_development:
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains",
        )
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' blob: data:; "
            "style-src 'self' 'unsafe-inline'; font-src 'self'; "
            "connect-src 'self'; object-src 'none'; base-uri 'self'; "
            "frame-ancestors 'none'; form-action 'self'",
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
app.include_router(products.catalog_router)
app.include_router(products.vendor_router)
app.include_router(products.admin_router)
app.include_router(products.orders_router)
app.include_router(products.admin_orders_router)
app.include_router(deliveries.router)
app.include_router(deliveries.admin_router)
app.include_router(vendor_designs.router)
app.include_router(vendors.router)
app.include_router(admin.router)
app.include_router(notifications.router)
app.include_router(media.router)


@app.get("/api/public/config", include_in_schema=False)
async def public_app_config():
    """Return the small allowlist of non-secret settings used before sign-in."""
    return {
        "vendor_contact_email": str(settings.VENDOR_CONTACT_EMAIL),
    }


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
