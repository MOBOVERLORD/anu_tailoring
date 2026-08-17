import hashlib
import hmac
import json
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache
from typing import Optional, Union

import razorpay
import requests
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.concurrency import run_in_threadpool
from razorpay.errors import (
    BadRequestError,
    GatewayError,
    ServerError,
    SignatureVerificationError,
)
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from app.auth import require_admin, require_buyer, require_super_admin
from app.config import settings
from app.database import get_db
from app.models import (
    Delivery,
    Notification,
    Order,
    OrderInvoice,
    OrderItem,
    PaymentTransaction,
    PaymentWebhookEvent,
    User,
    VendorSettlement,
    VendorInvoice,
)
from app.schemas import (
    AdminRefundRequest,
    PaymentTransactionResponse,
    RazorpayCheckoutSession,
    RazorpayOrderCreate,
    RazorpayPaymentVerificationResponse,
    RazorpayPaymentVerify,
    VendorSettlementResponse,
    VendorSettlementUpdate,
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


def _money_to_paise(amount: float) -> int:
    return int(
        (Decimal(str(amount)) * Decimal("100")).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        )
    )


def _amount_to_paise(amount: float) -> int:
    paise = _money_to_paise(amount)
    if paise < 100:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="The minimum online payment is ₹1",
        )
    return paise


def _paise_to_amount(value: int) -> float:
    return round(value / 100, 2)


async def _ensure_payment_transaction(
    *,
    invoice: Invoice,
    order: Order,
    item: OrderItem | None,
    scope: str,
    amount: int,
    provider_order_id: str,
    db: AsyncSession,
) -> PaymentTransaction:
    existing = await db.scalar(
        select(PaymentTransaction).where(
            PaymentTransaction.provider_order_id == provider_order_id
        )
    )
    if existing:
        if (
            existing.amount_paise != amount
            or existing.currency != settings.RAZORPAY_CURRENCY.upper()
            or existing.scope != scope
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The payment ledger does not match this invoice",
            )
        return existing

    vendor_id = invoice.vendor_id if isinstance(invoice, OrderInvoice) else (
        item.design.vendor_id if item and item.design else None
    )
    if not vendor_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The invoice vendor is unavailable",
        )
    transaction = PaymentTransaction(
        provider="razorpay",
        provider_order_id=provider_order_id,
        scope=scope,
        resource_id=(order.id if _is_combined_scope(scope) else item.id if item else 0),
        order_id=order.id,
        invoice_kind=("combined" if isinstance(invoice, OrderInvoice) else "vendor"),
        invoice_id=invoice.id,
        payment_stage=_payment_stage(scope),
        customer_id=order.user_id,
        vendor_id=vendor_id,
        amount_paise=amount,
        currency=settings.RAZORPAY_CURRENCY.upper(),
        status="created",
    )
    db.add(transaction)
    await db.flush()
    return transaction


async def _load_transaction_invoice(
    transaction: PaymentTransaction,
    db: AsyncSession,
) -> tuple[Invoice, Order, OrderItem | None]:
    if transaction.invoice_kind == "combined":
        invoice = await db.scalar(
            select(OrderInvoice)
            .where(OrderInvoice.id == transaction.invoice_id)
            .with_for_update()
            .options(
                selectinload(OrderInvoice.order).selectinload(Order.order_items),
                selectinload(OrderInvoice.line_items),
            )
        )
        if not invoice:
            raise RuntimeError("Combined invoice for payment ledger was not found")
        return invoice, invoice.order, None
    invoice = await db.scalar(
        select(VendorInvoice)
        .where(VendorInvoice.id == transaction.invoice_id)
        .with_for_update()
        .options(
            selectinload(VendorInvoice.order_item).selectinload(OrderItem.order),
            selectinload(VendorInvoice.order_item).selectinload(OrderItem.design),
            selectinload(VendorInvoice.line_items),
        )
    )
    if not invoice:
        raise RuntimeError("Vendor invoice for payment ledger was not found")
    return invoice, invoice.order_item.order, invoice.order_item


