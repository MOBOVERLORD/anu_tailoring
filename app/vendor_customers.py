from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user, hash_password, require_vendor
from app.config import settings
from app.database import get_db
from app.email_service import send_vendor_customer_invitation_email
from app.models import (
    PasswordResetToken,
    User,
    UserRole,
    VendorCustomerRelationship,
    VendorCustomerStatus,
)
from app.schemas import (
    CustomerVendorRelationshipResponse,
    VendorCustomerInviteCreate,
    VendorCustomerLinkCreate,
    VendorCustomerNotesUpdate,
    VendorCustomerRelationshipPage,
    VendorCustomerRelationshipResponse,
    normalize_phone_number,
)


router = APIRouter(prefix="/api/vendor/customers", tags=["vendor customers"])
customer_router = APIRouter(
    prefix="/api/customer/vendor-relationships",
    tags=["customer vendor relationships"],
)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _vendor_display_name(vendor: User) -> str:
    return vendor.shop_name or vendor.full_name


def _vendor_response(
    relationship: VendorCustomerRelationship,
) -> VendorCustomerRelationshipResponse:
    customer = relationship.customer
    return VendorCustomerRelationshipResponse(
        id=relationship.id,
        vendor_id=relationship.vendor_id,
        customer_user_id=relationship.customer_user_id,
        full_name=customer.full_name,
        email=customer.email,
        phone=customer.phone,
        account_role=customer.role,
        status=relationship.status,
        vendor_notes=relationship.vendor_notes,
        invited_at=relationship.invited_at,
        accepted_at=relationship.accepted_at,
        declined_at=relationship.declined_at,
        created_at=relationship.created_at,
        updated_at=relationship.updated_at,
    )


def _customer_response(
    relationship: VendorCustomerRelationship,
) -> CustomerVendorRelationshipResponse:
    vendor = relationship.vendor
    return CustomerVendorRelationshipResponse(
        id=relationship.id,
        vendor_id=relationship.vendor_id,
        vendor_name=vendor.full_name,
        shop_name=vendor.shop_name,
        status=relationship.status,
        invited_at=relationship.invited_at,
        accepted_at=relationship.accepted_at,
        declined_at=relationship.declined_at,
        created_at=relationship.created_at,
    )


async def _load_relationship(
    db: AsyncSession,
    relationship_id: int,
    vendor_id: int,
    *,
    for_update: bool = False,
) -> VendorCustomerRelationship:
    statement = (
        select(VendorCustomerRelationship)
        .where(
            VendorCustomerRelationship.id == relationship_id,
            VendorCustomerRelationship.vendor_id == vendor_id,
        )
        .options(selectinload(VendorCustomerRelationship.customer))
    )
    if for_update:
        statement = statement.with_for_update()
    relationship = await db.scalar(statement)
    if not relationship:
        # Vendor scoping intentionally uses a 404 so one vendor cannot probe
        # another vendor's relationship identifiers.
        raise HTTPException(status_code=404, detail="Customer relationship not found")
    return relationship


async def _identity_users(
    db: AsyncSession,
    email: str,
    phone: str,
) -> tuple[User | None, User | None]:
    users = list(
        (
            await db.execute(
                select(User).where(
                    or_(
                        func.lower(User.email) == email.lower(),
                        User.phone == phone,
                    )
                )
            )
        )
        .scalars()
        .all()
    )
    email_user = next(
        (user for user in users if user.email.lower() == email.lower()), None
    )
    phone_user = next((user for user in users if user.phone == phone), None)
    if email_user and phone_user and email_user.id != phone_user.id:
        raise HTTPException(
            status_code=409,
            detail="Email and phone number belong to different accounts",
        )
    return email_user, phone_user


async def _existing_relationship(
    db: AsyncSession,
    vendor_id: int,
    customer_user_id: int,
) -> VendorCustomerRelationship | None:
    return await db.scalar(
        select(VendorCustomerRelationship)
        .where(
            VendorCustomerRelationship.vendor_id == vendor_id,
            VendorCustomerRelationship.customer_user_id == customer_user_id,
        )
        .options(selectinload(VendorCustomerRelationship.customer))
    )


