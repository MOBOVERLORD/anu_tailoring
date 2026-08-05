import asyncio
from datetime import datetime, timezone
from pathlib import PurePath
import re
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile, WebSocket, WebSocketDisconnect, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, with_loader_criteria

from app.auth import create_chat_ticket, decode_chat_ticket, get_current_user, oauth2_scheme, require_admin, require_buyer, require_vendor
from app.database import AsyncSessionLocal, get_db
from app.design_service import serialize_design
from app.deliveries import (
    delivery_from_prepared,
    prepare_delivery_quotes,
    serialize_order_delivery,
)
from app.models import (
    AuthSession,
    Delivery,
    DeliveryAddress,
    Design,
    DesignStatus,
    MeasurementProfile,
    Notification,
    Order,
    OrderComment,
    OrderItem,
    OrderStatus,
    User,
    UserRole,
    VendorInvoice,
    VendorInvoiceLineItem,
)
from app.schemas import (
    InvoiceDecision,
    OrderCancellationRequest,
    OrderCommentCreate,
    OrderCommentResponse,
    OrderCreate,
    OrderItemResponse,
    OrderListResponse,
    OrderResponse,
    OrderStatusUpdate,
    PaymentReferenceCreate,
    VendorInvoiceUpsert,
)
from app.config import settings
from app.storage import (
    bucket_name,
    delete_objects,
    download_invoice_attachment,
    invoice_attachment_object_name,
    private_object_etag,
    upload_invoice_attachment,
    validate_invoice_attachment_bytes,
)

router = APIRouter(prefix="/api/orders", tags=["orders"])
admin_router = APIRouter(prefix="/api/admin/orders", tags=["administration"])


def compute_item_price(design: Design, fabric_choice: str | None) -> float:
    # A design's price is the vendor's tailoring service charge only. Cloth is
    # quoted later; delivery is calculated by the platform from route distance.
    return design.base_price


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
        selectinload(Order.deliveries).selectinload(Delivery.vendor),
        selectinload(Order.order_items).selectinload(OrderItem.measurement_profile),
        selectinload(Order.order_items)
        .selectinload(OrderItem.design)
        .selectinload(Design.images),
        selectinload(Order.order_items)
        .selectinload(OrderItem.design)
        .selectinload(Design.vendor),
        selectinload(Order.order_items).selectinload(OrderItem.invoice),
        selectinload(Order.order_items)
        .selectinload(OrderItem.invoice)
        .selectinload(VendorInvoice.line_items),
        selectinload(Order.order_items)
        .selectinload(OrderItem.comments)
        .selectinload(OrderComment.author),
    )


def serialize_invoice(invoice: VendorInvoice) -> dict:
    line_items = [
        {
            "id": item.id,
            "name": item.name,
            "description": item.description,
            "quantity": item.quantity,
            "unit_price": item.unit_price,
            "total_amount": round(item.quantity * item.unit_price, 2),
        }
        for item in invoice.line_items
    ]
    additional_amount = round(sum(item["total_amount"] for item in line_items), 2)
    return {
        "id": invoice.id,
        "invoice_number": invoice.invoice_number,
        "revision": invoice.revision,
        "service_amount": invoice.service_amount,
        "cloth_source": invoice.cloth_source,
        "cloth_type": invoice.cloth_type,
        "cloth_requirement": invoice.cloth_requirement,
        "cloth_cost": invoice.cloth_cost,
        "delivery_cost": invoice.delivery_cost,
        "line_items": line_items,
        "additional_amount": additional_amount,
        "total_amount": round((
            invoice.service_amount
            + invoice.cloth_cost
            + invoice.delivery_cost
            + additional_amount
        ), 2),
        "status": invoice.status,
        "payment_status": invoice.payment_status,
        "payment_reference": invoice.payment_reference,
        "cloth_received": invoice.cloth_received,
        "cloth_bill_filename": invoice.cloth_bill_original_filename,
        "cloth_bill_content_type": invoice.cloth_bill_content_type,
        "cloth_bill_size_bytes": invoice.cloth_bill_size_bytes,
        "cloth_bill_url": (
            f"/api/orders/items/{invoice.order_item_id}/invoice/cloth-bill"
            if invoice.cloth_bill_object_name
            else None
        ),
        "issued_at": invoice.issued_at,
        "approved_at": invoice.approved_at,
        "paid_at": invoice.paid_at,
        "created_at": invoice.created_at,
        "updated_at": invoice.updated_at,
    }


def serialize_order_item(item: OrderItem, include_draft_invoice: bool = True) -> dict:
    invoice = item.invoice
    visible_invoice = invoice if invoice and (include_draft_invoice or invoice.status != "draft") else None
    return {
        "id": item.id,
        "design": serialize_design(item.design),
        "measurement_profile": item.measurement_profile,
        "cloth_source": item.cloth_source,
        "fabric_choice": item.fabric_choice,
        "custom_instructions": item.custom_instructions,
        "measurement_snapshot": item.measurement_snapshot,
        "price": item.price,
        "work_status": item.work_status,
        "invoice": serialize_invoice(visible_invoice) if visible_invoice else None,
        "comments": [
            {
                "id": comment.id,
                "author_id": comment.author_id,
                "author_name": comment.author.full_name,
                "author_role": comment.author.role,
                "message": comment.message,
                "created_at": comment.created_at,
            }
            for comment in item.comments
        ],
    }


