import asyncio
import hashlib
import hmac
import secrets
import time
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.database import get_db
from app.models import (
    AuthSession,
    PasswordResetToken,
    User,
    UserRole,
    VendorCustomerRelationship,
    VendorCustomerStatus,
)
from app.schemas import (
    PasswordResetConfirm,
    PasswordResetRequest,
    UserCreate,
    UserLogin,
    UserResponse,
    VendorApplicationResponse,
    UserUpdate,
    Token,
    MobileLogin,
    MobileRefreshRequest,
    MobileToken,
)
from app.config import settings
from app.email_service import (
    send_password_changed_email,
    send_password_reset_email,
    send_welcome_email,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

pwd_context = CryptContext(schemes=["argon2", "bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
REFRESH_COOKIE_NAME = "vastrivo_refresh"
LEGACY_REFRESH_COOKIE_NAME = "anu_refresh"
UI_REQUEST_HEADER = "VastrivoUI"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


# A login for an unknown email performs the same expensive password check as a
# known account, reducing account-enumeration signals from response timing.
DUMMY_PASSWORD_HASH = hash_password("not-a-real-user-password")


def _create_token(data: dict, expires_delta: timedelta, token_type: str) -> str:
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    expire = now + expires_delta
    to_encode.update({
        "exp": expire,
        "iat": now,
        "iss": settings.JWT_ISSUER,
        "aud": settings.JWT_AUDIENCE,
        "type": token_type,
    })
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_access_token(data: dict) -> str:
    return _create_token(
        data,
        timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        token_type="access",
    )


def create_refresh_token(data: dict) -> str:
    return _create_token(
        data,
        timedelta(minutes=settings.REFRESH_TOKEN_EXPIRE_MINUTES),
        token_type="refresh",
    )


def create_chat_ticket(access_token: str, item_id: int) -> str:
    """Exchange a validated access token for a short-lived, item-bound WS ticket."""
    access = _decode_token(access_token, "access")
    return _create_token(
        {
            "sub": str(access["sub"]),
            "sid": str(access["sid"]),
            "item": item_id,
            "jti": str(uuid4()),
        },
        timedelta(seconds=30),
        token_type="chat",
    )


def decode_chat_ticket(ticket: str, item_id: int) -> tuple[int, str]:
    payload = _decode_token(ticket, "chat")
    try:
        if int(payload.get("item")) != item_id:
            raise ValueError
        return int(payload["sub"]), str(payload["sid"])
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid or expired chat ticket")


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _decode_token(token: str, expected_type: str) -> dict:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=f"Invalid or expired {expected_type} token",
    )
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
            issuer=settings.JWT_ISSUER,
            audience=settings.JWT_AUDIENCE,
        )
        if payload.get("type") != expected_type:
            raise credentials_exception
        if not payload.get("sub") or not payload.get("sid"):
            raise credentials_exception
        return payload
    except JWTError:
        raise credentials_exception


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=token,
        max_age=settings.REFRESH_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True,
        secure=not settings.is_development,
        samesite="strict",
        path="/api/auth",
    )
    response.delete_cookie(
        key=LEGACY_REFRESH_COOKIE_NAME,
        httponly=True,
        secure=not settings.is_development,
        samesite="strict",
        path="/api/auth",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        httponly=True,
        secure=not settings.is_development,
        samesite="strict",
        path="/api/auth",
    )
    response.delete_cookie(
        key=LEGACY_REFRESH_COOKIE_NAME,
        httponly=True,
        secure=not settings.is_development,
        samesite="strict",
        path="/api/auth",
    )


def _require_ui_request(x_requested_with: str | None) -> None:
    if x_requested_with != UI_REQUEST_HEADER:
        raise HTTPException(status_code=403, detail="Invalid session request")


