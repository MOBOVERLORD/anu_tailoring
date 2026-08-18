"""Verify encrypted-client mobile login, refresh rotation, and logout contracts."""

import asyncio

from fastapi import HTTPException, Response
from jose import jwt

from app.auth import (
    UI_REQUEST_HEADER,
    get_current_user,
    mobile_login,
    mobile_logout,
    mobile_refresh,
)
from app.config import settings
from app.database import AsyncSessionLocal
from app.main import init_db_and_seed_admin
from app.models import AuthSession
from app.schemas import MobileLogin, MobileRefreshRequest


def session_id(access_token: str) -> str:
    return str(jwt.decode(
        access_token,
        settings.SECRET_KEY,
        algorithms=[settings.ALGORITHM],
        issuer=settings.JWT_ISSUER,
        audience=settings.JWT_AUDIENCE,
    )["sid"])


async def verify() -> None:
    if not settings.ADMIN_EMAIL or not settings.ADMIN_PASSWORD:
        raise RuntimeError("Admin test credentials are not configured")

    await init_db_and_seed_admin()
    device_id = "92b6cb94-81bc-43dc-963b-0123456789ab"
    async with AsyncSessionLocal() as db:
        tokens = await mobile_login(
            MobileLogin(
                email=settings.ADMIN_EMAIL,
                password=settings.ADMIN_PASSWORD,
                device_id=device_id,
                device_name="Vastrivo verification device",
                platform="android",
                app_version="0.1.0",
            ),
            Response(),
            UI_REQUEST_HEADER,
            db,
        )
        first_access = tokens["access_token"]
        first_refresh = tokens["refresh_token"]
        sid = session_id(first_access)
        session = await db.get(AuthSession, sid)
        assert session is not None
        assert session.client_type == "mobile"
        assert session.device_platform == "android"
        assert session.device_id_hash is not None

        rotated = await mobile_refresh(
            MobileRefreshRequest(refresh_token=first_refresh, device_id=device_id),
            Response(),
            UI_REQUEST_HEADER,
            db,
        )
        assert rotated["refresh_token"] != first_refresh
        current = await get_current_user(rotated["access_token"], db)
        assert str(current.email).lower() == str(settings.ADMIN_EMAIL).lower()

        await mobile_logout(rotated["access_token"], UI_REQUEST_HEADER, db)
        try:
            await get_current_user(rotated["access_token"], db)
        except HTTPException as exc:
            assert exc.status_code == 401
        else:
            raise AssertionError("Mobile logout did not revoke the access session")

        session = await db.get(AuthSession, sid)
        if session:
            await db.delete(session)
            await db.commit()

    print("Mobile auth passed: login -> encrypted-client refresh rotation -> logout")


if __name__ == "__main__":
    asyncio.run(verify())