def serialize_order(
    order: Order,
    items: Optional[list[OrderItem]] = None,
    include_draft_invoices: bool = False,
) -> dict:
    selected_items = items if items is not None else list(order.order_items)
    selected_vendor_ids = {item.design.vendor_id for item in selected_items}
    selected_deliveries = (
        list(order.deliveries)
        if items is None
        else [delivery for delivery in order.deliveries if delivery.vendor_id in selected_vendor_ids]
    )
    inactive_work_statuses = {"cancelled", "rejected"}
    active_items = [
        item for item in selected_items if item.work_status not in inactive_work_statuses
    ]
    active_vendor_ids = {item.design.vendor_id for item in active_items}
    active_deliveries = [
        delivery for delivery in selected_deliveries
        if delivery.status != "cancelled" and delivery.vendor_id in active_vendor_ids
    ]
    service_amount = sum(item.price for item in active_items)
    total_amount = round(sum(
        item.invoice.service_amount
        + item.invoice.cloth_cost
        + item.invoice.delivery_cost
        + sum(line.quantity * line.unit_price for line in item.invoice.line_items)
        if item.invoice and (include_draft_invoices or item.invoice.status != "draft")
        else item.price
        for item in active_items
    ) + sum(delivery.delivery_cost for delivery in active_deliveries), 2)
    return {
        "id": order.id,
        "total_amount": total_amount,
        "service_amount": service_amount,
        "status": order.status.value if isinstance(order.status, OrderStatus) else order.status,
        "tracking_number": order.tracking_number,
        "created_at": order.created_at,
        "customer": order.user,
        "delivery_address": order.address,
        "deliveries": [serialize_order_delivery(delivery) for delivery in selected_deliveries],
        "order_items": [serialize_order_item(item, include_draft_invoices) for item in selected_items],
    }


async def _loaded_order(order_id: int, db: AsyncSession) -> Order | None:
    result = await db.execute(
        select(Order).where(Order.id == order_id).options(*_order_options())
    )
    return result.scalar_one_or_none()


async def _loaded_order_item(item_id: int, db: AsyncSession) -> OrderItem | None:
    result = await db.execute(
        select(OrderItem)
        .where(OrderItem.id == item_id)
        .execution_options(populate_existing=True)
        .options(
            selectinload(OrderItem.measurement_profile),
            selectinload(OrderItem.invoice),
            selectinload(OrderItem.invoice).selectinload(VendorInvoice.line_items),
            selectinload(OrderItem.comments).selectinload(OrderComment.author),
            selectinload(OrderItem.design).selectinload(Design.images),
            selectinload(OrderItem.design).selectinload(Design.vendor),
            selectinload(OrderItem.order).selectinload(Order.user),
            selectinload(OrderItem.order).selectinload(Order.address),
        )
    )
    return result.scalar_one_or_none()


async def _vendor_order_item(
    item_id: int,
    vendor: User,
    db: AsyncSession,
) -> OrderItem:
    # Serialize invoice/workflow mutations for this item. This prevents two
    # browser tabs from approving, paying, or starting the same job twice.
    await db.scalar(
        select(OrderItem.id).where(OrderItem.id == item_id).with_for_update()
    )
    item = await _loaded_order_item(item_id, db)
    if not item or item.design.vendor_id != vendor.id:
        raise HTTPException(status_code=404, detail="Vendor order item not found")
    return item


async def _customer_order_item(
    item_id: int,
    customer: User,
    db: AsyncSession,
) -> OrderItem:
    await db.scalar(
        select(OrderItem.id).where(OrderItem.id == item_id).with_for_update()
    )
    item = await _loaded_order_item(item_id, db)
    if not item or item.order.user_id != customer.id:
        raise HTTPException(status_code=404, detail="Order item not found")
    return item


async def _refreshed_item_response(
    item_id: int,
    db: AsyncSession,
    include_draft_invoice: bool,
) -> dict:
    item = await _loaded_order_item(item_id, db)
    if not item:
        raise HTTPException(status_code=404, detail="Order item not found")
    return serialize_order_item(item, include_draft_invoice)


