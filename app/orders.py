from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user, require_admin, require_customer, require_vendor
from app.database import get_db
from app.design_service import serialize_design
from app.models import (
    DeliveryAddress,
    Design,
    DesignStatus,
    MeasurementProfile,
    Notification,
    Order,
    OrderItem,
    OrderStatus,
    User,
)
from app.schemas import OrderCreate, OrderResponse, OrderStatusUpdate

router = APIRouter(prefix="/api/orders", tags=["orders"])
admin_router = APIRouter(prefix="/api/admin/orders", tags=["administration"])


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
        "standard_size": profile.standard_size,
        "unit": profile.unit,
        "measurements": profile.measurements,
        "notes": profile.notes,
    }


def _order_options():
    return (
        selectinload(Order.user),
        selectinload(Order.address),
        selectinload(Order.order_items).selectinload(OrderItem.measurement_profile),
        selectinload(Order.order_items)
        .selectinload(OrderItem.design)
        .selectinload(Design.images),
        selectinload(Order.order_items)
        .selectinload(OrderItem.design)
        .selectinload(Design.vendor),
    )


def serialize_order(order: Order, items: Optional[list[OrderItem]] = None) -> dict:
    selected_items = items if items is not None else list(order.order_items)
    return {
        "id": order.id,
        "total_amount": sum(item.price for item in selected_items),
        "status": order.status.value if isinstance(order.status, OrderStatus) else order.status,
        "tracking_number": order.tracking_number,
        "created_at": order.created_at,
        "customer": order.user,
        "delivery_address": order.address,
        "order_items": [
            {
                "id": item.id,
                "design": serialize_design(item.design),
                "measurement_profile": item.measurement_profile,
                "fabric_choice": item.fabric_choice,
                "custom_instructions": item.custom_instructions,
                "measurement_snapshot": item.measurement_snapshot,
                "price": item.price,
            }
            for item in selected_items
        ],
    }


async def _loaded_order(order_id: int, db: AsyncSession) -> Order | None:
    result = await db.execute(
        select(Order).where(Order.id == order_id).options(*_order_options())
    )
    return result.scalar_one_or_none()


@router.post("", response_model=OrderResponse, status_code=201)
async def create_order(
    order_data: OrderCreate,
    current_user: User = Depends(require_customer),
    db: AsyncSession = Depends(get_db),
):
    if not order_data.items:
        raise HTTPException(status_code=400, detail="Order must contain at least one item")
    if len(order_data.items) > 10:
        raise HTTPException(status_code=400, detail="An order can contain at most 10 items")

    address = await db.get(DeliveryAddress, order_data.address_id)
    if not address or address.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Delivery address not found")

    total_amount = 0.0
    items_to_create = []
    vendor_order_titles: dict[int, list[str]] = {}
    for item in order_data.items:
        result = await db.execute(
            select(Design)
            .where(Design.id == item.design_id)
            .options(selectinload(Design.vendor))
        )
        design = result.scalar_one_or_none()
        if not design or design.status != DesignStatus.APPROVED.value:
            raise HTTPException(status_code=404, detail=f"Design {item.design_id} not found")

        profile = await db.get(MeasurementProfile, item.measurement_profile_id)
        if not profile or profile.user_id != current_user.id:
            raise HTTPException(
                status_code=404,
                detail=f"Measurement profile {item.measurement_profile_id} not found",
            )

        item_price = compute_item_price(design, item.fabric_choice)
        total_amount += item_price
        if design.vendor_id:
            vendor_order_titles.setdefault(design.vendor_id, []).append(design.title)
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
        await db.flush()
        for vendor_id, design_titles in vendor_order_titles.items():
            db.add(
                Notification(
                    user_id=vendor_id,
                    title=f"New order #{new_order.id}",
                    message=f"A customer ordered {', '.join(design_titles)}.",
                    notification_type="new_order",
                    link="/orders",
                )
            )
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=500, detail="Could not create order, please try again")

    loaded = await _loaded_order(new_order.id, db)
    return serialize_order(loaded)


@router.get("", response_model=List[OrderResponse])
async def get_my_orders(
    current_user: User = Depends(require_customer),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Order)
        .where(Order.user_id == current_user.id)
        .options(*_order_options())
        .order_by(Order.created_at.desc())
    )
    return [serialize_order(order) for order in result.scalars().all()]


@router.get("/vendor", response_model=List[OrderResponse])
async def get_vendor_orders(
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Order)
        .join(Order.order_items)
        .join(OrderItem.design)
        .where(Design.vendor_id == vendor.id)
        .options(*_order_options())
        .order_by(Order.created_at.desc())
    )
    orders = result.scalars().unique().all()
    return [
        serialize_order(
            order,
            [item for item in order.order_items if item.design.vendor_id == vendor.id],
        )
        for order in orders
    ]


@router.get("/{order_id}", response_model=OrderResponse)
async def get_order(
    order_id: int,
    current_user: User = Depends(require_customer),
    db: AsyncSession = Depends(get_db),
):
    order = await _loaded_order(order_id, db)
    if not order or order.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Order not found")
    return serialize_order(order)


@admin_router.get("", response_model=List[OrderResponse])
async def list_all_orders(
    order_status: Optional[OrderStatus] = Query(default=None, alias="status"),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    statement = select(Order).options(*_order_options()).order_by(Order.created_at.desc())
    if order_status:
        statement = statement.where(Order.status == order_status)
    result = await db.execute(statement)
    return [serialize_order(order) for order in result.scalars().unique().all()]


@admin_router.patch("/{order_id}/status", response_model=OrderResponse)
async def update_order_status(
    order_id: int,
    payload: OrderStatusUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    order = await db.scalar(select(Order).where(Order.id == order_id).with_for_update())
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if payload.status == OrderStatus.SHIPPED and not payload.tracking_number:
        raise HTTPException(status_code=422, detail="Add a tracking number before marking the order shipped")

    order.status = payload.status
    order.tracking_number = payload.tracking_number.strip() if payload.tracking_number else None
    db.add(
        Notification(
            user_id=order.user_id,
            title=f"Order #{order.id} updated",
            message=f"Your order is now {payload.status.value.replace('_', ' ')}.",
            notification_type="order_status",
            link="/orders",
        )
    )
    await db.commit()
    loaded = await _loaded_order(order.id, db)
    return serialize_order(loaded)