async def _ensure_vendor_settlement(
    transaction: PaymentTransaction,
    invoice: Invoice,
    order: Order,
    db: AsyncSession,
) -> VendorSettlement:
    existing = await db.scalar(
        select(VendorSettlement).where(
            VendorSettlement.payment_transaction_id == transaction.id
        )
    )
    if existing:
        return existing

    platform_delivery_paise = 0
    if transaction.payment_stage == "final" and invoice.delivery_cost > 0:
        fulfilment_method = await db.scalar(
            select(Delivery.fulfilment_method).where(Delivery.order_id == order.id)
        )
        if fulfilment_method == "platform_delivery":
            platform_delivery_paise = min(
                transaction.amount_paise,
                _money_to_paise(invoice.delivery_cost),
            )
    settlement = VendorSettlement(
        payment_transaction_id=transaction.id,
        vendor_id=transaction.vendor_id,
        order_id=transaction.order_id,
        gross_amount_paise=transaction.amount_paise,
        platform_delivery_paise=platform_delivery_paise,
        platform_fee_paise=0,
        payable_amount_paise=max(0, transaction.amount_paise - platform_delivery_paise),
        status="pending",
        notes="Pending manual payout review; Razorpay Route is not enabled.",
    )
    db.add(settlement)
    await db.flush()
    return settlement