async def _relationship_after_race(
    db: AsyncSession,
    vendor_id: int,
    email: str,
    phone: str,
) -> VendorCustomerRelationship | None:
    email_user, phone_user = await _identity_users(db, email, phone)
    if not email_user or not phone_user or email_user.id != phone_user.id:
        return None
    return await _existing_relationship(db, vendor_id, email_user.id)


@router.get("", response_model=VendorCustomerRelationshipPage)
async def list_vendor_customers(
    query: str = Query(default="", max_length=100),
    relationship_status: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    if relationship_status and relationship_status not in {
        item.value for item in VendorCustomerStatus
    }:
        raise HTTPException(status_code=422, detail="Unknown relationship status")

    filters = [VendorCustomerRelationship.vendor_id == current_vendor.id]
    search = query.strip()
    if search:
        if "@" in search:
            filters.append(func.lower(User.email) == search.lower())
        else:
            try:
                phone = normalize_phone_number(search)
            except ValueError:
                filters.append(User.full_name.ilike(f"%{search}%"))
            else:
                filters.append(User.phone == phone)
    if relationship_status:
        filters.append(VendorCustomerRelationship.status == relationship_status)

    base = (
        select(VendorCustomerRelationship)
        .join(User, User.id == VendorCustomerRelationship.customer_user_id)
        .where(*filters)
    )
    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    relationships = list(
        (
            await db.execute(
                base.options(selectinload(VendorCustomerRelationship.customer))
                .order_by(VendorCustomerRelationship.updated_at.desc())
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )
    return VendorCustomerRelationshipPage(
        items=[_vendor_response(item) for item in relationships],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/link",
    response_model=VendorCustomerRelationshipResponse,
    status_code=status.HTTP_201_CREATED,
)
async def link_vendor_customer(
    payload: VendorCustomerLinkCreate,
    current_vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    email_user, phone_user = await _identity_users(db, str(payload.email), payload.phone)
    if not email_user or not phone_user or email_user.id != phone_user.id:
        raise HTTPException(
            status_code=404,
            detail="No active account matches both email and phone number",
        )
    customer = email_user
    if not customer.is_active:
        raise HTTPException(
            status_code=404,
            detail="No active account matches both email and phone number",
        )
    if customer.id == current_vendor.id:
        raise HTTPException(
            status_code=409,
            detail="A vendor cannot add their own account",
        )
    if customer.role not in {UserRole.CUSTOMER.value, UserRole.VENDOR.value}:
        raise HTTPException(
            status_code=409,
            detail="This account cannot be linked as a customer",
        )

    existing = await _existing_relationship(db, current_vendor.id, customer.id)
    if existing:
        return _vendor_response(existing)

    relationship = VendorCustomerRelationship(
        vendor_id=current_vendor.id,
        customer_user_id=customer.id,
        status=VendorCustomerStatus.PENDING_ACCEPTANCE.value,
        vendor_notes=payload.vendor_notes,
        created_by_user_id=current_vendor.id,
    )
    db.add(relationship)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = await _relationship_after_race(
            db, current_vendor.id, str(payload.email), payload.phone
        )
        if existing:
            return _vendor_response(existing)
        raise HTTPException(
            status_code=409,
            detail="Customer relationship already exists",
        )
    saved = await _existing_relationship(db, current_vendor.id, customer.id)
    return _vendor_response(saved)


@router.post(
    "/invite",
    response_model=VendorCustomerRelationshipResponse,
    status_code=status.HTTP_201_CREATED,
)
async def invite_vendor_customer(
    payload: VendorCustomerInviteCreate,
    background_tasks: BackgroundTasks,
    current_vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    email_user, phone_user = await _identity_users(db, str(payload.email), payload.phone)
    if email_user or phone_user:
        if email_user and phone_user and email_user.id == phone_user.id:
            existing = await _existing_relationship(
                db, current_vendor.id, email_user.id
            )
            if existing and existing.status == VendorCustomerStatus.INVITED.value:
                return _vendor_response(existing)
        raise HTTPException(
            status_code=409,
            detail="An account already uses this email or phone number; use exact-match linking",
        )

    now = datetime.now(timezone.utc)
    raw_token = secrets.token_urlsafe(32)
    customer = User(
        full_name=payload.full_name,
        email=str(payload.email),
        phone=payload.phone,
        hashed_password=hash_password(secrets.token_urlsafe(48)),
        role=UserRole.CUSTOMER.value,
        is_active=True,
    )
    db.add(customer)
    try:
        await db.flush()
        reset_token = PasswordResetToken(
            user_id=customer.id,
            token_hash=_hash_token(raw_token),
            expires_at=now + timedelta(minutes=settings.PASSWORD_RESET_EXPIRE_MINUTES),
        )
        db.add(reset_token)
        await db.flush()
        relationship = VendorCustomerRelationship(
            vendor_id=current_vendor.id,
            customer_user_id=customer.id,
            status=VendorCustomerStatus.INVITED.value,
            vendor_notes=payload.vendor_notes,
            invitation_token_id=reset_token.id,
            invited_at=now,
            created_by_user_id=current_vendor.id,
        )
        db.add(relationship)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = await _relationship_after_race(
            db, current_vendor.id, str(payload.email), payload.phone
        )
        if existing and existing.status == VendorCustomerStatus.INVITED.value:
            return _vendor_response(existing)
        raise HTTPException(
            status_code=409,
            detail="An account already uses this email or phone number",
        )

    saved = await _existing_relationship(db, current_vendor.id, customer.id)
    if settings.EMAIL_PROVIDER.lower() != "disabled":
        background_tasks.add_task(
            send_vendor_customer_invitation_email,
            customer.email,
            customer.full_name,
            _vendor_display_name(current_vendor),
            raw_token,
        )
    return _vendor_response(saved)


@router.get("/{relationship_id}", response_model=VendorCustomerRelationshipResponse)
async def get_vendor_customer(
    relationship_id: int,
    current_vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    return _vendor_response(
        await _load_relationship(db, relationship_id, current_vendor.id)
    )


@router.patch("/{relationship_id}", response_model=VendorCustomerRelationshipResponse)
async def update_vendor_customer_notes(
    relationship_id: int,
    payload: VendorCustomerNotesUpdate,
    current_vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    relationship = await _load_relationship(
        db, relationship_id, current_vendor.id, for_update=True
    )
    relationship.vendor_notes = payload.vendor_notes
    await db.commit()
    return _vendor_response(relationship)


@customer_router.post(
    "/{relationship_id}/accept",
    response_model=CustomerVendorRelationshipResponse,
)
async def accept_vendor_relationship(
    relationship_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    relationship = await db.scalar(
        select(VendorCustomerRelationship)
        .where(
            VendorCustomerRelationship.id == relationship_id,
            VendorCustomerRelationship.customer_user_id == current_user.id,
        )
        .options(selectinload(VendorCustomerRelationship.vendor))
        .with_for_update()
    )
    if not relationship:
        raise HTTPException(status_code=404, detail="Vendor relationship not found")
    if relationship.status == VendorCustomerStatus.DECLINED.value:
        raise HTTPException(status_code=409, detail="This relationship was declined")
    if relationship.status != VendorCustomerStatus.ACTIVE.value:
        relationship.status = VendorCustomerStatus.ACTIVE.value
        relationship.accepted_at = datetime.now(timezone.utc)
        relationship.declined_at = None
        await db.commit()
    return _customer_response(relationship)


@customer_router.post(
    "/{relationship_id}/decline",
    response_model=CustomerVendorRelationshipResponse,
)
async def decline_vendor_relationship(
    relationship_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    relationship = await db.scalar(
        select(VendorCustomerRelationship)
        .where(
            VendorCustomerRelationship.id == relationship_id,
            VendorCustomerRelationship.customer_user_id == current_user.id,
        )
        .options(selectinload(VendorCustomerRelationship.vendor))
        .with_for_update()
    )
    if not relationship:
        raise HTTPException(status_code=404, detail="Vendor relationship not found")
    if relationship.status == VendorCustomerStatus.ACTIVE.value:
        raise HTTPException(
            status_code=409,
            detail="An active relationship cannot be declined",
        )
    relationship.status = VendorCustomerStatus.DECLINED.value
    relationship.declined_at = datetime.now(timezone.utc)
    await db.commit()
    return _customer_response(relationship)
