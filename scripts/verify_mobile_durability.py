"""Rollback-only durable mobile session and refresh recovery regression."""
import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import (_start_auth_session, _rotate_mobile_session, _rotate_refresh_session,
                      _token_hash, create_refresh_token, get_current_user, mobile_logout, UI_REQUEST_HEADER)
from app.database import engine
from app.models import AuthSession, User


async def rejected(call):
    try:
        await call
    except HTTPException as exc:
        assert exc.status_code == 401
    else:
        raise AssertionError("Expected rejection")


async def verify():
    engine.echo = False
    async with engine.connect() as conn:
        transaction = await conn.begin()
        try:
            async with AsyncSession(bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint") as db:
                user = User(full_name="Session regression", email=f"{uuid4().hex}@example.com", hashed_password="test-only", role="customer", is_active=True)
                db.add(user)
                await db.flush()
                device = str(uuid4())
                async def start():
                    access, refresh = await _start_auth_session(user, db, client_type="mobile", device_id=device)
                    sid = refresh.split(".")[1]
                    return access, refresh, await db.get(AuthSession, sid)
                access, original, session = await start()
                assert session.expires_at is None
                session.last_used_at = datetime.now(timezone.utc) - timedelta(days=365)
                await db.commit()
                assert (await get_current_user(access, db)).id == user.id
                request_id = str(uuid4())
                _, rotated = await _rotate_mobile_session(original, db, device_id=device, request_id=request_id)
                # Lost response/process restart: exact retry returns the same credential.
                _, recovered = await _rotate_mobile_session(original, db, device_id=device, request_id=request_id)
                assert recovered == rotated and recovered != original
                assert session.refresh_token_hash == _token_hash(recovered)
                assert session.previous_refresh_hash == _token_hash(original)
                await rejected(_rotate_mobile_session(original, db, device_id=device, request_id=str(uuid4())))
                assert session.revoked_at is not None
                await rejected(get_current_user(access, db))
                access, original, session = await start()
                # Guessing a session ID without the credential cannot revoke it.
                await rejected(_rotate_mobile_session(f"m1.{session.id}.unknown", db, device_id=device, request_id=request_id))
                assert session.revoked_at is None
                await rejected(_rotate_mobile_session(original, db, device_id="wrong-device", request_id=request_id))
                assert session.revoked_at is not None
                access, original, session = await start()
                await mobile_logout(access, UI_REQUEST_HEADER, db)
                await rejected(_rotate_mobile_session(original, db, device_id=device, request_id=request_id))
                access, original, session = await start()
                user.is_active = False
                await db.commit()
                await rejected(_rotate_mobile_session(original, db, device_id=device, request_id=request_id))
                user.is_active = True
                await db.commit()
                access, original, session = await start()
                legacy = create_refresh_token({"sub": str(user.id), "sid": session.id, "jti": str(uuid4())})
                session.refresh_token_hash = _token_hash(legacy)
                session.expires_at = datetime.now(timezone.utc) + timedelta(minutes=20)
                await db.commit()
                _, migrated = await _rotate_mobile_session(legacy, db, device_id=device, request_id=request_id)
                assert migrated.startswith("m1.") and session.expires_at is None
                _, web_refresh = await _start_auth_session(user, db)
                _, web_rotated = await _rotate_refresh_session(web_refresh, db, expected_client_type="web")
                assert not web_rotated.startswith("m1.")
                await rejected(_rotate_refresh_session(web_refresh, db, expected_client_type="web"))
        finally:
            await transaction.rollback()
    await engine.dispose()
    print("Durability passed: persistent mobile sessions, exact retry, replay/device rejection, logout, inactive users, legacy upgrade, browser rotation.")


if __name__ == "__main__":
    asyncio.run(verify())
