from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache
from typing import Union

import razorpay
import requests
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from razorpay.errors import (
    BadRequestError,
    GatewayError,
    ServerError,
    SignatureVerificationError,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import require_buyer
from app.config import settings
from app.database import get_db
from app.models import (
    Notification,
    Order,
    OrderInvoice,
    OrderItem,
    User,
    VendorInvoice,
)
from app.schemas import (
    RazorpayCheckoutSession,
    RazorpayOrderCreate,
    RazorpayPaymentVerificationResponse,
    RazorpayPaymentVerify,
)


router = APIRouter(prefix="/api/payments/razorpay", tags=["payments"])
Invoice = Union[OrderInvoice, VendorInvoice]


def _payment_stage(scope: str) -> str:
    return "final" if scope.endswith("_final") else "cloth"


def _is_combined_scope(scope: str) -> bool:
    return scope.startswith("combined_order")


def _payment_field(stage: str, name: str) -> str:
    return f"final_{name}" if stage == "final" else name


def _invoice_total(invoice: Invoice) -> float:
    merchandise = invoice.merchandise_amount if isinstance(invoice, OrderInvoice) else 0
    additions = sum(line.quantity * line.unit_price for line in invoice.line_items)
    return round(
        invoice.service_amount + merchandise + invoice.cloth_cost
        + invoice.delivery_cost + additions,
        2,
    )


def _final_balance(invoice: Invoice) -> float:
    cloth_advance = (
        invoice.cloth_cost
        if invoice.cloth_source == "vendor_supplied"
        and invoice.cloth_cost > 0
        and invoice.payment_status == "paid"
        else 0
    )
    return round(max(0, _invoice_total(invoice) - cloth_advance), 2)


class _TimeoutSession(requests.Session):
    """Give the synchronous Razorpay SDK a bounded network timeout."""

    def request(self, method, url, **kwargs):  # type: ignore[override]
        kwargs.setdefault("timeout", settings.RAZORPAY_HTTP_TIMEOUT_SECONDS)
        return super().request(method, url, **kwargs)


@lru_cache(maxsize=1)
def _razorpay_client() -> razorpay.Client:
    if not settings.RAZORPAY_KEY_ID or not settings.RAZORPAY_KEY_SECRET:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Online payments are not configured",
        )
    return razorpay.Client(
        session=_TimeoutSession(),
        auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET),
    )


def _provider_error(exc: Exception) -> HTTPException:
    message = str(exc).lower()
    if any(marker in message for marker in ("auth", "key", "credential")):
        return HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Payment provider authentication failed",
        )
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="The payment provider could not process this request. Try again.",
    )


def _amount_to_paise(amount: float) -> int:
    paise = int(
        (Decimal(str(amount)) * Decimal("100")).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        )
    )
    if paise < 100:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="The minimum online payment is ₹1",
        )
    return paise


async def _customer_invoice(
    payload: RazorpayOrderCreate | RazorpayPaymentVerify,
    customer: User,
    db: AsyncSession,
) -> tuple[Invoice, Order, OrderItem | None]:
    if _is_combined_scope(payload.scope):
        result = await db.execute(
            select(OrderInvoice)
            .join(Order, Order.id == OrderInvoice.order_id)
            .where(
                OrderInvoice.order_id == payload.resource_id,
                Order.user_id == customer.id,
            )
            .with_for_update()
            .options(
                selectinload(OrderInvoice.order).selectinload(Order.order_items),
                selectinload(OrderInvoice.line_items),
            )
        )
        invoice = result.scalar_one_or_none()
        if not invoice:
            raise HTTPException(status_code=404, detail="Order invoice not found")
        return invoice, invoice.order, None

    result = await db.execute(
        select(VendorInvoice)
        .join(OrderItem, OrderItem.id == VendorInvoice.order_item_id)
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            VendorInvoice.order_item_id == payload.resource_id,
            Order.user_id == customer.id,
        )
        .with_for_update()
        .options(
            selectinload(VendorInvoice.order_item).selectinload(OrderItem.order),
            selectinload(VendorInvoice.order_item).selectinload(OrderItem.design),
            selectinload(VendorInvoice.line_items),
        )
    )
    invoice = result.scalar_one_or_none()
    if not invoice:
        raise HTTPException(status_code=404, detail="Order item invoice not found")
    return invoice, invoice.order_item.order, invoice.order_item


