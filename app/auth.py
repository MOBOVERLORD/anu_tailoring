import hashlib
import hmac
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError

from app.database import get_db
from app.models import AuthSession, User, UserRole
from app.schemas import (
    UserCreate,
    UserLogin,
    UserResponse,
    UserUpdate,
    Token,
)
from app.config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])

pwd_context = CryptContext(schemes=["argon2", "bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
REFRESH_COOKIE_NAME = "anu_refresh"
UI_REQUEST_HEADER = "AnuTailoringUI"


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


def _clear_refresh_cookie(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        httponly=True,
        secure=not settings.is_development,
        samesite="strict",
        path="/api/auth",
    )


def _require_ui_request(x_requested_with: str | None) -> None:
    if x_requested_with != UI_REQUEST_HEADER:
        raise HTTPException(status_code=403, detail="Invalid session request")


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
            AuthSession.expires_at > datetime.now(timezone.utc),
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


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register_user(user_in: UserCreate, db: AsyncSession = Depends(get_db)):
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
    return user


@router.post("/login", response_model=Token)
async def login_for_access_token(
    form_data: UserLogin,
    response: Response,
    x_requested_with: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    _require_ui_request(x_requested_with)
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
    # Keep a bounded number of device sessions. The oldest session is removed
    # before inserting this login, immediately invalidating its access token.
    sessions_to_remove = (
        await db.execute(
            select(AuthSession.id)
            .where(
                AuthSession.user_id == user.id,
                AuthSession.revoked_at.is_(None),
                AuthSession.expires_at > now,
            )
            .order_by(AuthSession.created_at.desc())
            .offset(max(0, settings.MAX_ACTIVE_SESSIONS_PER_USER - 1))
        )
    ).scalars().all()
    if sessions_to_remove:
        await db.execute(
            delete(AuthSession).where(AuthSession.id.in_(sessions_to_remove))
        )
    session_id = str(uuid4())
    refresh_jti = str(uuid4())
    refresh_token = create_refresh_token(
        data={"sub": str(user.id), "sid": session_id, "jti": refresh_jti}
    )
    db.add(
        AuthSession(
            id=session_id,
            user_id=user.id,
            refresh_token_hash=_token_hash(refresh_token),
            expires_at=now
            + timedelta(minutes=settings.REFRESH_TOKEN_EXPIRE_MINUTES),
        )
    )
    await db.commit()
    access_token = create_access_token(
        data={"sub": str(user.id), "sid": session_id}
    )
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
    if (
        not session
        or session.revoked_at is not None
        or session.expires_at <= now
    ):
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Refresh session is expired or closed")
    if not hmac.compare_digest(session.refresh_token_hash, _token_hash(refresh_token)):
        session.revoked_at = now
        await db.commit()
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Refresh token reuse detected; session closed")

    user = await db.get(User, user_id)
    if not user or not user.is_active:
        session.revoked_at = now
        await db.commit()
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Invalid refresh token or inactive account")

    new_refresh_token = create_refresh_token(
        data={"sub": str(user.id), "sid": session_id, "jti": str(uuid4())}
    )
    session.refresh_token_hash = _token_hash(new_refresh_token)
    session.expires_at = now + timedelta(
        minutes=settings.REFRESH_TOKEN_EXPIRE_MINUTES
    )
    await db.commit()
    access_token = create_access_token(
        data={"sub": str(user.id), "sid": session_id}
    )
    _set_refresh_cookie(response, new_refresh_token)
    return {"access_token": access_token}


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


@router.get("/me", response_model=UserResponse)
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/me", response_model=UserResponse)
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