async def _authenticate_login(form_data: UserLogin, db: AsyncSession) -> User:
    result = await db.execute(
        select(User).where(func.lower(User.email) == str(form_data.email).lower())
    )
    user = result.scalar_one_or_none()
    password_matches = verify_password(
        form_data.password,
        user.hashed_password if user else DUMMY_PASSWORD_HASH,
    )
    if not user or not password_matches:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is inactive. Contact an administrator.",
        )
    return user


async def _start_auth_session(
    user: User,
    db: AsyncSession,
    *,
    client_type: str = "web",
    device_id: str | None = None,
    device_name: str | None = None,
    device_platform: str | None = None,
    app_version: str | None = None,
) -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    await db.execute(
        delete(AuthSession).where(
            AuthSession.user_id == user.id,
            or_(
                AuthSession.expires_at <= now,
                AuthSession.revoked_at.is_not(None),
            ),
        )
    )
    sessions_to_remove = (
        await db.execute(
            select(AuthSession.id)
            .where(
                AuthSession.user_id == user.id,
                AuthSession.client_type == "web",
                AuthSession.revoked_at.is_(None),
                AuthSession.expires_at > now,
            )
            .order_by(AuthSession.created_at.desc())
            .offset(max(0, settings.MAX_ACTIVE_SESSIONS_PER_USER - 1))
        )
    ).scalars().all()
    if sessions_to_remove and client_type == "web":
        await db.execute(delete(AuthSession).where(AuthSession.id.in_(sessions_to_remove)))

    session_id = str(uuid4())
    refresh_token = f"m1.{session_id}.{secrets.token_urlsafe(32)}" if client_type == "mobile" else create_refresh_token(
        data={"sub": str(user.id), "sid": session_id, "jti": str(uuid4())}
    )
    db.add(
        AuthSession(
            id=session_id,
            user_id=user.id,
            refresh_token_hash=_token_hash(refresh_token),
            client_type=client_type,
            device_name=device_name,
            device_platform=device_platform,
            app_version=app_version,
            device_id_hash=_token_hash(device_id) if device_id else None,
            last_used_at=now,
            expires_at=None if client_type == "mobile" else now + timedelta(minutes=settings.REFRESH_TOKEN_EXPIRE_MINUTES),
        )
    )
    await db.commit()
    access_token = create_access_token(data={"sub": str(user.id), "sid": session_id})
    return access_token, refresh_token


async def _rotate_refresh_session(
    refresh_token: str,
    db: AsyncSession,
    *,
    expected_client_type: str,
    device_id: str | None = None,
) -> tuple[str, str]:
    payload = _decode_token(refresh_token, "refresh")
    try:
        user_id = int(payload["sub"])
        session_id = str(payload["sid"])
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid refresh session")

    session = await db.scalar(
        select(AuthSession)
        .where(AuthSession.id == session_id, AuthSession.user_id == user_id)
        .with_for_update()
    )
    now = datetime.now(timezone.utc)
    if not session or session.revoked_at is not None or session.expires_at is None or session.expires_at <= now:
        raise HTTPException(status_code=401, detail="Refresh session is expired or closed")
    if session.client_type != expected_client_type:
        raise HTTPException(status_code=401, detail="Refresh session client is invalid")
    if expected_client_type == "mobile":
        if not device_id or not session.device_id_hash or not hmac.compare_digest(
            session.device_id_hash, _token_hash(device_id)
        ):
            session.revoked_at = now
            await db.commit()
            raise HTTPException(status_code=401, detail="Mobile device session is invalid")
    if not hmac.compare_digest(session.refresh_token_hash, _token_hash(refresh_token)):
        session.revoked_at = now
        await db.commit()
        raise HTTPException(status_code=401, detail="Refresh token reuse detected; session closed")

    user = await db.get(User, user_id)
    if not user or not user.is_active:
        session.revoked_at = now
        await db.commit()
        raise HTTPException(status_code=401, detail="Invalid refresh token or inactive account")

    new_refresh_token = create_refresh_token(
        data={"sub": str(user.id), "sid": session_id, "jti": str(uuid4())}
    )
    session.refresh_token_hash = _token_hash(new_refresh_token)
    session.last_used_at = now
    session.expires_at = now + timedelta(minutes=settings.REFRESH_TOKEN_EXPIRE_MINUTES)
    await db.commit()
    access_token = create_access_token(data={"sub": str(user.id), "sid": session_id})
    return access_token, new_refresh_token


