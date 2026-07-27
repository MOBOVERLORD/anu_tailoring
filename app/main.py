from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import select

from app.database import engine, Base, AsyncSessionLocal
from app.models import User
from app.config import settings
from app.auth import hash_password
from app.routers import auth, designs, measurements, addresses, orders


async def init_db_and_seed_admin():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.email == settings.ADMIN_EMAIL))
        admin = result.scalar_one_or_none()

        if not admin:
            admin_user = User(
                full_name=settings.ADMIN_NAME,
                email=settings.ADMIN_EMAIL,
                hashed_password=hash_password(settings.ADMIN_PASSWORD),
            )
            db.add(admin_user)
            await db.commit()
            print(f"Admin user initialized: {settings.ADMIN_EMAIL}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db_and_seed_admin()
    yield
    await engine.dispose()


app = FastAPI(title=settings.PROJECT_NAME, lifespan=lifespan)

app.include_router(auth.router)
app.include_router(designs.router)
app.include_router(measurements.router)
app.include_router(addresses.router)
app.include_router(orders.router)


@app.get("/health")
async def health_check():
    return {"status": "ok"}
