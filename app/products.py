from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import PurePath
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user, require_admin, require_buyer, require_vendor
from app.config import settings
from app.database import get_db
from app.deliveries import delivery_from_prepared, prepare_delivery_quotes, serialize_order_delivery
from app.models import (
    Delivery,
    DeliveryAddress,
    DesignStatus,
    Notification,
    Product,
    ProductImage,
    ProductOrder,
    User,
    UserRole,
)
from app.product_service import serialize_product
from app.schemas import (
    ProductCreate,
    ProductOrderCreate,
    ProductOrderListResponse,
    ProductOrderResponse,
    ProductOrderStatusUpdate,
    ProductResponse,
    ProductReviewRequest,
    ProductUpdate,
)
from app.storage import (
    bucket_name,
    delete_objects,
    product_image_object_name,
    safe_extension,
    upload_image_object,
    validate_image_bytes,
)


catalog_router = APIRouter(prefix="/api/products", tags=["shop"])
vendor_router = APIRouter(prefix="/api/vendor/products", tags=["vendor products"])
admin_router = APIRouter(prefix="/api/admin/products", tags=["administration"])
orders_router = APIRouter(prefix="/api/product-orders", tags=["shop orders"])
admin_orders_router = APIRouter(prefix="/api/admin/product-orders", tags=["administration"])


def _product_options():
    return (selectinload(Product.vendor), selectinload(Product.images))


def _order_options():
    return (
        selectinload(ProductOrder.user),
        selectinload(ProductOrder.vendor),
        selectinload(ProductOrder.address),
        selectinload(ProductOrder.product).selectinload(Product.vendor),
        selectinload(ProductOrder.product).selectinload(Product.images),
        selectinload(ProductOrder.delivery).selectinload(Delivery.vendor),
    )


def _serialize_order(order: ProductOrder) -> dict:
    delivery = serialize_order_delivery(order.delivery)
    return {
        "id": order.id,
        "product": serialize_product(order.product),
        "customer": order.user,
        "delivery_address": order.address,
        "quantity": order.quantity,
        "selected_size": order.selected_size,
        "selected_color": order.selected_color,
        "unit_price": order.unit_price,
        "merchandise_total": order.merchandise_total,
        "total_amount": round(order.merchandise_total + delivery["delivery_cost"], 2),
        "status": order.status,
        "delivery": delivery,
        "created_at": order.created_at,
        "updated_at": order.updated_at,
    }


async def _load_product(product_id: int, db: AsyncSession) -> Optional[Product]:
    return await db.scalar(
        select(Product).where(Product.id == product_id).options(*_product_options())
    )


async def _owned_product(
    product_id: int, vendor: User, db: AsyncSession, *, for_update: bool = False
) -> Product:
    query = (
        select(Product)
        .where(Product.id == product_id, Product.vendor_id == vendor.id)
        .options(*_product_options())
    )
    if for_update:
        query = query.with_for_update()
    product = await db.scalar(query)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


def _move_to_draft(product: Product) -> None:
    product.status = DesignStatus.DRAFT.value
    product.rejection_comment = None
    product.reviewed_by_id = None
    product.reviewed_at = None


def _ensure_editable(product: Product) -> None:
    if product.status == DesignStatus.SUBMITTED.value:
        raise HTTPException(status_code=409, detail="A product under review cannot be changed")