async def _rotate_mobile_session(refresh_token: str, db: AsyncSession, *, device_id: str, request_id: str | None) -> tuple[str, str]:
    # Legacy, still-valid JWT credentials migrate on their next successful refresh.
    if refresh_token.startswith("m1."):
        parts = refresh_token.split(".")
        if len(parts) != 3 or len(parts[1]) != 36:
            raise HTTPException(status_code=401, detail="Invalid refresh credential")
        session_id = parts[1]
    else:
        session_id = str(_decode_token(refresh_token, "refresh")["sid"])
    session = await db.scalar(select(AuthSession).where(AuthSession.id == session_id).with_for_update())
    now = datetime.now(timezone.utc)
    if not session or session.client_type != "mobile" or session.revoked_at is not None or (session.expires_at is not None and session.expires_at <= now):
        raise HTTPException(status_code=401, detail="Mobile session is closed")
    presented = _token_hash(refresh_token)
    current = hmac.compare_digest(session.refresh_token_hash, presented)
    previous = bool(session.previous_refresh_hash and hmac.compare_digest(session.previous_refresh_hash, presented))
    # An unknown secret must not let an attacker revoke a session by guessing its ID.
    if not current and not previous:
        raise HTTPException(status_code=401, detail="Invalid refresh credential")
    user = await db.get(User, session.user_id)
    if not user or not user.is_active or not session.device_id_hash or not hmac.compare_digest(session.device_id_hash, _token_hash(device_id)):
        session.revoked_at = now
        await db.commit()
        raise HTTPException(status_code=401, detail="Mobile session is invalid")
    request_hash = _token_hash(request_id) if request_id else None
    if previous and (not request_hash or not session.refresh_request_hash or not hmac.compare_digest(request_hash, session.refresh_request_hash)):
        session.revoked_at = now
        await db.commit()
        raise HTTPException(status_code=401, detail="Refresh token reuse detected; session closed")
    # Reconstruct the same successor for an exact retry without storing plaintext.
    nonce = request_id or secrets.token_urlsafe(32)
    secret = hmac.new(settings.SECRET_KEY.encode(), f"mobile-refresh-v1|{refresh_token}|{nonce}".encode(), hashlib.sha256).hexdigest()
    successor = f"m1.{session_id}.{secret}"
    if previous:
        if not hmac.compare_digest(_token_hash(successor), session.refresh_token_hash):
            raise HTTPException(status_code=401, detail="Refresh recovery is no longer available")
    else:
        session.previous_refresh_hash = presented
        session.refresh_request_hash = request_hash
        session.refresh_token_hash = _token_hash(successor)
        session.expires_at = None
    session.last_used_at = now
    await db.commit()
    return create_access_token({"sub": str(user.id), "sid": session.id}), successor


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = _decode_token(token, "access")
        user_id = int(payload["sub"])
        session_id = str(payload["sid"])
    except (HTTPException, TypeError, ValueError):
        raise credentials_exception

    result = await db.execute(
        select(User)
        .join(AuthSession, AuthSession.user_id == User.id)
        .where(
            User.id == user_id,
            AuthSession.id == session_id,
            AuthSession.revoked_at.is_(None),
            or_(AuthSession.expires_at > datetime.now(timezone.utc),
                (AuthSession.client_type == "mobile") & AuthSession.expires_at.is_(None)),
        )
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise credentials_exception
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is inactive. Contact an administrator.",
        )
    return user


def require_roles(*allowed_roles: str):
    async def role_dependency(
        current_user: User = Depends(get_current_user),
    ) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action",
            )
        return current_user

    return role_dependency