def _ensure_checkout_ready(
    invoice: Invoice,
    order: Order,
    item: OrderItem | None,
    stage: str,
) -> int:
    if stage == "final":
        if invoice.status != "approved" or invoice.final_payment_status != "pending":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This invoice is not awaiting final payment",
            )
        if isinstance(invoice, OrderInvoice):
            active_items = [
                order_item for order_item in order.order_items
                if order_item.work_status not in {"cancelled", "rejected"}
            ]
            if active_items and any(order_item.work_status != "completed" for order_item in active_items):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Final payment opens after every tailoring item is completed",
                )
        elif not item or item.work_status != "completed":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Final payment opens after tailoring is completed",
            )
        return _amount_to_paise(_final_balance(invoice))
    if (
        invoice.status != "approved"
        or invoice.cloth_source != "vendor_supplied"
        or invoice.cloth_cost <= 0
        or invoice.payment_status != "pending"
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This invoice is not awaiting an online cloth payment",
        )
    if not invoice.cloth_bill_object_name:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The vendor must attach the cloth bill before payment",
        )
    return _amount_to_paise(invoice.cloth_cost)


def _checkout_response(
    invoice: Invoice,
    customer: User,
    amount: int,
    stage: str,
) -> RazorpayCheckoutSession:
    order_id = getattr(invoice, _payment_field(stage, "gateway_order_id"))
    if not settings.RAZORPAY_KEY_ID or not order_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Online payments are not configured",
        )
    return RazorpayCheckoutSession(
        key_id=settings.RAZORPAY_KEY_ID,
        order_id=order_id,
        amount=amount,
        currency=settings.RAZORPAY_CURRENCY.upper(),
        name=settings.APP_NAME,
        description=(
            f"Final payment for {invoice.invoice_number}"
            if stage == "final"
            else f"Cloth payment for {invoice.invoice_number}"
        ),
        prefill_name=customer.full_name,
        prefill_email=customer.email,
        prefill_contact=customer.phone,
    )


@router.post("/create-order", response_model=RazorpayCheckoutSession)
async def create_razorpay_order(
    payload: RazorpayOrderCreate,
    customer: User = Depends(require_buyer),
    db: AsyncSession = Depends(get_db),
):
    """Create or reuse the provider order for an approved Vastrivo invoice."""
    invoice, order, item = await _customer_invoice(payload, customer, db)
    stage = _payment_stage(payload.scope)
    amount = _ensure_checkout_ready(invoice, order, item, stage)
    currency = settings.RAZORPAY_CURRENCY.upper()
    gateway_order_field = _payment_field(stage, "gateway_order_id")
    gateway_amount_field = _payment_field(stage, "gateway_amount_paise")
    payment_gateway_field = _payment_field(stage, "payment_gateway")
    stored_order_id = getattr(invoice, gateway_order_field)

    if stored_order_id:
        if getattr(invoice, gateway_amount_field) != amount or getattr(invoice, payment_gateway_field) != "razorpay":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The stored payment order does not match this invoice",
            )
        return _checkout_response(invoice, customer, amount, stage)

    client = _razorpay_client()
    receipt = (
        f"vastrivo-c-{order.id}-r{invoice.revision}"
        if _is_combined_scope(payload.scope)
        else f"vastrivo-i-{payload.resource_id}-r{invoice.revision}"
    )
    if stage == "final":
        receipt = f"{receipt}-final"
    try:
        provider_order = await run_in_threadpool(
            client.order.create,
            {
                "amount": amount,
                "currency": currency,
                "receipt": receipt[:40],
                "notes": {
                    "vastrivo_order_id": str(order.id),
                    "invoice_number": invoice.invoice_number,
                    "payment_for": "final_order_balance" if stage == "final" else "vendor_supplied_cloth",
                },
            },
        )
    except (BadRequestError, GatewayError, ServerError, requests.RequestException) as exc:
        raise _provider_error(exc) from exc

    provider_order_id = str(provider_order.get("id", ""))
    if (
        not provider_order_id.startswith("order_")
        or int(provider_order.get("amount", 0)) != amount
        or str(provider_order.get("currency", "")).upper() != currency
    ):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="The payment provider returned an invalid order",
        )

    setattr(invoice, payment_gateway_field, "razorpay")
    setattr(invoice, gateway_order_field, provider_order_id)
    setattr(invoice, gateway_amount_field, amount)
    await db.commit()
    return _checkout_response(invoice, customer, amount, stage)