async def _apply_captured_payment(
    *,
    transaction: PaymentTransaction,
    invoice: Invoice,
    order: Order,
    item: OrderItem | None,
    payment_id: str,
    db: AsyncSession,
) -> None:
    stage = transaction.payment_stage
    payment_status_field = _payment_field(stage, "payment_status")
    gateway_payment_field = _payment_field(stage, "gateway_payment_id")
    paid_at_field = _payment_field(stage, "paid_at")
    already_paid = getattr(invoice, payment_status_field) == "paid"
    existing_payment_id = getattr(invoice, gateway_payment_field)
    if already_paid and existing_payment_id not in {None, payment_id}:
        raise RuntimeError("Invoice is already linked to another captured payment")

    now = datetime.now(timezone.utc)
    setattr(invoice, gateway_payment_field, payment_id)
    setattr(invoice, payment_status_field, "paid")
    setattr(invoice, paid_at_field, getattr(invoice, paid_at_field) or now)
    if stage == "cloth":
        invoice.payment_reference = payment_id
        if isinstance(invoice, OrderInvoice):
            for order_item in order.order_items:
                if order_item.work_status == "awaiting_cloth_payment":
                    order_item.work_status = "ready_to_start"
        elif item:
            item.work_status = "ready_to_start"

    transaction.provider_payment_id = payment_id
    if transaction.status not in {
        "refund_pending", "partially_refunded", "refunded", "refund_failed"
    }:
        transaction.status = "captured"
    transaction.failure_code = None
    transaction.failure_reason = None
    transaction.captured_at = transaction.captured_at or now
    await _ensure_vendor_settlement(transaction, invoice, order, db)

    if not already_paid:
        customer = await db.get(User, transaction.customer_id)
        customer_name = customer.full_name if customer else "Customer"
        db.add(Notification(
            user_id=transaction.vendor_id,
            title=(
                f"Final payment received for order #{order.id}"
                if stage == "final"
                else f"Payment received for order #{order.id}"
            ),
            message=(
                f"{customer_name}'s Razorpay payment for {invoice.invoice_number} was captured."
                + (" The order can now move to shipping." if stage == "final" else "")
            ),
            notification_type=("final_payment_verified" if stage == "final" else "cloth_payment_verified"),
            link="/vendor/sales-orders",
        ))


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
        await _ensure_payment_transaction(
            invoice=invoice,
            order=order,
            item=item,
            scope=payload.scope,
            amount=amount,
            provider_order_id=stored_order_id,
            db=db,
        )
        await db.commit()
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
    await _ensure_payment_transaction(
        invoice=invoice,
        order=order,
        item=item,
        scope=payload.scope,
        amount=amount,
        provider_order_id=provider_order_id,
        db=db,
    )
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
        stored_order_id = getattr(invoice, gateway_order_field)
        stored_amount = getattr(invoice, gateway_amount_field)
        if stored_order_id and stored_amount:
            transaction = await _ensure_payment_transaction(
                invoice=invoice,
                order=order,
                item=item,
                scope=payload.scope,
                amount=stored_amount,
                provider_order_id=stored_order_id,
                db=db,
            )
            await _apply_captured_payment(
                transaction=transaction,
                invoice=invoice,
                order=order,
                item=item,
                payment_id=payload.razorpay_payment_id,
                db=db,
            )
            await db.commit()
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
    transaction = await _ensure_payment_transaction(
        invoice=invoice,
        order=order,
        item=item,
        scope=payload.scope,
        amount=amount,
        provider_order_id=stored_order_id,
        db=db,
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

    await _apply_captured_payment(
        transaction=transaction,
        invoice=invoice,
        order=order,
        item=item,
        payment_id=payload.razorpay_payment_id,
        db=db,
    )
    await db.commit()
    return RazorpayPaymentVerificationResponse(
        success=True,
        payment_id=payload.razorpay_payment_id,
        message="Payment verified successfully",
    )


def _payment_response(
    transaction: PaymentTransaction,
    customer_name: str,
    vendor_name: str,
) -> PaymentTransactionResponse:
    return PaymentTransactionResponse(
        id=transaction.id,
        provider_order_id=transaction.provider_order_id,
        provider_payment_id=transaction.provider_payment_id,
        provider_refund_id=transaction.provider_refund_id,
        order_id=transaction.order_id,
        invoice_kind=transaction.invoice_kind,
        payment_stage=transaction.payment_stage,
        customer_name=customer_name,
        vendor_name=vendor_name,
        amount=_paise_to_amount(transaction.amount_paise),
        amount_refunded=_paise_to_amount(transaction.amount_refunded_paise),
        currency=transaction.currency,
        status=transaction.status,
        failure_reason=transaction.failure_reason,
        captured_at=transaction.captured_at,
        refunded_at=transaction.refunded_at,
        created_at=transaction.created_at,
        updated_at=transaction.updated_at,
    )


async def _settlement_response(
    settlement: VendorSettlement,
    db: AsyncSession,
) -> VendorSettlementResponse:
    transaction = await db.get(PaymentTransaction, settlement.payment_transaction_id)
    vendor = await db.get(User, settlement.vendor_id)
    if not transaction or not vendor:
        raise RuntimeError("Settlement references unavailable payment data")
    return VendorSettlementResponse(
        id=settlement.id,
        payment_transaction_id=settlement.payment_transaction_id,
        order_id=settlement.order_id,
        vendor_id=settlement.vendor_id,
        vendor_name=vendor.shop_name or vendor.full_name,
        payment_stage=transaction.payment_stage,
        provider_payment_id=transaction.provider_payment_id,
        gross_amount=_paise_to_amount(settlement.gross_amount_paise),
        platform_delivery_amount=_paise_to_amount(settlement.platform_delivery_paise),
        platform_fee_amount=_paise_to_amount(settlement.platform_fee_paise),
        payable_amount=_paise_to_amount(settlement.payable_amount_paise),
        status=settlement.status,
        payout_reference=settlement.payout_reference,
        notes=settlement.notes,
        paid_at=settlement.paid_at,
        created_at=settlement.created_at,
        updated_at=settlement.updated_at,
    )


async def _adjust_settlement_for_refund(
    transaction: PaymentTransaction,
    refund_delta_paise: int,
    db: AsyncSession,
) -> None:
    settlement = await db.scalar(
        select(VendorSettlement)
        .where(VendorSettlement.payment_transaction_id == transaction.id)
        .with_for_update()
    )
    if not settlement:
        return
    if refund_delta_paise > 0:
        settlement.payable_amount_paise = max(
            0, settlement.payable_amount_paise - refund_delta_paise
        )
    if settlement.status == "paid":
        settlement.status = "recovery_required"
        settlement.notes = "Customer refund processed after vendor payout; recovery review required."
    elif settlement.payable_amount_paise == 0:
        settlement.status = "cancelled"
        settlement.notes = "No vendor payout remains after customer refund."
    else:
        settlement.status = "held"
        settlement.notes = "Vendor payout held while the customer refund is reconciled."


async def _process_razorpay_webhook(
    payload: dict,
    event: PaymentWebhookEvent,
    db: AsyncSession,
) -> str:
    event_type = str(payload.get("event", ""))
    provider_payload = payload.get("payload") or {}
    payment = ((provider_payload.get("payment") or {}).get("entity") or {})
    refund = ((provider_payload.get("refund") or {}).get("entity") or {})
    provider_order_id = str(payment.get("order_id") or "") or None
    provider_payment_id = str(payment.get("id") or refund.get("payment_id") or "") or None
    event.provider_order_id = provider_order_id
    event.provider_payment_id = provider_payment_id

    if event_type in {"payment.captured", "order.paid"}:
        if not provider_order_id or not provider_payment_id:
            raise RuntimeError("Captured-payment webhook is missing provider identifiers")
        transaction = await db.scalar(
            select(PaymentTransaction)
            .where(PaymentTransaction.provider_order_id == provider_order_id)
            .with_for_update()
        )
        if not transaction:
            return "ignored"
        if (
            int(payment.get("amount", 0)) != transaction.amount_paise
            or str(payment.get("currency", "")).upper() != transaction.currency
            or str(payment.get("status", "")) != "captured"
        ):
            raise RuntimeError("Captured payment does not match the Vastrivo ledger")
        invoice, order, item = await _load_transaction_invoice(transaction, db)
        await _apply_captured_payment(
            transaction=transaction,
            invoice=invoice,
            order=order,
            item=item,
            payment_id=provider_payment_id,
            db=db,
        )
        return "processed"

    if event_type == "payment.failed":
        if not provider_order_id:
            return "ignored"
        transaction = await db.scalar(
            select(PaymentTransaction)
            .where(PaymentTransaction.provider_order_id == provider_order_id)
            .with_for_update()
        )
        if not transaction or transaction.status == "captured":
            return "ignored"
        transaction.provider_payment_id = provider_payment_id
        transaction.status = "failed"
        transaction.failure_code = str(payment.get("error_code") or "payment_failed")[:100]
        transaction.failure_reason = str(
            payment.get("error_description") or payment.get("error_reason") or "Payment failed"
        )[:500]
        return "processed"

    if event_type in {"refund.created", "refund.processed", "refund.failed"}:
        if not provider_payment_id:
            return "ignored"
        transaction = await db.scalar(
            select(PaymentTransaction)
            .where(PaymentTransaction.provider_payment_id == provider_payment_id)
            .with_for_update()
        )
        if not transaction:
            return "ignored"
        transaction.provider_refund_id = str(refund.get("id") or "") or transaction.provider_refund_id
        if event_type == "refund.failed":
            transaction.status = "refund_failed"
            transaction.failure_code = "refund_failed"
            transaction.failure_reason = str(
                refund.get("error_description") or "The payment provider could not complete the refund"
            )[:500]
            return "processed"

        provider_refunded = max(0, int(payment.get("amount_refunded", 0)))
        refund_delta = max(0, provider_refunded - transaction.amount_refunded_paise)
        if event_type == "refund.processed" or str(refund.get("status", "")) == "processed":
            transaction.amount_refunded_paise = min(transaction.amount_paise, provider_refunded)
            transaction.refunded_at = datetime.now(timezone.utc)
            transaction.status = (
                "refunded"
                if transaction.amount_refunded_paise >= transaction.amount_paise
                else "partially_refunded"
            )
            await _adjust_settlement_for_refund(transaction, refund_delta, db)
            if refund_delta > 0:
                db.add(Notification(
                    user_id=transaction.customer_id,
                    title=f"Refund processed for order #{transaction.order_id}",
                    message=(
                        f"₹{_paise_to_amount(refund_delta):,.2f} was refunded to your original payment method. "
                        f"Refund ID: {transaction.provider_refund_id}."
                    ),
                    notification_type="payment_refunded",
                    link="/orders",
                ))
        else:
            transaction.status = "refund_pending"
        return "processed"

    return "ignored"


def _valid_webhook_signature(body: bytes, received_signature: str, secret: str) -> bool:
    expected_signature = hmac.new(
        secret.encode("utf-8"),
        body,
        hashlib.sha256,
    ).hexdigest()
    return bool(received_signature) and hmac.compare_digest(
        expected_signature, received_signature
    )


@router.post("/webhook", include_in_schema=False)
async def razorpay_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """Authenticate and idempotently reconcile asynchronous Razorpay events."""
    if not settings.RAZORPAY_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Payment webhook is not configured")
    body = await request.body()
    if len(body) > 1_000_000:
        raise HTTPException(status_code=413, detail="Webhook payload is too large")
    received_signature = request.headers.get("x-razorpay-signature", "")
    if not _valid_webhook_signature(
        body, received_signature, settings.RAZORPAY_WEBHOOK_SECRET
    ):
        raise HTTPException(status_code=400, detail="Webhook signature verification failed")
    try:
        payload = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Webhook payload is invalid") from exc

    provider_event_id = request.headers.get("x-razorpay-event-id") or hashlib.sha256(body).hexdigest()
    existing = await db.scalar(
        select(PaymentWebhookEvent).where(
            PaymentWebhookEvent.provider_event_id == provider_event_id
        )
    )
    if existing and existing.status != "failed":
        return {"accepted": True, "duplicate": True}
    event = existing or PaymentWebhookEvent(
        provider="razorpay",
        provider_event_id=provider_event_id[:150],
        event_type=str(payload.get("event", "unknown"))[:100],
        status="received",
    )
    if not existing:
        db.add(event)
    event.status = "processing"
    event.error_message = None
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return {"accepted": True, "duplicate": True}

    event_id = event.id
    try:
        event = await db.get(PaymentWebhookEvent, event_id)
        if not event:
            raise RuntimeError("Webhook audit record was not found")
        event.status = await _process_razorpay_webhook(payload, event, db)
        event.processed_at = datetime.now(timezone.utc)
        await db.commit()
    except Exception as exc:
        await db.rollback()
        failed_event = await db.get(PaymentWebhookEvent, event_id)
        if failed_event:
            failed_event.status = "failed"
            failed_event.error_message = str(exc)[:1000]
            failed_event.processed_at = datetime.now(timezone.utc)
            await db.commit()
        raise HTTPException(status_code=500, detail="Webhook reconciliation failed") from exc
    return {"accepted": True, "duplicate": False}


@router.get("/admin/transactions", response_model=list[PaymentTransactionResponse])
async def list_payment_transactions(
    transaction_status: Optional[str] = Query(default=None, alias="status"),
    search: str = Query(default="", max_length=100),
    limit: int = Query(default=100, ge=1, le=250),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    customer = aliased(User)
    vendor = aliased(User)
    statement = (
        select(PaymentTransaction, customer.full_name, vendor.full_name)
        .join(customer, customer.id == PaymentTransaction.customer_id)
        .join(vendor, vendor.id == PaymentTransaction.vendor_id)
    )
    if transaction_status and transaction_status != "all":
        statement = statement.where(PaymentTransaction.status == transaction_status)
    query = search.strip()
    if query:
        pattern = f"%{query}%"
        statement = statement.where(
            PaymentTransaction.provider_order_id.ilike(pattern)
            | PaymentTransaction.provider_payment_id.ilike(pattern)
            | customer.full_name.ilike(pattern)
            | vendor.full_name.ilike(pattern)
        )
    rows = (await db.execute(statement.order_by(PaymentTransaction.created_at.desc()).limit(limit))).all()
    return [_payment_response(transaction, customer_name, vendor_name) for transaction, customer_name, vendor_name in rows]


@router.post("/admin/transactions/{transaction_id}/refund", response_model=PaymentTransactionResponse)
async def refund_payment_transaction(
    transaction_id: int,
    payload: AdminRefundRequest,
    admin: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    transaction = await db.scalar(
        select(PaymentTransaction)
        .where(PaymentTransaction.id == transaction_id)
        .with_for_update()
    )
    if not transaction or not transaction.provider_payment_id:
        raise HTTPException(status_code=404, detail="Captured payment not found")
    if transaction.status == "refund_pending":
        raise HTTPException(status_code=409, detail="A refund is already being processed")
    remaining = transaction.amount_paise - transaction.amount_refunded_paise
    if remaining <= 0:
        raise HTTPException(status_code=409, detail="This payment is already fully refunded")
    refund_amount = remaining if payload.amount is None else _amount_to_paise(payload.amount)
    if refund_amount > remaining:
        raise HTTPException(status_code=422, detail="Refund exceeds the remaining captured amount")

    receipt = f"vastrivo-rf-{transaction.id}-{transaction.amount_refunded_paise}-{refund_amount}"[:40]
    client = _razorpay_client()
    try:
        provider_refund = await run_in_threadpool(
            client.payment.refund,
            transaction.provider_payment_id,
            {
                "amount": refund_amount,
                "speed": "optimum",
                "receipt": receipt,
                "notes": {
                    "vastrivo_order_id": str(transaction.order_id),
                    "reason": payload.reason[:256],
                    "approved_by": str(admin.id),
                },
            },
        )
    except (BadRequestError, GatewayError, ServerError, requests.RequestException) as exc:
        raise _provider_error(exc) from exc

    refund_id = str(provider_refund.get("id", ""))
    if not refund_id.startswith("rfnd_") or int(provider_refund.get("amount", 0)) != refund_amount:
        raise HTTPException(status_code=500, detail="The payment provider returned an invalid refund")
    transaction.provider_refund_id = refund_id
    provider_status = str(provider_refund.get("status", "pending"))
    if provider_status == "processed":
        transaction.amount_refunded_paise += refund_amount
        transaction.refunded_at = datetime.now(timezone.utc)
        transaction.status = "refunded" if transaction.amount_refunded_paise >= transaction.amount_paise else "partially_refunded"
        await _adjust_settlement_for_refund(transaction, refund_amount, db)
    else:
        transaction.status = "refund_pending"
        settlement = await db.scalar(select(VendorSettlement).where(VendorSettlement.payment_transaction_id == transaction.id))
        if settlement:
            settlement.status = "recovery_required" if settlement.status == "paid" else "held"
            settlement.notes = "Vendor payout held while a customer refund is pending."
    db.add(Notification(
        user_id=transaction.customer_id,
        title=f"Refund initiated for order #{transaction.order_id}",
        message=f"A refund of ₹{_paise_to_amount(refund_amount):,.2f} was submitted. Refund ID: {refund_id}.",
        notification_type="payment_refund_initiated",
        link="/orders",
    ))
    await db.commit()
    customer = await db.get(User, transaction.customer_id)
    vendor = await db.get(User, transaction.vendor_id)
    return _payment_response(
        transaction,
        customer.full_name if customer else "Customer",
        (vendor.shop_name or vendor.full_name) if vendor else "Vendor",
    )


@router.get("/admin/settlements", response_model=list[VendorSettlementResponse])
async def list_vendor_settlements(
    settlement_status: Optional[str] = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=250),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    statement = select(VendorSettlement)
    if settlement_status and settlement_status != "all":
        statement = statement.where(VendorSettlement.status == settlement_status)
    settlements = (await db.execute(statement.order_by(VendorSettlement.created_at.desc()).limit(limit))).scalars().all()
    return [await _settlement_response(settlement, db) for settlement in settlements]


@router.put("/admin/settlements/{settlement_id}", response_model=VendorSettlementResponse)
async def update_vendor_settlement(
    settlement_id: int,
    payload: VendorSettlementUpdate,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    settlement = await db.scalar(
        select(VendorSettlement)
        .where(VendorSettlement.id == settlement_id)
        .with_for_update()
    )
    if not settlement:
        raise HTTPException(status_code=404, detail="Vendor settlement not found")
    payable_paise = _money_to_paise(payload.payable_amount)
    fee_paise = _money_to_paise(payload.platform_fee_amount)
    maximum_payable = max(0, settlement.gross_amount_paise - settlement.platform_delivery_paise)
    if payable_paise + fee_paise > maximum_payable:
        raise HTTPException(status_code=422, detail="Payout and platform fee exceed the vendor payment share")
    if payload.status == "paid" and not (payload.payout_reference or "").strip():
        raise HTTPException(status_code=422, detail="Add the bank or payout reference before marking paid")
    settlement.payable_amount_paise = payable_paise
    settlement.platform_fee_paise = fee_paise
    settlement.status = payload.status
    settlement.payout_reference = (payload.payout_reference or "").strip() or None
    settlement.notes = (payload.notes or "").strip() or None
    settlement.paid_at = datetime.now(timezone.utc) if payload.status == "paid" else None
    await db.commit()
    await db.refresh(settlement)
    return await _settlement_response(settlement, db)