@router.post("", response_model=OrderResponse, status_code=201)
async def create_order(
    order_data: OrderCreate,
    current_user: User = Depends(require_buyer),
    db: AsyncSession = Depends(get_db),
):
    if not order_data.items:
        raise HTTPException(status_code=400, detail="Order must contain at least one item")
    if len(order_data.items) > 10:
        raise HTTPException(status_code=400, detail="An order can contain at most 10 items")

    address = await db.get(DeliveryAddress, order_data.address_id)
    if not address or address.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Delivery address not found")

    design_ids = {item.design_id for item in order_data.items}
    profile_ids = {item.measurement_profile_id for item in order_data.items}
    designs = (
        await db.execute(
            select(Design)
            .where(Design.id.in_(design_ids))
            .options(selectinload(Design.vendor))
        )
    ).scalars().all()
    profiles = (
        await db.execute(
            select(MeasurementProfile).where(
                MeasurementProfile.id.in_(profile_ids),
                MeasurementProfile.user_id == current_user.id,
            )
        )
    ).scalars().all()
    designs_by_id = {design.id: design for design in designs}
    profiles_by_id = {profile.id: profile for profile in profiles}

    total_amount = 0.0
    items_to_create = []
    vendor_order_titles: dict[int, list[str]] = {}
    vendors_by_id: dict[int, User] = {}
    delivery_quote_tokens: dict[int, str] = {}
    for item in order_data.items:
        design = designs_by_id.get(item.design_id)
        if (
            not design
            or design.status != DesignStatus.APPROVED.value
            or (design.vendor and not design.vendor.is_active)
        ):
            raise HTTPException(status_code=404, detail=f"Design {item.design_id} not found")
        if design.vendor_id == current_user.id:
            raise HTTPException(status_code=409, detail="You cannot order your own design")

        profile = profiles_by_id.get(item.measurement_profile_id)
        if not profile:
            raise HTTPException(
                status_code=404,
                detail=f"Measurement profile {item.measurement_profile_id} not found",
            )

        item_price = compute_item_price(design, item.fabric_choice)
        total_amount = round(total_amount + item_price, 2)
        if not design.vendor_id or not design.vendor:
            raise HTTPException(
                status_code=409,
                detail=f"Design {item.design_id} is not connected to a delivery-ready vendor",
            )
        vendor_order_titles.setdefault(design.vendor_id, []).append(design.title)
        vendors_by_id[design.vendor_id] = design.vendor
        if item.delivery_quote_token:
            existing_token = delivery_quote_tokens.get(design.vendor_id)
            if existing_token and existing_token != item.delivery_quote_token:
                raise HTTPException(
                    status_code=409,
                    detail="Use one current delivery quote for each vendor in an order",
                )
            delivery_quote_tokens[design.vendor_id] = item.delivery_quote_token
        items_to_create.append(
            OrderItem(
                design_id=design.id,
                measurement_profile_id=profile.id,
                cloth_source=item.cloth_source,
                fabric_choice=item.fabric_choice,
                custom_instructions=item.custom_instructions,
                price=item_price,
                measurement_snapshot=snapshot_measurements(profile),
            )
        )

    delivery_quotes = await prepare_delivery_quotes(
        vendors_by_id.values(), address, db, delivery_quote_tokens
    )
    total_amount = round(
        total_amount + sum(quote.delivery_cost for quote in delivery_quotes), 2
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
        db.add_all([
            delivery_from_prepared(quote, order_id=new_order.id)
            for quote in delivery_quotes
        ])
        for vendor_id, design_titles in vendor_order_titles.items():
            db.add(
                Notification(
                    user_id=vendor_id,
                    title=f"New order #{new_order.id}",
                    message=f"A buyer ordered {', '.join(design_titles)}.",
                    notification_type="new_order",
                    link="/vendor/sales-orders",
                )
            )
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=500, detail="Could not create order, please try again")

    loaded = await _loaded_order(new_order.id, db)
    return serialize_order(loaded)