require_vendor = require_roles(UserRole.VENDOR.value)
require_customer = require_roles(UserRole.CUSTOMER.value)
require_buyer = require_roles(UserRole.CUSTOMER.value, UserRole.VENDOR.value)
require_admin = require_roles(UserRole.ADMIN.value, UserRole.SUPER_ADMIN.value)
require_super_admin = require_roles(UserRole.SUPER_ADMIN.value)
require_delivery_agent = require_roles(UserRole.DELIVERY_AGENT.value)


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register_user(
    user_in: UserCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(func.lower(User.email) == str(user_in.email).lower())
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email is already registered")

    result = await db.execute(select(User).where(User.phone == user_in.phone))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Phone number is already registered")

    hashed_password = hash_password(user_in.password)
    user = User(
        full_name=user_in.full_name,
        email=user_in.email,
        phone=user_in.phone,
        hashed_password=hashed_password,
        role=UserRole.CUSTOMER.value,
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Email or phone number is already registered",
        )
    await db.refresh(user)
    if settings.EMAIL_PROVIDER.lower() != "disabled":
        background_tasks.add_task(
            send_welcome_email,
            str(user.email),
            user.full_name,
        )
    return user


PASSWORD_RESET_RESPONSE = (
    "If an active account exists for that email, a password reset link will be sent."
)


@router.post("/password-reset/request", status_code=status.HTTP_202_ACCEPTED)
async def request_password_reset(
    payload: PasswordResetRequest,
    background_tasks: BackgroundTasks,
    x_requested_with: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    started_at = time.monotonic()

    async def generic_response():
        # Normalize the quickest paths so the public endpoint does not become a
        # useful registered-email timing oracle.
        await asyncio.sleep(max(0.0, 0.25 - (time.monotonic() - started_at)))
        return {"message": PASSWORD_RESET_RESPONSE}

    _require_ui_request(x_requested_with)
    user = await db.scalar(
        select(User).where(func.lower(User.email) == str(payload.email).lower())
    )
    if not user or not user.is_active:
        return await generic_response()

    now = datetime.now(timezone.utc)
    recently_requested = await db.scalar(
        select(PasswordResetToken.id).where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.created_at > now - timedelta(seconds=60),
        )
    )
    if recently_requested:
        return await generic_response()

    raw_token = secrets.token_urlsafe(32)
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=_token_hash(raw_token),
            expires_at=now + timedelta(minutes=settings.PASSWORD_RESET_EXPIRE_MINUTES),
        )
    )
    await db.commit()
    if settings.EMAIL_PROVIDER.lower() != "disabled":
        background_tasks.add_task(
            send_password_reset_email,
            str(user.email),
            user.full_name,
            raw_token,
        )
    return await generic_response()


@router.post("/password-reset/confirm")
async def confirm_password_reset(
    payload: PasswordResetConfirm,
    response: Response,
    background_tasks: BackgroundTasks,
    x_requested_with: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    _require_ui_request(x_requested_with)
    now = datetime.now(timezone.utc)
    reset_token = await db.scalar(
        select(PasswordResetToken)
        .where(PasswordResetToken.token_hash == _token_hash(payload.token))
        .with_for_update()
    )
    if (
        not reset_token
        or reset_token.used_at is not None
        or reset_token.expires_at <= now
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password reset link is invalid or has expired",
        )

    user = await db.get(User, reset_token.user_id)
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password reset link is invalid or has expired",
        )
    user.hashed_password = hash_password(payload.new_password)
    invited_relationship = await db.scalar(
        select(VendorCustomerRelationship)
        .where(
            VendorCustomerRelationship.invitation_token_id == reset_token.id,
            VendorCustomerRelationship.customer_user_id == user.id,
            VendorCustomerRelationship.status == VendorCustomerStatus.INVITED.value,
        )
        .with_for_update()
    )
    if invited_relationship:
        invited_relationship.status = VendorCustomerStatus.ACTIVE.value
        invited_relationship.accepted_at = now
        invited_relationship.declined_at = None
    await db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
        )
        .values(used_at=now)
    )
    # A password reset is a security boundary: every browser/device session is
    # invalid immediately, including a session in the browser doing the reset.
    await db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    await db.commit()
    _clear_refresh_cookie(response)
    if settings.EMAIL_PROVIDER.lower() != "disabled":
        background_tasks.add_task(
            send_password_changed_email,
            str(user.email),
            user.full_name,
        )
    return {
        "message": (
            "Account set up and vendor relationship accepted. Sign in with your new password."
            if invited_relationship
            else "Password updated. Sign in with your new password."
        )
    }


