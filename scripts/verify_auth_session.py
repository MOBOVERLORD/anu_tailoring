"""Run a local login -> refresh -> logout session integrity check."""

import asyncio
from http.cookies import SimpleCookie

from fastapi import HTTPException, Request, Response
from jose import jwt

from app.auth import (
    UI_REQUEST_HEADER,
    get_current_user,
    login_for_access_token,
    logout,
    refresh_access_token,
)
from app.config import settings
from app.database import AsyncSessionLocal
from app.main import init_db_and_seed_admin
from app.models import AuthSession
from app.orders import list_all_orders
from app.schemas import UserLogin


async def verify() -> None:
    if not settings.ADMIN_EMAIL or not settings.ADMIN_PASSWORD:
        raise RuntimeError("Admin test credentials are not configured")

    await init_db_and_seed_admin()
    async with AsyncSessionLocal() as db:
        login_response = Response()
        login = await login_for_access_token(
            UserLogin(
                email=settings.ADMIN_EMAIL,
                password=settings.ADMIN_PASSWORD,
            ),
            login_response,
            UI_REQUEST_HEADER,
            db,
        )
        first_access = login["access_token"]
        session_id = jwt.decode(
            first_access,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
            issuer=settings.JWT_ISSUER,
            audience=settings.JWT_AUDIENCE,
        )["sid"]

        cookie = SimpleCookie()
        cookie.load(login_response.headers["set-cookie"])
        refresh_value = cookie["vastrivo_refresh"].value
        current_user = await get_current_user(first_access, db)
        order_page = await list_all_orders(None, 1, 0, current_user, db)
        assert order_page["limit"] == 1
        assert order_page["offset"] == 0
        assert isinstance(order_page["items"], list)

        request = Request(
            {
                "type": "http",
                "headers": [
                    (b"cookie", f"vastrivo_refresh={refresh_value}".encode("utf-8"))
                ],
            }
        )
        refresh_response = Response()
        refreshed = await refresh_access_token(
            request,
            refresh_response,
            UI_REQUEST_HEADER,
            db,
        )
        second_access = refreshed["access_token"]
        await logout(Response(), second_access, UI_REQUEST_HEADER, db)

        try:
            await get_current_user(second_access, db)
        except HTTPException as exc:
            if exc.status_code != 401:
                raise
        else:
            raise AssertionError("Revoked access token was accepted")

        session = await db.get(AuthSession, session_id)
        if session:
            await db.delete(session)
            await db.commit()

    print(
        "Auth and pagination passed: login -> paged orders -> refresh -> logout"
    )


if __name__ == "__main__":
    asyncio.run(verify())
