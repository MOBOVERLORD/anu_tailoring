from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import Order, OrderItem, Design, MeasurementProfile, DeliveryAddress, User
from app.schemas import OrderCreate, OrderResponse
from app.auth import get_current_user

router = APIRouter(prefix="/api/orders", tags=["orders"])


# --- Pricing (OCP: new fabric tiers / add-ons plug in here without touching create_order) ---
FABRIC_PRICE_MODIFIERS = {
    "cotton": 0.0,
    "linen": 15.0,
    "silk": 45.0,
    "wool": 30.0,
}


def compute_item_price(design: Design, fabric_choice: str | None) -> float:
    modifier = FABRIC_PRICE_MODIFIERS.get((fabric_choice or "").lower(), 0.0)
    return design.base_price + modifier


def snapshot_measurements(profile: MeasurementProfile) -> dict:
    return {
        "profile_name": profile.profile_name,
        "gender": profile.gender,
        "garment_type": profile.garment_type,
        "unit": profile.unit,
        "measurements": profile.measurements,
        "chest": profile.chest,
        "waist": profile.waist,
        "hips": profile.hips,
        "shoulder_width": profile.shoulder_width,
        "sleeve_length": profile.sleeve_length,
        "inseam": profile.inseam,
        "neck": profile.neck,
        "height": profile.height,
        "notes": profile.notes,
    }


@router.post("", response_model=OrderResponse, status_code=201)
async def create_order(
    order_data: OrderCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not order_data.items:
        raise HTTPException(status_code=400, detail="Order must contain at least one item")

    address = await db.get(DeliveryAddress, order_data.address_id)
    if not address or address.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Delivery address not found")

    total_amount = 0.0
    items_to_create = []

    for item in order_data.items:
        design = await db.get(Design, item.design_id)
        if not design:
            raise HTTPException(status_code=404, detail=f"Design {item.design_id} not found")

        profile = await db.get(MeasurementProfile, item.measurement_profile_id)
        if not profile or profile.user_id != current_user.id:
            raise HTTPException(
                status_code=404,
                detail=f"Measurement profile {item.measurement_profile_id} not found",
            )

        item_price = compute_item_price(design, item.fabric_choice)
        total_amount += item_price
        items_to_create.append(
            OrderItem(
                design_id=design.id,
                measurement_profile_id=profile.id,
                fabric_choice=item.fabric_choice,
                custom_instructions=item.custom_instructions,
                price=item_price,
                measurement_snapshot=snapshot_measurements(profile),
            )
        )

    new_order = Order(
        user_id=current_user.id,
        address_id=order_data.address_id,
        total_amount=total_amount,
        order_items=items_to_create,
    )

    try:
        db.add(new_order)
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=500, detail="Could not create order, please try again")

    result = await db.execute(
        select(Order)
        .options(selectinload(Order.order_items).selectinload(OrderItem.design))
        .options(selectinload(Order.order_items).selectinload(OrderItem.measurement_profile))
        .where(Order.id == new_order.id)
    )
    return result.scalar_one()


@router.get("", response_model=List[OrderResponse])
async def get_my_orders(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Order)
        .options(selectinload(Order.order_items).selectinload(OrderItem.design))
        .options(selectinload(Order.order_items).selectinload(OrderItem.measurement_profile))
        .where(Order.user_id == current_user.id)
        .order_by(Order.created_at.desc())
    )
    return result.scalars().all()


@router.get("/{order_id}", response_model=OrderResponse)
async def get_order(
    order_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Order)
        .options(selectinload(Order.order_items).selectinload(OrderItem.design))
        .options(selectinload(Order.order_items).selectinload(OrderItem.measurement_profile))
        .where(Order.id == order_id)
    )
    order = result.scalar_one_or_none()
    if not order or order.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Order not found")
    return order
