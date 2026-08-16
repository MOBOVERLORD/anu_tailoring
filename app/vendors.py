from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user, require_buyer, require_customer, require_vendor
from app.database import get_db
from app.design_service import serialize_design_async
from app.models import (
    Design,
    DesignStatus,
    Notification,
    User,
    UserRole,
    user_favorite_vendors,
)
from app.schemas import (
    DesignResponse,
    VendorApplicationResponse,
    VendorApplicationCreate,
    VendorDirectoryResponse,
    VendorProfileUpdate,
)


router = APIRouter(prefix="/api/vendors", tags=["vendor directory"])


async def _directory_item(
    vendor: User, current_user: User, db: AsyncSession
) -> VendorDirectoryResponse:
    is_favorite = bool(await db.scalar(select(user_favorite_vendors.c.vendor_id).where(
        user_favorite_vendors.c.user_id == current_user.id,
        user_favorite_vendors.c.vendor_id == vendor.id,
    )))
    custom_design_id = await db.scalar(select(Design.id).where(
        Design.vendor_id == vendor.id,
        Design.is_custom_request_template.is_(True),
    ))
    return VendorDirectoryResponse(
        id=vendor.id,
        full_name=vendor.full_name,
        shop_name=vendor.shop_name or vendor.full_name,
        shop_description=vendor.shop_description,
        location=vendor.location,
        profile_image_url=vendor.profile_image_url,
        logo_url=vendor.vendor_logo_url,
        is_favorite=is_favorite,
        custom_design_id=custom_design_id,
        accepts_custom_orders=(
            vendor.vendor_pickup_latitude is not None
            and vendor.vendor_pickup_longitude is not None
        ),
    )