@router.get("", response_model=OrderListResponse)
async def get_my_orders(
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=100_000),
    current_user: User = Depends(require_buyer),
    db: AsyncSession = Depends(get_db),
):
    total = await db.scalar(
        select(func.count(Order.id)).where(Order.user_id == current_user.id)
    )
    result = await db.execute(
        select(Order)
        .where(Order.user_id == current_user.id)
        .options(*_order_options())
        .order_by(Order.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return {
        "items": [serialize_order(order) for order in result.scalars().all()],
        "total": total or 0,
        "limit": limit,
        "offset": offset,
    }


@router.post("/{order_id}/cancel", response_model=OrderResponse)
async def cancel_customer_order(
    order_id: int,
    payload: OrderCancellationRequest,
    customer: User = Depends(require_buyer),
    db: AsyncSession = Depends(get_db),
):
    await db.scalar(select(Order.id).where(Order.id == order_id).with_for_update())
    order = await _loaded_order(order_id, db)
    if not order or order.user_id != customer.id:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status == OrderStatus.CANCELLED:
        raise HTTPException(status_code=409, detail="This order is already cancelled")
    if order.status in {OrderStatus.SHIPPED, OrderStatus.DELIVERED}:
        raise HTTPException(status_code=409, detail="An order already dispatched cannot be cancelled")
    if any(item.invoice and item.invoice.status == "approved" for item in order.order_items):
        raise HTTPException(
            status_code=409,
            detail="This order cannot be cancelled because an invoice has already been accepted",
        )

    vendor_ids: set[int] = set()
    for item in order.order_items:
        if item.work_status not in {"cancelled", "rejected"}:
            item.work_status = "cancelled"
        vendor_ids.add(item.design.vendor_id)
        db.add(OrderComment(
            order_item_id=item.id,
            author_id=customer.id,
            message=f"Customer cancelled the order: {payload.reason}",
        ))
    for delivery in order.deliveries:
        delivery.status = "cancelled"
        delivery.status_updated_at = datetime.now(timezone.utc)
    order.status = OrderStatus.CANCELLED
    order.total_amount = 0
    for vendor_id in vendor_ids:
        db.add(Notification(
            user_id=vendor_id,
            title=f"Order #{order.id} cancelled",
            message=f"{customer.full_name} cancelled the order. Reason: {payload.reason}",
            notification_type="order_cancelled",
            link="/vendor/sales-orders",
        ))
    await db.commit()
    return serialize_order(await _loaded_order(order.id, db))


@router.get("/vendor", response_model=OrderListResponse)
async def get_vendor_orders(
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=100_000),
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    vendor_order_ids = (
        select(Order.id)
        .join(Order.order_items)
        .join(OrderItem.design)
        .where(Design.vendor_id == vendor.id)
        .distinct()
    )
    total = await db.scalar(select(func.count()).select_from(vendor_order_ids.subquery()))
    result = await db.execute(
        select(Order)
        .join(Order.order_items)
        .join(OrderItem.design)
        .where(Design.vendor_id == vendor.id)
        .options(
            *_order_options(),
            with_loader_criteria(
                OrderItem,
                OrderItem.design.has(Design.vendor_id == vendor.id),
                include_aliases=True,
            ),
        )
        .order_by(Order.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    orders = result.scalars().unique().all()
    return {
        "items": [
        serialize_order(
            order,
            list(order.order_items),
            include_draft_invoices=True,
        )
        for order in orders
        ],
        "total": total or 0,
        "limit": limit,
        "offset": offset,
    }


@router.post("/vendor/items/{item_id}/reject", response_model=OrderResponse)
async def reject_vendor_order_item(
    item_id: int,
    payload: OrderCancellationRequest,
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    item = await _vendor_order_item(item_id, vendor, db)
    if item.work_status in {"rejected", "cancelled"}:
        raise HTTPException(status_code=409, detail="This order item is already closed")
    if item.invoice and item.invoice.status == "approved":
        raise HTTPException(
            status_code=409,
            detail="This order cannot be rejected because the customer already accepted the invoice",
        )

    item.work_status = "rejected"
    db.add(OrderComment(
        order_item_id=item.id,
        author_id=vendor.id,
        message=f"Vendor rejected this order item: {payload.reason}",
    ))
    other_vendor_item = await db.scalar(
        select(OrderItem.id)
        .join(OrderItem.design)
        .where(
            OrderItem.order_id == item.order_id,
            OrderItem.id != item.id,
            Design.vendor_id == vendor.id,
            OrderItem.work_status.notin_(["rejected", "cancelled"]),
        )
        .limit(1)
    )
    delivery_cost = 0.0
    if not other_vendor_item:
        delivery = await db.scalar(select(Delivery).where(
            Delivery.order_id == item.order_id,
            Delivery.vendor_id == vendor.id,
        ))
        if delivery and delivery.status != "cancelled":
            delivery_cost = delivery.delivery_cost
            delivery.status = "cancelled"
            delivery.status_updated_at = datetime.now(timezone.utc)

    other_active_item = await db.scalar(
        select(OrderItem.id).where(
            OrderItem.order_id == item.order_id,
            OrderItem.id != item.id,
            OrderItem.work_status.notin_(["rejected", "cancelled"]),
        ).limit(1)
    )
    order = item.order
    order.total_amount = max(0, order.total_amount - item.price - delivery_cost)
    if not other_active_item:
        order.status = OrderStatus.CANCELLED
    db.add(Notification(
        user_id=order.user_id,
        title=f"Order #{order.id} could not be accepted",
        message=f'{vendor.full_name} rejected "{item.design.title}". Reason: {payload.reason}',
        notification_type="order_rejected",
        link="/orders",
    ))
    await db.commit()
    loaded_order = await _loaded_order(order.id, db)
    vendor_items = [
        order_item for order_item in loaded_order.order_items
        if order_item.design.vendor_id == vendor.id
    ]
    return serialize_order(
        loaded_order,
        vendor_items,
        include_draft_invoices=True,
    )


@router.put("/vendor/items/{item_id}/invoice", response_model=OrderItemResponse)
async def save_vendor_invoice(
    item_id: int,
    payload: VendorInvoiceUpsert,
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    item = await _vendor_order_item(item_id, vendor, db)
    if item.work_status in {"rejected", "cancelled"}:
        raise HTTPException(status_code=409, detail="A closed order item cannot be invoiced")
    invoice = item.invoice
    if invoice and invoice.status not in {"draft", "change_requested"}:
        raise HTTPException(
            status_code=409,
            detail="The customer must request changes before an issued or approved invoice can be edited",
        )
    if invoice and payload.expected_revision != invoice.revision:
        raise HTTPException(
            status_code=409,
            detail="This invoice changed in another tab. Reopen it before saving again.",
        )
    if item.work_status != "awaiting_invoice":
        raise HTTPException(status_code=409, detail="This invoice can no longer be edited")
    if item.cloth_source == "customer_provided" and payload.cloth_cost != 0:
        raise HTTPException(
            status_code=422,
            detail="Cloth cost must be zero when the customer provides the cloth",
        )

    if not invoice:
        invoice = VendorInvoice(
            order_item_id=item.id,
            invoice_number=f"AT-{item.order_id:06d}-{item.id:04d}",
            service_amount=item.price,
            cloth_source=item.cloth_source,
            cloth_type=payload.cloth_type,
            cloth_requirement=payload.cloth_requirement,
            cloth_cost=float(payload.cloth_cost),
            delivery_cost=0,
        )
        invoice.line_items = [
            VendorInvoiceLineItem(
                name=line.name,
                description=line.description,
                quantity=float(line.quantity),
                unit_price=float(line.unit_price),
            )
            for line in payload.line_items
        ]
        db.add(invoice)
    else:
        invoice.service_amount = item.price
        invoice.cloth_source = item.cloth_source
        invoice.cloth_type = payload.cloth_type
        invoice.cloth_requirement = payload.cloth_requirement
        invoice.cloth_cost = float(payload.cloth_cost)
        invoice.delivery_cost = 0
        invoice.line_items = [
            VendorInvoiceLineItem(
                name=line.name,
                description=line.description,
                quantity=float(line.quantity),
                unit_price=float(line.unit_price),
            )
            for line in payload.line_items
        ]
        invoice.status = "draft"
        invoice.revision += 1
        invoice.payment_status = "not_required"
        invoice.payment_reference = None
        invoice.cloth_received = False
        invoice.issued_at = None
        invoice.approved_at = None
        invoice.paid_at = None
    item.work_status = "awaiting_invoice"
    await db.commit()
    return await _refreshed_item_response(item.id, db, True)


@router.post("/vendor/items/{item_id}/invoice/issue", response_model=OrderItemResponse)
async def issue_vendor_invoice(
    item_id: int,
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    item = await _vendor_order_item(item_id, vendor, db)
    if item.work_status in {"rejected", "cancelled"}:
        raise HTTPException(status_code=409, detail="A closed order item cannot be invoiced")
    invoice = item.invoice
    if not invoice:
        raise HTTPException(status_code=409, detail="Create the invoice before sending it")
    if invoice.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft invoice can be sent")
    invoice.status = "issued"
    invoice.issued_at = datetime.now(timezone.utc)
    item.work_status = "awaiting_approval"
    db.add(Notification(
        user_id=item.order.user_id,
        title=f"Invoice ready for order #{item.order_id}",
        message=f"{vendor.full_name} sent the invoice and cloth requirements for {item.design.title}.",
        notification_type="invoice_issued",
        link="/orders",
    ))
    await db.commit()
    return await _refreshed_item_response(item.id, db, True)


@router.post(
    "/vendor/items/{item_id}/invoice/cloth-bill",
    response_model=OrderItemResponse,
)
async def upload_cloth_bill(
    item_id: int,
    file: UploadFile = File(...),
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    item = await _vendor_order_item(item_id, vendor, db)
    invoice = item.invoice
    if (
        not invoice
        or invoice.status != "approved"
        or invoice.cloth_source != "vendor_supplied"
        or invoice.cloth_cost <= 0
        or invoice.payment_status != "pending"
    ):
        raise HTTPException(
            status_code=409,
            detail="A cloth bill can be attached after the customer approves a vendor-supplied cloth quote",
        )

    content_type = (file.content_type or "").lower()
    allowed_types = {"application/pdf", "image/jpeg", "image/png", "image/webp"}
    if content_type not in allowed_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cloth bill proof must be a PDF, JPEG, PNG, or WebP file",
        )
    max_bytes = settings.MAX_INVOICE_ATTACHMENT_MB * 1024 * 1024
    try:
        data = await file.read(max_bytes + 1)
    finally:
        await file.close()
    if not data or len(data) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Cloth bill proof must be between 1 byte and "
                f"{settings.MAX_INVOICE_ATTACHMENT_MB} MB"
            ),
        )
    validate_invoice_attachment_bytes(data, content_type)
    filename = re.sub(
        r"[\x00-\x1f\x7f]",
        "",
        PurePath(file.filename or "cloth-bill").name,
    ).strip()[:255] or "cloth-bill"
    object_name = invoice_attachment_object_name(
        vendor.id,
        item.order_id,
        invoice.id,
        uuid4().hex,
        content_type,
    )
    await run_in_threadpool(upload_invoice_attachment, object_name, content_type, data)
    old_object_name = invoice.cloth_bill_object_name
    invoice.cloth_bill_bucket_name = bucket_name()
    invoice.cloth_bill_object_name = object_name
    invoice.cloth_bill_original_filename = filename
    invoice.cloth_bill_content_type = content_type
    invoice.cloth_bill_size_bytes = len(data)
    invoice.cloth_bill_uploaded_at = datetime.now(timezone.utc)
    db.add(Notification(
        user_id=item.order.user_id,
        title=f"Cloth bill ready for order #{item.order_id}",
        message=f"{vendor.full_name} attached cloth purchase proof for {item.design.title}.",
        notification_type="cloth_bill_uploaded",
        link="/orders",
    ))
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        try:
            await run_in_threadpool(delete_objects, [object_name])
        except HTTPException:
            pass
        raise
    if old_object_name and old_object_name != object_name:
        try:
            await run_in_threadpool(delete_objects, [old_object_name])
        except HTTPException:
            # The new proof is already durable and referenced. A later cleanup
            # job can remove an orphaned replaced attachment.
            pass
    return await _refreshed_item_response(item.id, db, True)


@router.get("/items/{item_id}/invoice/cloth-bill", response_class=Response)
async def get_cloth_bill(
    item_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    item = await _loaded_order_item(item_id, db)
    if not item:
        raise HTTPException(status_code=404, detail="Cloth bill not found")
    is_customer = item.order.user_id == current_user.id
    is_vendor = item.design.vendor_id == current_user.id
    is_admin = current_user.role in {UserRole.ADMIN.value, UserRole.SUPER_ADMIN.value}
    invoice = item.invoice
    if (
        not (is_customer or is_vendor or is_admin)
        or not invoice
        or not invoice.cloth_bill_object_name
        or not invoice.cloth_bill_content_type
    ):
        raise HTTPException(status_code=404, detail="Cloth bill not found")
    etag = private_object_etag(invoice.cloth_bill_object_name)
    cache_headers = {
        "Cache-Control": "private, max-age=300",
        "ETag": etag,
        "Vary": "Authorization, Cookie",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
    }
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=cache_headers)
    content = await run_in_threadpool(
        download_invoice_attachment,
        invoice.cloth_bill_object_name,
    )
    return Response(
        content=content,
        media_type=invoice.cloth_bill_content_type,
        headers=cache_headers,
    )


@router.post("/items/{item_id}/invoice/decision", response_model=OrderItemResponse)
async def decide_vendor_invoice(
    item_id: int,
    payload: InvoiceDecision,
    customer: User = Depends(require_buyer),
    db: AsyncSession = Depends(get_db),
):
    item = await _customer_order_item(item_id, customer, db)
    if item.work_status in {"rejected", "cancelled"}:
        raise HTTPException(status_code=409, detail="This order item has been closed")
    invoice = item.invoice
    if not invoice or invoice.status != "issued":
        raise HTTPException(status_code=409, detail="This invoice is not awaiting approval")
    now = datetime.now(timezone.utc)
    if payload.decision == "change_requested":
        if not payload.comment or not payload.comment.strip():
            raise HTTPException(status_code=422, detail="Explain what the vendor should change")
        invoice.status = "change_requested"
        item.work_status = "awaiting_invoice"
        db.add(OrderComment(
            order_item_id=item.id,
            author_id=customer.id,
            message=payload.comment.strip(),
        ))
        notification_message = f"{customer.full_name} requested invoice changes for {item.design.title}."
    else:
        invoice.status = "approved"
        invoice.approved_at = now
        if invoice.cloth_source == "vendor_supplied" and invoice.cloth_cost > 0:
            invoice.payment_status = "pending"
            item.work_status = "awaiting_cloth_payment"
        elif invoice.cloth_source == "customer_provided":
            invoice.payment_status = "not_required"
            item.work_status = "awaiting_cloth"
        else:
            invoice.payment_status = "not_required"
            item.work_status = "ready_to_start"
        if payload.comment and payload.comment.strip():
            db.add(OrderComment(
                order_item_id=item.id,
                author_id=customer.id,
                message=payload.comment.strip(),
            ))
        notification_message = f"{customer.full_name} approved the invoice for {item.design.title}."
    db.add(Notification(
        user_id=item.design.vendor_id,
        title=f"Invoice {payload.decision.replace('_', ' ')}",
        message=notification_message,
        notification_type=f"invoice_{payload.decision}",
        link="/vendor/sales-orders",
    ))
    await db.commit()
    return await _refreshed_item_response(item.id, db, False)


@router.post("/items/{item_id}/invoice/payment", response_model=OrderItemResponse)
async def submit_cloth_payment(
    item_id: int,
    payload: PaymentReferenceCreate,
    customer: User = Depends(require_buyer),
    db: AsyncSession = Depends(get_db),
):
    item = await _customer_order_item(item_id, customer, db)
    invoice = item.invoice
    if (
        not invoice
        or invoice.status != "approved"
        or invoice.cloth_source != "vendor_supplied"
        or invoice.cloth_cost <= 0
        or invoice.payment_status != "pending"
    ):
        raise HTTPException(status_code=409, detail="No cloth payment is currently required")
    if not invoice.cloth_bill_object_name:
        raise HTTPException(
            status_code=409,
            detail="The vendor must attach the cloth bill before payment can be finalized",
        )
    invoice.payment_reference = payload.payment_reference.strip()
    invoice.payment_status = "submitted"
    item.work_status = "awaiting_payment_verification"
    db.add(Notification(
        user_id=item.design.vendor_id,
        title=f"Cloth payment submitted for order #{item.order_id}",
        message=f"{customer.full_name} submitted payment reference {invoice.payment_reference}.",
        notification_type="cloth_payment_submitted",
        link="/vendor/sales-orders",
    ))
    await db.commit()
    return await _refreshed_item_response(item.id, db, False)


@router.post("/vendor/items/{item_id}/invoice/verify-payment", response_model=OrderItemResponse)
async def verify_cloth_payment(
    item_id: int,
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    item = await _vendor_order_item(item_id, vendor, db)
    invoice = item.invoice
    if not invoice or invoice.payment_status != "submitted":
        raise HTTPException(status_code=409, detail="No submitted cloth payment to verify")
    invoice.payment_status = "paid"
    invoice.paid_at = datetime.now(timezone.utc)
    item.work_status = "ready_to_start"
    db.add(Notification(
        user_id=item.order.user_id,
        title=f"Cloth payment verified for order #{item.order_id}",
        message=f"{vendor.full_name} verified your cloth payment for {item.design.title}.",
        notification_type="cloth_payment_verified",
        link="/orders",
    ))
    await db.commit()
    return await _refreshed_item_response(item.id, db, True)


@router.post("/vendor/items/{item_id}/cloth-received", response_model=OrderItemResponse)
async def confirm_customer_cloth_received(
    item_id: int,
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    item = await _vendor_order_item(item_id, vendor, db)
    invoice = item.invoice
    if not invoice or invoice.status != "approved" or invoice.cloth_source != "customer_provided":
        raise HTTPException(status_code=409, detail="This order does not use customer-provided cloth")
    invoice.cloth_received = True
    item.work_status = "ready_to_start"
    await db.commit()
    return await _refreshed_item_response(item.id, db, True)


@router.post("/vendor/items/{item_id}/start", response_model=OrderItemResponse)
async def start_vendor_work(
    item_id: int,
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    item = await _vendor_order_item(item_id, vendor, db)
    invoice = item.invoice
    if not invoice or invoice.status != "approved":
        raise HTTPException(status_code=409, detail="The customer must approve the invoice first")
    if invoice.cloth_source == "vendor_supplied" and invoice.cloth_cost > 0 and invoice.payment_status != "paid":
        raise HTTPException(status_code=409, detail="Verify the cloth payment before starting")
    if invoice.cloth_source == "customer_provided" and not invoice.cloth_received:
        raise HTTPException(status_code=409, detail="Confirm receipt of the customer's cloth before starting")
    item.work_status = "fabric_cutting"
    item.order.status = OrderStatus.FABRIC_CUTTING
    db.add(Notification(
        user_id=item.order.user_id,
        title=f"Tailoring started for order #{item.order_id}",
        message=f"{vendor.full_name} started work on {item.design.title}.",
        notification_type="tailoring_started",
        link="/orders",
    ))
    await db.commit()
    return await _refreshed_item_response(item.id, db, True)


@router.post("/items/{item_id}/comments", response_model=OrderItemResponse)
async def add_order_comment(
    item_id: int,
    payload: OrderCommentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    access = (
        await db.execute(
            select(OrderItem.order_id, Order.user_id, Design.vendor_id)
            .select_from(OrderItem)
            .join(OrderItem.order)
            .join(OrderItem.design)
            .where(OrderItem.id == item_id)
        )
    ).one_or_none()
    if not access:
        raise HTTPException(status_code=404, detail="Order item not found")
    is_customer = access.user_id == current_user.id
    is_vendor = access.vendor_id == current_user.id
    is_admin = current_user.role in {UserRole.ADMIN.value, UserRole.SUPER_ADMIN.value}
    if not (is_customer or is_vendor or is_admin):
        raise HTTPException(status_code=404, detail="Order item not found")
    db.add(OrderComment(
        order_item_id=item_id,
        author_id=current_user.id,
        message=payload.message,
    ))
    target_id = access.vendor_id if is_customer else access.user_id
    if target_id and target_id != current_user.id:
        db.add(Notification(
            user_id=target_id,
            title=f"New chat message on order #{access.order_id}",
            message=f"{current_user.full_name}: {payload.message[:180]}",
            notification_type="order_comment",
            link="/vendor/sales-orders" if target_id == access.vendor_id else "/orders",
        ))
    await db.commit()
    return await _refreshed_item_response(
        item_id,
        db,
        include_draft_invoice=is_vendor or is_admin,
    )


async def _chat_access(item_id: int, user_id: int, db: AsyncSession):
    access = (
        await db.execute(
            select(OrderItem.order_id, Order.user_id, Design.vendor_id)
            .select_from(OrderItem)
            .join(OrderItem.order)
            .join(OrderItem.design)
            .where(OrderItem.id == item_id)
        )
    ).one_or_none()
    user = await db.get(User, user_id)
    if not access or not user or not user.is_active:
        return None
    is_admin = user.role in {UserRole.ADMIN.value, UserRole.SUPER_ADMIN.value}
    if access.user_id != user_id and access.vendor_id != user_id and not is_admin:
        return None
    return access, user


def _serialize_comment(comment: OrderComment) -> dict:
    return {
        "id": comment.id,
        "author_id": comment.author_id,
        "author_name": comment.author.full_name,
        "author_role": comment.author.role,
        "message": comment.message,
        "created_at": comment.created_at.isoformat(),
    }


@router.post("/items/{item_id}/chat-ticket")
async def issue_order_chat_ticket(
    item_id: int,
    access_token: str = Depends(oauth2_scheme),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await _chat_access(item_id, current_user.id, db):
        raise HTTPException(status_code=404, detail="Order item not found")
    return {"ticket": create_chat_ticket(access_token, item_id), "expires_in": 30}


@router.websocket("/items/{item_id}/chat")
async def order_chat_socket(websocket: WebSocket, item_id: int):
    ticket = websocket.query_params.get("ticket", "")
    try:
        user_id, session_id = decode_chat_ticket(ticket, item_id)
    except HTTPException:
        await websocket.close(code=4401, reason="Invalid or expired chat ticket")
        return

    async with AsyncSessionLocal() as db:
        session_active = await db.scalar(
            select(AuthSession.id).where(
                AuthSession.id == session_id,
                AuthSession.user_id == user_id,
                AuthSession.revoked_at.is_(None),
                AuthSession.expires_at > datetime.now(timezone.utc),
            )
        )
        identity = await _chat_access(item_id, user_id, db) if session_active else None
    if not identity:
        await websocket.close(code=4401, reason="Chat session is no longer active")
        return

    access, user = identity
    try:
        latest_id = max(0, int(websocket.query_params.get("after_id", "0")))
    except ValueError:
        latest_id = 0
    await websocket.accept()
    await websocket.send_json({"type": "ready"})
    session_checks = 0

    try:
        while True:
            incoming = None
            try:
                incoming = await asyncio.wait_for(websocket.receive_json(), timeout=3)
            except asyncio.TimeoutError:
                pass

            if incoming and incoming.get("type") == "message":
                try:
                    validated = OrderCommentCreate(message=incoming.get("message", ""))
                except ValueError:
                    await websocket.send_json({"type": "error", "message": "Messages must contain 1 to 2,000 characters."})
                    continue
                async with AsyncSessionLocal() as db:
                    current_access = await _chat_access(item_id, user_id, db)
                    if not current_access:
                        await websocket.close(code=4403, reason="Order chat access was removed")
                        return
                    row, current_user = current_access
                    db.add(OrderComment(order_item_id=item_id, author_id=user_id, message=validated.message))
                    target_id = row.vendor_id if row.user_id == user_id else row.user_id
                    if target_id and target_id != user_id:
                        db.add(Notification(
                            user_id=target_id,
                            title=f"New chat message on order #{row.order_id}",
                            message=f"{current_user.full_name}: {validated.message[:180]}",
                            notification_type="order_comment",
                            link="/orders" if row.user_id == target_id else "/vendor/sales-orders",
                        ))
                    await db.commit()
            elif incoming and incoming.get("type") == "ping":
                await websocket.send_json({"type": "pong"})

            session_checks += 1
            if session_checks >= 10:
                async with AsyncSessionLocal() as db:
                    active = await db.scalar(
                        select(AuthSession.id).where(
                            AuthSession.id == session_id,
                            AuthSession.user_id == user_id,
                            AuthSession.revoked_at.is_(None),
                            AuthSession.expires_at > datetime.now(timezone.utc),
                        )
                    )
                if not active:
                    await websocket.close(code=4401, reason="Chat session expired")
                    return
                session_checks = 0

            async with AsyncSessionLocal() as db:
                comments = (
                    await db.execute(
                        select(OrderComment)
                        .where(OrderComment.order_item_id == item_id, OrderComment.id > latest_id)
                        .options(selectinload(OrderComment.author))
                        .order_by(OrderComment.id.asc())
                        .limit(100)
                    )
                ).scalars().all()
            for entry in comments:
                await websocket.send_json({"type": "message", "comment": _serialize_comment(entry)})
                latest_id = max(latest_id, entry.id)
    except WebSocketDisconnect:
        return


@router.get("/items/{item_id}/comments", response_model=list[OrderCommentResponse])
async def get_order_comments(
    item_id: int,
    after_id: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    access = (
        await db.execute(
            select(Order.user_id, Design.vendor_id)
            .select_from(OrderItem)
            .join(OrderItem.order)
            .join(OrderItem.design)
            .where(OrderItem.id == item_id)
        )
    ).one_or_none()
    if not access:
        raise HTTPException(status_code=404, detail="Order item not found")
    is_customer = access.user_id == current_user.id
    is_vendor = access.vendor_id == current_user.id
    is_admin = current_user.role in {UserRole.ADMIN.value, UserRole.SUPER_ADMIN.value}
    if not (is_customer or is_vendor or is_admin):
        raise HTTPException(status_code=404, detail="Order item not found")
    comments = (
        await db.execute(
            select(OrderComment)
            .where(
                OrderComment.order_item_id == item_id,
                OrderComment.id > after_id,
            )
            .options(selectinload(OrderComment.author))
            .order_by(OrderComment.id.asc())
            .limit(100)
        )
    ).scalars().all()
    return [{
        "id": comment.id,
        "author_id": comment.author_id,
        "author_name": comment.author.full_name,
        "author_role": comment.author.role,
        "message": comment.message,
        "created_at": comment.created_at,
    } for comment in comments]


@router.get("/{order_id}", response_model=OrderResponse)
async def get_order(
    order_id: int,
    current_user: User = Depends(require_buyer),
    db: AsyncSession = Depends(get_db),
):
    order = await _loaded_order(order_id, db)
    if not order or order.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Order not found")
    return serialize_order(order)


@admin_router.get("", response_model=OrderListResponse)
async def list_all_orders(
    order_status: Optional[OrderStatus] = Query(default=None, alias="status"),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=100_000),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    filters = []
    if order_status:
        filters.append(Order.status == order_status)
    total = await db.scalar(select(func.count(Order.id)).where(*filters))
    statement = (
        select(Order)
        .where(*filters)
        .options(*_order_options())
        .order_by(Order.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(statement)
    return {
        "items": [
            serialize_order(order, include_draft_invoices=True)
            for order in result.scalars().unique().all()
        ],
        "total": total or 0,
        "limit": limit,
        "offset": offset,
    }


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
    if order.status == OrderStatus.CANCELLED and payload.status != OrderStatus.CANCELLED:
        raise HTTPException(status_code=409, detail="A cancelled order cannot be reopened")
    if payload.status == OrderStatus.CANCELLED:
        approved_invoice = await db.scalar(
            select(VendorInvoice.id)
            .join(VendorInvoice.order_item)
            .where(
                OrderItem.order_id == order.id,
                VendorInvoice.status == "approved",
            )
            .limit(1)
        )
        if approved_invoice:
            raise HTTPException(
                status_code=409,
                detail="This order cannot be cancelled because an invoice has already been accepted",
            )
        loaded = await _loaded_order(order.id, db)
        for item in loaded.order_items:
            if item.work_status not in {"rejected", "cancelled"}:
                item.work_status = "cancelled"
        for delivery in loaded.deliveries:
            delivery.status = "cancelled"
            delivery.status_updated_at = datetime.now(timezone.utc)
        order.total_amount = 0
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
    return serialize_order(loaded, include_draft_invoices=True)