@router.post("/verify-payment", response_model=RazorpayPaymentVerificationResponse)
async def verify_razorpay_payment(
    payload: RazorpayPaymentVerify,
    customer: User = Depends(require_buyer),
    db: AsyncSession = Depends(get_db),
):
    """Verify Checkout's signature and confirm the provider payment was captured."""
    invoice, order, item = await _customer_invoice(payload, customer, db)
    stage = _payment_stage(payload.scope)
    payment_status_field = _payment_field(stage, "payment_status")
    payment_gateway_field = _payment_field(stage, "payment_gateway")
    gateway_order_field = _payment_field(stage, "gateway_order_id")
    gateway_payment_field = _payment_field(stage, "gateway_payment_id")
    gateway_amount_field = _payment_field(stage, "gateway_amount_paise")
    paid_at_field = _payment_field(stage, "paid_at")

    if (
        getattr(invoice, payment_status_field) == "paid"
        and getattr(invoice, gateway_payment_field) == payload.razorpay_payment_id
    ):
        return RazorpayPaymentVerificationResponse(
            success=True,
            payment_id=payload.razorpay_payment_id,
            message="Payment was already verified",
        )

    amount = _ensure_checkout_ready(invoice, order, item, stage)
    stored_order_id = getattr(invoice, gateway_order_field)
    if (
        getattr(invoice, payment_gateway_field) != "razorpay"
        or not stored_order_id
        or stored_order_id != payload.razorpay_order_id
        or getattr(invoice, gateway_amount_field) != amount
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payment does not belong to this invoice",
        )

    client = _razorpay_client()
    try:
        await run_in_threadpool(
            client.utility.verify_payment_signature,
            {
                "razorpay_order_id": stored_order_id,
                "razorpay_payment_id": payload.razorpay_payment_id,
                "razorpay_signature": payload.razorpay_signature,
            },
        )
    except SignatureVerificationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payment signature verification failed",
        ) from exc

    try:
        provider_payment = await run_in_threadpool(
            client.payment.fetch, payload.razorpay_payment_id
        )
        if str(provider_payment.get("status", "")) == "authorized":
            provider_payment = await run_in_threadpool(
                client.payment.capture,
                payload.razorpay_payment_id,
                amount,
                {"currency": settings.RAZORPAY_CURRENCY.upper()},
            )
    except (BadRequestError, GatewayError, ServerError, requests.RequestException) as exc:
        raise _provider_error(exc) from exc

    if (
        str(provider_payment.get("status", "")) != "captured"
        or str(provider_payment.get("order_id", "")) != stored_order_id
        or int(provider_payment.get("amount", 0)) != amount
        or str(provider_payment.get("currency", "")).upper()
        != settings.RAZORPAY_CURRENCY.upper()
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Payment is not captured for the expected amount",
        )

    setattr(invoice, gateway_payment_field, payload.razorpay_payment_id)
    setattr(invoice, payment_status_field, "paid")
    setattr(invoice, paid_at_field, datetime.now(timezone.utc))
    if stage == "cloth":
        invoice.payment_reference = payload.razorpay_payment_id

    vendor_id = (
        order.vendor_id
        if _is_combined_scope(payload.scope)
        else item.design.vendor_id if item else None
    )
    if stage == "cloth" and _is_combined_scope(payload.scope):
        for order_item in order.order_items:
            if order_item.work_status == "awaiting_cloth_payment":
                order_item.work_status = "ready_to_start"
    elif stage == "cloth":
        if not item:
            raise HTTPException(status_code=404, detail="Order item not found")
        item.work_status = "ready_to_start"

    if vendor_id:
        db.add(Notification(
            user_id=vendor_id,
            title=(
                f"Final payment received for order #{order.id}"
                if stage == "final"
                else f"Payment received for order #{order.id}"
            ),
            message=(
                f"{customer.full_name}'s Razorpay payment for "
                f"{invoice.invoice_number} was captured."
                + (" The order can now move to shipping." if stage == "final" else "")
            ),
            notification_type=("final_payment_verified" if stage == "final" else "cloth_payment_verified"),
            link="/vendor/sales-orders",
        ))
    await db.commit()
    return RazorpayPaymentVerificationResponse(
        success=True,
        payment_id=payload.razorpay_payment_id,
        message="Payment verified successfully",
    )
