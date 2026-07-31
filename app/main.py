from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select
from sqlalchemy import text

from app.database import engine, Base, AsyncSessionLocal
from app.models import MeasurementCategory, User, UserRole
from app.measurement_catalog import default_category_rows
from app.config import settings
from app.auth import hash_password
from app import (
    addresses,
    admin,
    auth,
    designs,
    measurements,
    media,
    notifications,
    orders,
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

    async with AsyncSessionLocal() as db:
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

app.include_router(auth.router)
app.include_router(designs.router)
app.include_router(measurements.router)
app.include_router(measurements.admin_router)
app.include_router(addresses.router)
app.include_router(orders.router)
app.include_router(orders.admin_router)
app.include_router(vendor_designs.router)
app.include_router(admin.router)
app.include_router(notifications.router)
app.include_router(media.router)


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