@catalog_router.get("", response_model=list[ProductResponse])
async def list_products(
    q: Optional[str] = Query(default=None, max_length=100),
    product_type: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    filters = [
        Product.status == DesignStatus.APPROVED.value,
        Product.stock_quantity > 0,
        User.is_active.is_(True),
    ]
    if q:
        term = f"%{q.strip()}%"
        filters.append(or_(Product.title.ilike(term), Product.description.ilike(term)))
    if product_type:
        filters.append(Product.product_type == product_type)
    if category:
        filters.append(Product.category == category)
    rows = await db.execute(
        select(Product)
        .join(Product.vendor)
        .where(*filters)
        .options(*_product_options())
        .order_by(Product.updated_at.desc())
    )
    return [serialize_product(item) for item in rows.scalars().unique().all()]


@catalog_router.get("/{product_id}", response_model=ProductResponse)
async def get_product(
    product_id: int,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    product = await _load_product(product_id, db)
    if not product or product.status != DesignStatus.APPROVED.value or not product.vendor.is_active:
        raise HTTPException(status_code=404, detail="Product not found")
    return serialize_product(product)


@vendor_router.get("", response_model=list[ProductResponse])
async def list_vendor_products(
    vendor: User = Depends(require_vendor), db: AsyncSession = Depends(get_db)
):
    rows = await db.execute(
        select(Product)
        .where(Product.vendor_id == vendor.id)
        .options(*_product_options())
        .order_by(Product.updated_at.desc())
    )
    return [serialize_product(item) for item in rows.scalars().all()]


@vendor_router.post("", response_model=ProductResponse, status_code=status.HTTP_201_CREATED)
async def create_product(
    payload: ProductCreate,
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    values = payload.model_dump()
    values["price"] = float(values["price"])
    values["stock_quantity"] = float(values["stock_quantity"])
    product = Product(**values, vendor_id=vendor.id, status=DesignStatus.DRAFT.value)
    db.add(product)
    await db.commit()
    return serialize_product(await _owned_product(product.id, vendor, db))


@vendor_router.put("/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: int,
    payload: ProductUpdate,
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    product = await _owned_product(product_id, vendor, db, for_update=True)
    _ensure_editable(product)
    values = payload.model_dump()
    values["price"] = float(values["price"])
    values["stock_quantity"] = float(values["stock_quantity"])
    for key, value in values.items():
        setattr(product, key, value)
    _move_to_draft(product)
    await db.commit()
    return serialize_product(await _owned_product(product_id, vendor, db))


@vendor_router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(
    product_id: int,
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    product = await _owned_product(product_id, vendor, db, for_update=True)
    reference = await db.scalar(select(ProductOrder.id).where(ProductOrder.product_id == product.id).limit(1))
    if reference:
        raise HTTPException(status_code=409, detail="This product belongs to an order and cannot be deleted")
    await run_in_threadpool(delete_objects, [image.object_name for image in product.images])
    await db.delete(product)
    await db.commit()


@vendor_router.post(
    "/{product_id}/images",
    response_model=ProductResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_product_image(
    product_id: int,
    file: UploadFile = File(...),
    sort_order: int = Form(0),
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    product = await _owned_product(product_id, vendor, db, for_update=True)
    _ensure_editable(product)
    if len(product.images) >= 10:
        raise HTTPException(status_code=409, detail="A product can contain at most 10 images")
    if not 0 <= sort_order <= 9:
        raise HTTPException(status_code=400, detail="Image sort order must be between 0 and 9")
    content_type = (file.content_type or "").lower()
    if content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, and WebP images are supported")
    max_bytes = settings.MAX_DESIGN_IMAGE_MB * 1024 * 1024
    try:
        data = await file.read(max_bytes + 1)
    finally:
        await file.close()
    if not data or len(data) > max_bytes:
        raise HTTPException(status_code=400, detail=f"Each image must be at most {settings.MAX_DESIGN_IMAGE_MB} MB")
    validate_image_bytes(data, content_type)
    filename = PurePath(file.filename or "image").name
    object_name = product_image_object_name(
        vendor.id, product.id, uuid4().hex, safe_extension(filename, content_type)
    )
    await run_in_threadpool(upload_image_object, object_name, content_type, data)
    db.add(ProductImage(
        product_id=product.id,
        bucket_name=bucket_name(),
        object_name=object_name,
        original_filename=filename,
        content_type=content_type,
        size_bytes=len(data),
        sort_order=sort_order,
    ))
    _move_to_draft(product)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        await run_in_threadpool(delete_objects, [object_name])
        raise
    return serialize_product(await _owned_product(product_id, vendor, db))


@vendor_router.delete("/{product_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product_image(
    product_id: int,
    image_id: int,
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    product = await _owned_product(product_id, vendor, db, for_update=True)
    _ensure_editable(product)
    image = next((item for item in product.images if item.id == image_id), None)
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    await run_in_threadpool(delete_objects, [image.object_name])
    await db.delete(image)
    _move_to_draft(product)
    await db.commit()


@vendor_router.post("/{product_id}/submit", response_model=ProductResponse)
async def submit_product(
    product_id: int,
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    product = await _owned_product(product_id, vendor, db, for_update=True)
    if product.status not in {DesignStatus.DRAFT.value, DesignStatus.REJECTED.value}:
        raise HTTPException(status_code=409, detail="Only a draft or rejected product can be submitted")
    if not 1 <= len([image for image in product.images if image.upload_status == "ready"]) <= 10:
        raise HTTPException(status_code=409, detail="Add between 1 and 10 images before submitting")
    product.status = DesignStatus.SUBMITTED.value
    product.rejection_comment = None
    admins = (await db.execute(select(User).where(
        User.role.in_([UserRole.ADMIN.value, UserRole.SUPER_ADMIN.value]),
        User.is_active.is_(True),
    ))).scalars().all()
    for admin in admins:
        db.add(Notification(
            user_id=admin.id,
            title="Shop product awaiting review",
            message=f'{vendor.full_name} submitted "{product.title}" for sale.',
            notification_type="product_submitted",
            link="/admin",
        ))
    await db.commit()
    return serialize_product(await _owned_product(product_id, vendor, db))


@admin_router.get("", response_model=list[ProductResponse])
async def list_products_for_review(
    review_status: str = Query(default=DesignStatus.SUBMITTED.value, alias="status"),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if review_status not in {item.value for item in DesignStatus}:
        raise HTTPException(status_code=400, detail="Invalid product status")
    rows = await db.execute(
        select(Product).where(Product.status == review_status).options(*_product_options()).order_by(Product.updated_at.asc())
    )
    return [serialize_product(item) for item in rows.scalars().all()]


@admin_router.post("/{product_id}/review", response_model=ProductResponse)
async def review_product(
    product_id: int,
    payload: ProductReviewRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    product = await db.scalar(select(Product).where(Product.id == product_id).options(*_product_options()).with_for_update())
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if product.status != DesignStatus.SUBMITTED.value:
        raise HTTPException(status_code=409, detail="Only submitted products can be reviewed")
    comment = payload.comment.strip() if payload.comment else None
    if payload.decision == DesignStatus.REJECTED.value and not comment:
        raise HTTPException(status_code=422, detail="A rejection comment is required")
    if payload.decision == DesignStatus.APPROVED.value and not product.images:
        raise HTTPException(status_code=409, detail="A product must have an image")
    product.status = payload.decision
    product.rejection_comment = comment if payload.decision == DesignStatus.REJECTED.value else None
    product.reviewed_by_id = admin.id
    product.reviewed_at = datetime.now(timezone.utc)
    outcome = "approved" if payload.decision == DesignStatus.APPROVED.value else "needs changes"
    message = f'Your shop product "{product.title}" was {outcome}.'
    if comment:
        message += f" Reviewer note: {comment}"
    db.add(Notification(
        user_id=product.vendor_id,
        title=f"Product {outcome}",
        message=message,
        notification_type=f"product_{payload.decision}",
        link="/vendor/products",
    ))
    await db.commit()
    return serialize_product(await _load_product(product_id, db))


@orders_router.post("", response_model=ProductOrderResponse, status_code=status.HTTP_201_CREATED)
async def create_product_order(
    payload: ProductOrderCreate,
    customer: User = Depends(require_buyer),
    db: AsyncSession = Depends(get_db),
):
    product = await db.scalar(
        select(Product).where(Product.id == payload.product_id).options(*_product_options()).with_for_update()
    )
    if not product or product.status != DesignStatus.APPROVED.value or not product.vendor.is_active:
        raise HTTPException(status_code=404, detail="Product not found")
    if product.vendor_id == customer.id:
        raise HTTPException(status_code=409, detail="You cannot order your own product")
    address = await db.get(DeliveryAddress, payload.address_id)
    if not address or address.user_id != customer.id:
        raise HTTPException(status_code=404, detail="Delivery address not found")
    quantity = Decimal(payload.quantity)
    if product.unit == "piece" and quantity != quantity.to_integral_value():
        raise HTTPException(status_code=422, detail="Ready-made item quantity must be a whole number")
    if product.sizes and payload.selected_size not in product.sizes:
        raise HTTPException(status_code=422, detail="Choose an available size")
    if product.colors and payload.selected_color not in product.colors:
        raise HTTPException(status_code=422, detail="Choose an available color")
    if Decimal(str(product.stock_quantity)) < quantity:
        raise HTTPException(status_code=409, detail="The requested quantity is no longer in stock")
    quote = (await prepare_delivery_quotes(
        [product.vendor], address, db, {product.vendor_id: payload.delivery_quote_token}
    ))[0]
    merchandise_total = (Decimal(str(product.price)) * quantity).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    order = ProductOrder(
        user_id=customer.id,
        vendor_id=product.vendor_id,
        product_id=product.id,
        address_id=address.id,
        quantity=float(quantity),
        selected_size=payload.selected_size,
        selected_color=payload.selected_color,
        unit_price=product.price,
        merchandise_total=float(merchandise_total),
    )
    db.add(order)
    await db.flush()
    db.add(delivery_from_prepared(quote, product_order_id=order.id))
    product.stock_quantity = float(Decimal(str(product.stock_quantity)) - quantity)
    db.add(Notification(
        user_id=product.vendor_id,
        title=f"New shop order #{order.id}",
        message=f'{customer.full_name} ordered {quantity} {product.unit} of "{product.title}".',
        notification_type="product_order_placed",
        link="/vendor/sales-orders",
    ))
    await db.commit()
    loaded = await db.scalar(select(ProductOrder).where(ProductOrder.id == order.id).options(*_order_options()))
    return _serialize_order(loaded)


async def _list_orders(query, limit: int, offset: int, db: AsyncSession) -> dict:
    total = await db.scalar(select(func.count()).select_from(query.order_by(None).subquery()))
    rows = await db.execute(query.options(*_order_options()).order_by(ProductOrder.created_at.desc()).limit(limit).offset(offset))
    return {"items": [_serialize_order(item) for item in rows.scalars().all()], "total": total or 0, "limit": limit, "offset": offset}


@orders_router.get("", response_model=ProductOrderListResponse)
async def list_customer_product_orders(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=100_000),
    customer: User = Depends(require_buyer),
    db: AsyncSession = Depends(get_db),
):
    return await _list_orders(select(ProductOrder).where(ProductOrder.user_id == customer.id), limit, offset, db)


@orders_router.get("/vendor", response_model=ProductOrderListResponse)
async def list_vendor_product_orders(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=100_000),
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await _list_orders(select(ProductOrder).where(ProductOrder.vendor_id == vendor.id), limit, offset, db)


@admin_orders_router.get("", response_model=ProductOrderListResponse)
async def list_admin_product_orders(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=100_000),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await _list_orders(select(ProductOrder), limit, offset, db)


async def _change_order_status(order: ProductOrder, new_status: str, actor: User, db: AsyncSession) -> ProductOrder:
    transitions = {
        "placed": {"confirmed", "cancelled"},
        "confirmed": {"packed", "cancelled"},
        "packed": {"shipped", "cancelled"},
        "shipped": {"delivered"},
        "delivered": set(),
        "cancelled": set(),
    }
    if new_status not in transitions.get(order.status, set()):
        raise HTTPException(status_code=409, detail=f"Cannot change {order.status} order to {new_status}")
    if new_status == "cancelled":
        product = await db.get(Product, order.product_id, with_for_update=True)
        product.stock_quantity += order.quantity
    order.status = new_status
    if new_status == "shipped":
        order.delivery.status = "in_transit"
        order.delivery.status_updated_at = datetime.now(timezone.utc)
    elif new_status == "delivered":
        order.delivery.status = "delivered"
        order.delivery.status_updated_at = datetime.now(timezone.utc)
    target_id = order.vendor_id if new_status == "cancelled" and actor.id == order.user_id else order.user_id
    db.add(Notification(
        user_id=target_id,
        title=f"Shop order #{order.id} updated",
        message=f'Your order for "{order.product.title}" is now {new_status.replace("_", " ")}.',
        notification_type="product_order_status",
        link="/vendor/sales-orders" if target_id == order.vendor_id else "/orders",
    ))
    await db.commit()
    return await db.scalar(select(ProductOrder).where(ProductOrder.id == order.id).options(*_order_options()))


@orders_router.patch("/{order_id}/status", response_model=ProductOrderResponse)
async def update_product_order_status(
    order_id: int,
    payload: ProductOrderStatusUpdate,
    actor: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    order = await db.scalar(select(ProductOrder).where(ProductOrder.id == order_id).options(*_order_options()).with_for_update())
    if not order:
        raise HTTPException(status_code=404, detail="Shop order not found")
    is_staff = actor.role in {UserRole.ADMIN.value, UserRole.SUPER_ADMIN.value}
    if actor.role == UserRole.CUSTOMER.value:
        if order.user_id != actor.id or payload.status != "cancelled":
            raise HTTPException(status_code=403, detail="You cannot update this order")
    elif actor.role == UserRole.VENDOR.value:
        if order.user_id == actor.id:
            if payload.status != "cancelled":
                raise HTTPException(status_code=403, detail="Buyers can only cancel a newly placed order")
        elif order.vendor_id != actor.id:
            raise HTTPException(status_code=403, detail="You cannot update this order")
    elif not is_staff:
        raise HTTPException(status_code=403, detail="You cannot update this order")
    return _serialize_order(await _change_order_status(order, payload.status, actor, db))
