from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import hash_password, require_admin, require_super_admin
from app.database import get_db
from app.design_service import serialize_design_async, serialize_designs_async
from app.deliveries import geocode_vendor_pickup
from app.maps import MapProviderError
from app.models import (
    Design,
    DesignReview,
    DesignStatus,
    Notification,
    Order,
    Product,
    ProductOrder,
    User,
    UserRole,
)
from app.schemas import (
    DesignResponse,
    DesignReviewRequest,
    AdminUserUpdate,
    VendorCreate,
    UserResponse,
    UserStatusUpdate,
)

router = APIRouter(prefix="/api/admin", tags=["administration"])


@router.get("/designs", response_model=list[DesignResponse])
async def list_designs_for_review(
    review_status: Optional[str] = Query(
        default=DesignStatus.SUBMITTED.value, alias="status"
    ),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    allowed = {item.value for item in DesignStatus}
    if review_status not in allowed:
        raise HTTPException(status_code=400, detail="Invalid design status")
    result = await db.execute(
        select(Design)
        .where(Design.status == review_status)
        .options(selectinload(Design.images), selectinload(Design.vendor))
        .order_by(Design.updated_at.asc())
    )
    return await serialize_designs_async(list(result.scalars().all()))


@router.post("/designs/{design_id}/review", response_model=DesignResponse)
async def review_design(
    design_id: int,
    payload: DesignReviewRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Design)
        .where(Design.id == design_id)
        .options(selectinload(Design.images), selectinload(Design.vendor))
        .with_for_update()
    )
    design = result.scalar_one_or_none()
    if not design:
        raise HTTPException(status_code=404, detail="Design not found")
    if design.status != DesignStatus.SUBMITTED.value:
        raise HTTPException(
            status_code=409,
            detail="Only submitted designs can be reviewed",
        )

    comment = payload.comment.strip() if payload.comment else None
    if payload.decision == DesignStatus.REJECTED.value and not comment:
        raise HTTPException(
            status_code=422,
            detail="A rejection comment is required",
        )
    if payload.decision == DesignStatus.APPROVED.value and not any(
        image.upload_status == "ready" for image in design.images
    ):
        raise HTTPException(
            status_code=409,
            detail="A design must have at least one verified image",
        )

    design.status = payload.decision
    design.rejection_comment = (
        comment if payload.decision == DesignStatus.REJECTED.value else None
    )
    design.reviewed_by_id = admin.id
    design.reviewed_at = datetime.now(timezone.utc)
    db.add(
        DesignReview(
            design_id=design.id,
            reviewer_id=admin.id,
            decision=payload.decision,
            comment=comment,
        )
    )
    if design.vendor_id:
        outcome = "approved" if payload.decision == "approved" else "needs changes"
        message = f'Your design "{design.title}" was {outcome}.'
        if comment:
            message += f" Reviewer note: {comment}"
        db.add(
            Notification(
                user_id=design.vendor_id,
                title=f"Design {outcome}",
                message=message,
                notification_type=f"design_{payload.decision}",
                link="/vendor",
            )
        )
    await db.commit()

    refreshed = await db.execute(
        select(Design)
        .where(Design.id == design_id)
        .options(selectinload(Design.images), selectinload(Design.vendor))
    )
    return await serialize_design_async(refreshed.scalar_one())


@router.get("/vendors", response_model=list[UserResponse])
async def list_vendors(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User)
        .where(User.role == UserRole.VENDOR.value)
        .order_by(User.created_at.desc())
    )
    return result.scalars().all()


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    role: Optional[str] = Query(default=None),
    active: Optional[bool] = Query(default=None),
    query: Optional[str] = Query(default=None, max_length=100),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    allowed_roles = {item.value for item in UserRole}
    if role and role not in allowed_roles:
        raise HTTPException(status_code=400, detail="Invalid user role")

    statement = select(User)
    if role:
        statement = statement.where(User.role == role)
    if active is not None:
        statement = statement.where(User.is_active.is_(active))
    if query and query.strip():
        search = f"%{query.strip()}%"
        statement = statement.where(
            or_(
                User.full_name.ilike(search),
                User.email.ilike(search),
                User.phone.ilike(search),
            )
        )
    result = await db.execute(statement.order_by(User.created_at.desc()))
    return result.scalars().all()


@router.post(
    "/vendors",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_vendor(
    payload: VendorCreate,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(
        select(User).where(
            (func.lower(User.email) == str(payload.email).lower())
            | (User.phone == payload.phone)
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail="Email or phone number is already registered",
        )

    vendor = User(
        full_name=payload.full_name,
        email=payload.email,
        phone=payload.phone,
        hashed_password=hash_password(payload.password),
        role=UserRole.VENDOR.value,
    )
    try:
        await geocode_vendor_pickup(vendor, payload.pickup_address)
    except MapProviderError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.add(vendor)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Email or phone number is already registered",
        )
    await db.refresh(vendor)
    return vendor


async def _managed_user(user_id: int, db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.id == user_id).with_for_update())
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role not in {UserRole.CUSTOMER.value, UserRole.VENDOR.value}:
        raise HTTPException(
            status_code=403,
            detail="Staff accounts cannot be changed from user management",
        )
    return user


@router.put("/users/{user_id}", response_model=UserResponse)
async def update_managed_user(
    user_id: int,
    payload: AdminUserUpdate,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    user = await _managed_user(user_id, db)
    if payload.phone:
        duplicate = await db.scalar(
            select(User).where(User.phone == payload.phone, User.id != user.id)
        )
        if duplicate:
            raise HTTPException(status_code=409, detail="Phone number is already registered")

    if (
        user.role == UserRole.VENDOR.value
        and payload.vendor_pickup_address is not None
        and payload.vendor_pickup_address.strip() != (user.vendor_pickup_address or "")
    ):
        try:
            await geocode_vendor_pickup(user, payload.vendor_pickup_address)
        except MapProviderError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    user.full_name = payload.full_name
    user.phone = payload.phone
    user.location = payload.location.strip() if payload.location else None
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Phone number is already registered")
    await db.refresh(user)
    return user


@router.patch("/users/{user_id}/status", response_model=UserResponse)
async def update_user_status(
    user_id: int,
    payload: UserStatusUpdate,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    user = await _managed_user(user_id, db)
    user.is_active = payload.is_active
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_managed_user(
    user_id: int,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    user = await _managed_user(user_id, db)
    if user.role == UserRole.VENDOR.value:
        design_reference = await db.scalar(select(Design.id).where(Design.vendor_id == user.id).limit(1))
        product_reference = await db.scalar(select(Product.id).where(Product.vendor_id == user.id).limit(1))
        if design_reference or product_reference:
            raise HTTPException(
                status_code=409,
                detail="This vendor has designs or shop products and cannot be deleted. Deactivate the account instead.",
            )
    order_reference = await db.scalar(
        select(Order.id).where(Order.user_id == user.id).limit(1)
    )
    if order_reference:
        raise HTTPException(
            status_code=409,
            detail="This user has order history and cannot be deleted. Deactivate the account instead.",
        )
    product_order_reference = await db.scalar(
        select(ProductOrder.id).where(
            (ProductOrder.user_id == user.id) | (ProductOrder.vendor_id == user.id)
        ).limit(1)
    )
    if product_order_reference:
        raise HTTPException(
            status_code=409,
            detail="This user has shop order history and cannot be deleted. Deactivate the account instead.",
        )

    await db.delete(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="This account is referenced by business records and cannot be deleted. Deactivate it instead.",
        )