@router.post("/login", response_model=Token)
async def login_for_access_token(
    form_data: UserLogin,
    response: Response,
    x_requested_with: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    _require_ui_request(x_requested_with)
    user = await _authenticate_login(form_data, db)
    access_token, refresh_token = await _start_auth_session(user, db)
    _set_refresh_cookie(response, refresh_token)
    return {"access_token": access_token}


@router.post("/refresh", response_model=Token)
async def refresh_access_token(
    request: Request,
    response: Response,
    x_requested_with: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    _require_ui_request(x_requested_with)
    refresh_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh session is missing or expired",
        )

    try:
        access_token, new_refresh_token = await _rotate_refresh_session(
            refresh_token,
            db,
            expected_client_type="web",
        )
    except HTTPException:
        _clear_refresh_cookie(response)
        raise
    _set_refresh_cookie(response, new_refresh_token)
    return {"access_token": access_token}


@router.post("/mobile/login", response_model=MobileToken)
async def mobile_login(
    form_data: MobileLogin,
    response: Response,
    x_requested_with: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    _require_ui_request(x_requested_with)
    user = await _authenticate_login(form_data, db)
    access_token, refresh_token = await _start_auth_session(
        user,
        db,
        client_type="mobile",
        device_id=form_data.device_id,
        device_name=form_data.device_name,
        device_platform=form_data.platform,
        app_version=form_data.app_version,
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "access_expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "refresh_expires_in": None,
    }


@router.post("/mobile/refresh", response_model=MobileToken)
async def mobile_refresh(
    payload: MobileRefreshRequest,
    response: Response,
    x_requested_with: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    _require_ui_request(x_requested_with)
    access_token, refresh_token = await _rotate_mobile_session(
        payload.refresh_token,
        db,
        device_id=payload.device_id,
        request_id=payload.request_id,
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "access_expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "refresh_expires_in": None,
    }


@router.post("/mobile/logout", status_code=status.HTTP_204_NO_CONTENT)
async def mobile_logout(
    token: str = Depends(oauth2_scheme),
    x_requested_with: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    _require_ui_request(x_requested_with)
    payload = _decode_token(token, "access")
    session = await db.get(AuthSession, str(payload["sid"]))
    if session and session.revoked_at is None:
        session.revoked_at = datetime.now(timezone.utc)
        await db.commit()


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    token: str = Depends(oauth2_scheme),
    x_requested_with: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    _require_ui_request(x_requested_with)
    payload = _decode_token(token, "access")
    session = await db.get(AuthSession, str(payload["sid"]))
    if session and session.revoked_at is None:
        session.revoked_at = datetime.now(timezone.utc)
        await db.commit()
    _clear_refresh_cookie(response)


@router.get("/me", response_model=VendorApplicationResponse)
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/me", response_model=VendorApplicationResponse)
async def update_users_me(
    user_in: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user_in.phone:
        result = await db.execute(
            select(User).where(
                User.phone == user_in.phone,
                User.id != current_user.id,
            )
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail="Phone number is already registered",
            )

    current_user.full_name = user_in.full_name.strip()
    current_user.phone = user_in.phone
    current_user.location = user_in.location.strip() if user_in.location else None
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Phone number is already registered",
        )
    await db.refresh(current_user)
    return current_user