@router.get("", response_model=list[VendorDirectoryResponse])
async def list_vendor_directory(
    query: str = Query(default="", max_length=100),
    favorite_only: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    favorite_ids = select(user_favorite_vendors.c.vendor_id).where(
        user_favorite_vendors.c.user_id == current_user.id
    )
    statement = select(User).where(
        User.role == UserRole.VENDOR.value,
        User.is_active.is_(True),
    )
    search = query.strip()
    if search:
        pattern = f"%{search}%"
        statement = statement.where(or_(
            User.shop_name.ilike(pattern),
            User.full_name.ilike(pattern),
            User.location.ilike(pattern),
        ))
    if favorite_only:
        statement = statement.where(User.id.in_(favorite_ids))
    vendors = list((await db.execute(
        statement.order_by(func.lower(func.coalesce(User.shop_name, User.full_name)), User.id)
    )).scalars().all())
    if not vendors:
        return []

    vendor_ids = [vendor.id for vendor in vendors]
    favorites = set((await db.execute(
        select(user_favorite_vendors.c.vendor_id).where(
            user_favorite_vendors.c.user_id == current_user.id,
            user_favorite_vendors.c.vendor_id.in_(vendor_ids),
        )
    )).scalars().all())
    template_rows = (await db.execute(
        select(Design.vendor_id, Design.id).where(
            Design.vendor_id.in_(vendor_ids),
            Design.is_custom_request_template.is_(True),
        )
    )).all()
    template_ids = {vendor_id: design_id for vendor_id, design_id in template_rows}
    return [
        VendorDirectoryResponse(
            id=vendor.id,
            full_name=vendor.full_name,
            shop_name=vendor.shop_name or vendor.full_name,
            shop_description=vendor.shop_description,
            location=vendor.location,
            profile_image_url=vendor.profile_image_url,
            logo_url=vendor.vendor_logo_url,
            is_favorite=vendor.id in favorites,
            custom_design_id=template_ids.get(vendor.id),
            accepts_custom_orders=(
                vendor.vendor_pickup_latitude is not None
                and vendor.vendor_pickup_longitude is not None
            ),
        )
        for vendor in vendors
    ]


@router.get("/{vendor_id}", response_model=VendorDirectoryResponse)
async def get_vendor_directory_profile(
    vendor_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vendor = await db.get(User, vendor_id)
    if not vendor or vendor.role != UserRole.VENDOR.value or not vendor.is_active:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return await _directory_item(vendor, current_user, db)


@router.post("/{vendor_id}/favorite", status_code=status.HTTP_204_NO_CONTENT)
async def favorite_vendor(
    vendor_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vendor = await db.get(User, vendor_id)
    if not vendor or vendor.role != UserRole.VENDOR.value or not vendor.is_active:
        raise HTTPException(status_code=404, detail="Vendor not found")
    if vendor.id == current_user.id:
        raise HTTPException(status_code=409, detail="You cannot favorite your own shop")
    exists = await db.scalar(select(user_favorite_vendors.c.vendor_id).where(
        user_favorite_vendors.c.user_id == current_user.id,
        user_favorite_vendors.c.vendor_id == vendor_id,
    ))
    if not exists:
        await db.execute(user_favorite_vendors.insert().values(
            user_id=current_user.id, vendor_id=vendor_id
        ))
        await db.commit()


@router.delete("/{vendor_id}/favorite", status_code=status.HTTP_204_NO_CONTENT)
async def unfavorite_vendor(
    vendor_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(user_favorite_vendors.delete().where(
        user_favorite_vendors.c.user_id == current_user.id,
        user_favorite_vendors.c.vendor_id == vendor_id,
    ))
    await db.commit()


@router.post("/request", response_model=VendorApplicationResponse, status_code=status.HTTP_201_CREATED)
async def request_vendor_access(
    payload: VendorApplicationCreate,
    customer: User = Depends(require_customer),
    db: AsyncSession = Depends(get_db),
):
    if customer.vendor_request_status == "pending":
        raise HTTPException(status_code=409, detail="Your vendor request is already under review")
    customer.vendor_request_status = "pending"
    customer.vendor_request_shop_name = payload.shop_name
    customer.vendor_request_message = payload.message
    customer.vendor_request_review_comment = None
    customer.vendor_requested_at = datetime.now(timezone.utc)
    customer.vendor_request_reviewed_at = None
    customer.vendor_request_reviewed_by_id = None
    admin_ids = list((await db.execute(select(User.id).where(
        User.role.in_([UserRole.ADMIN.value, UserRole.SUPER_ADMIN.value]),
        User.is_active.is_(True),
    ))).scalars().all())
    db.add_all([
        Notification(
            user_id=admin_id,
            title="New vendor access request",
            message=f"{customer.full_name} applied to open {payload.shop_name}.",
            notification_type="vendor_request_submitted",
            link="/admin",
        )
        for admin_id in admin_ids
    ])
    await db.commit()
    await db.refresh(customer)
    return customer


@router.put("/profile", response_model=VendorApplicationResponse)
async def update_vendor_profile(
    payload: VendorProfileUpdate,
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    vendor.shop_name = payload.shop_name
    vendor.shop_description = payload.shop_description
    await db.execute(
        Design.__table__.update()
        .where(
            Design.vendor_id == vendor.id,
            Design.is_custom_request_template.is_(True),
        )
        .values(title=f"Custom tailoring with {payload.shop_name}")
    )
    await db.commit()
    await db.refresh(vendor)
    return vendor


@router.post("/{vendor_id}/custom-design", response_model=DesignResponse)
async def get_or_create_custom_design(
    vendor_id: int,
    buyer: User = Depends(require_buyer),
    db: AsyncSession = Depends(get_db),
):
    vendor = await db.get(User, vendor_id)
    if not vendor or vendor.role != UserRole.VENDOR.value or not vendor.is_active:
        raise HTTPException(status_code=404, detail="Vendor not found")
    if vendor.id == buyer.id:
        raise HTTPException(status_code=409, detail="You cannot order from your own shop")
    if vendor.vendor_pickup_latitude is None or vendor.vendor_pickup_longitude is None:
        raise HTTPException(status_code=409, detail="This vendor is not ready to accept delivery orders")

    design = await db.scalar(
        select(Design)
        .where(
            Design.vendor_id == vendor.id,
            Design.is_custom_request_template.is_(True),
        )
        .options(selectinload(Design.images), selectinload(Design.vendor))
    )
    if not design:
        design = Design(
            title=f"Custom tailoring with {vendor.shop_name or vendor.full_name}",
            description="A private custom tailoring request discussed directly with this vendor.",
            category="unisex",
            garment_type="general",
            base_price=0,
            vendor_id=vendor.id,
            status=DesignStatus.APPROVED.value,
            is_custom_request_template=True,
        )
        db.add(design)
        await db.commit()
        design = await db.scalar(
            select(Design)
            .where(Design.id == design.id)
            .options(selectinload(Design.images), selectinload(Design.vendor))
        )
    return await serialize_design_async(design)
