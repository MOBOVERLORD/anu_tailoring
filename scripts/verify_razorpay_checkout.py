"""Offline verification for Razorpay configuration, endpoints, and persistence."""

import asyncio
import hashlib
import hmac
from uuid import uuid4

from fastapi import HTTPException
from razorpay.errors import SignatureVerificationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import engine
from app.main import app, init_db_and_seed_admin
from app import orders, payments
from app.models import (
    DeliveryAddress,
    Order,
    OrderInvoice,
    OrderStatus,
    User,
    UserRole,
)
from app.payments import _amount_to_paise, _razorpay_client
from app.schemas import RazorpayOrderCreate, RazorpayPaymentVerify


def verify_offline_primitives() -> None:
    assert settings.RAZORPAY_KEY_ID
    assert settings.RAZORPAY_KEY_SECRET
    assert _amount_to_paise(1) == 100
    assert _amount_to_paise(527.35) == 52735
    try:
        _amount_to_paise(0.99)
    except HTTPException as exc:
        assert exc.status_code == 422
    else:
        raise AssertionError("Sub-minimum checkout amount was accepted")

    order_id = "order_VastrivoOfflineCheck"
    payment_id = "pay_VastrivoOfflineCheck"
    message = f"{order_id}|{payment_id}"
    signature = hmac.new(
        settings.RAZORPAY_KEY_SECRET.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    client = _razorpay_client()
    assert client.utility.verify_payment_signature({
        "razorpay_order_id": order_id,
        "razorpay_payment_id": payment_id,
        "razorpay_signature": signature,
    })
    try:
        client.utility.verify_payment_signature({
            "razorpay_order_id": order_id,
            "razorpay_payment_id": payment_id,
            "razorpay_signature": "0" * 64,
        })
    except SignatureVerificationError:
        pass
    else:
        raise AssertionError("Invalid Razorpay signature was accepted")

    paths = app.openapi()["paths"]
    assert "/api/payments/razorpay/create-order" in paths
    assert "/api/payments/razorpay/verify-payment" in paths
    assert "/api/orders/vendor/{order_id}/ship" in paths


async def verify_persisted_checkout() -> None:
    engine.echo = False
    await init_db_and_seed_admin()
    marker = uuid4().hex
    cloth_order_id = f"order_C{marker}"
    cloth_payment_id = f"pay_C{marker}"
    final_order_id = f"order_F{marker}"
    final_payment_id = f"pay_F{marker}"
    cloth_amount = 49900
    final_amount = 100000

    class FakeOrderApi:
        @staticmethod
        def create(data):
            assert data["currency"] == "INR"
            if data["notes"]["payment_for"] == "vendor_supplied_cloth":
                assert data["amount"] == cloth_amount
                return {"id": cloth_order_id, **data}
            assert data["notes"]["payment_for"] == "final_order_balance"
            assert data["amount"] == final_amount
            return {"id": final_order_id, **data}

    class FakePaymentApi:
        @staticmethod
        def fetch(payment_id):
            assert payment_id in {cloth_payment_id, final_payment_id}
            is_final = payment_id == final_payment_id
            return {
                "id": payment_id,
                "order_id": final_order_id if is_final else cloth_order_id,
                "amount": final_amount if is_final else cloth_amount,
                "currency": "INR",
                "status": "captured",
            }

    class FakeUtility:
        @staticmethod
        def verify_payment_signature(parameters):
            expected = hmac.new(
                settings.RAZORPAY_KEY_SECRET.encode("utf-8"),
                (
                    f"{parameters['razorpay_order_id']}|"
                    f"{parameters['razorpay_payment_id']}"
                ).encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()
            if not hmac.compare_digest(expected, parameters["razorpay_signature"]):
                raise SignatureVerificationError("Invalid signature")
            return True

    class FakeClient:
        order = FakeOrderApi()
        payment = FakePaymentApi()
        utility = FakeUtility()

    original_client_factory = payments._razorpay_client
    payments._razorpay_client = lambda: FakeClient()  # type: ignore[assignment]
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                async with AsyncSession(
                    bind=connection,
                    expire_on_commit=False,
                    join_transaction_mode="create_savepoint",
                ) as db:
                    customer = User(
                        full_name="Razorpay Test Customer",
                        email=f"razorpay-customer-{marker}@example.com",
                        hashed_password="test-only",
                        role=UserRole.CUSTOMER.value,
                    )
                    vendor = User(
                        full_name="Razorpay Test Vendor",
                        email=f"razorpay-vendor-{marker}@example.com",
                        hashed_password="test-only",
                        role=UserRole.VENDOR.value,
                    )
                    db.add_all([customer, vendor])
                    await db.flush()
                    address = DeliveryAddress(
                        user_id=customer.id,
                        recipient_name=customer.full_name,
                        phone_number="9999999999",
                        street_address="Offline payment test address",
                        city="Hyderabad",
                        state="Telangana",
                        postal_code="500001",
                    )
                    db.add(address)
                    await db.flush()
                    order = Order(
                        user_id=customer.id,
                        address_id=address.id,
                        vendor_id=vendor.id,
                        total_amount=1499,
                        status=OrderStatus.CONFIRMED,
                    )
                    db.add(order)
                    await db.flush()
                    invoice = OrderInvoice(
                        order_id=order.id,
                        vendor_id=vendor.id,
                        invoice_number=f"RP-{marker[:24]}",
                        service_amount=1000,
                        merchandise_amount=0,
                        cloth_source="vendor_supplied",
                        cloth_type="Test cotton",
                        cloth_requirement="Two metres for offline checkout verification",
                        cloth_cost=499,
                        delivery_cost=0,
                        status="approved",
                        payment_status="pending",
                        cloth_bill_object_name="test/cloth-bill.pdf",
                    )
                    db.add(invoice)
                    await db.commit()

                    checkout = await payments.create_razorpay_order(
                        RazorpayOrderCreate(
                            scope="combined_order", resource_id=order.id
                        ),
                        customer,
                        db,
                    )
                    assert checkout.order_id == cloth_order_id
                    assert checkout.amount == cloth_amount

                    signature = hmac.new(
                        settings.RAZORPAY_KEY_SECRET.encode("utf-8"),
                        f"{cloth_order_id}|{cloth_payment_id}".encode("utf-8"),
                        hashlib.sha256,
                    ).hexdigest()
                    verified = await payments.verify_razorpay_payment(
                        RazorpayPaymentVerify(
                            scope="combined_order",
                            resource_id=order.id,
                            razorpay_order_id=cloth_order_id,
                            razorpay_payment_id=cloth_payment_id,
                            razorpay_signature=signature,
                        ),
                        customer,
                        db,
                    )
                    assert verified.success
                    stored = await db.scalar(
                        select(OrderInvoice).where(OrderInvoice.id == invoice.id)
                    )
                    assert stored and stored.payment_status == "paid"
                    assert stored.gateway_payment_id == cloth_payment_id

                    final_checkout = await payments.create_razorpay_order(
                        RazorpayOrderCreate(
                            scope="combined_order_final", resource_id=order.id
                        ),
                        customer,
                        db,
                    )
                    assert final_checkout.order_id == final_order_id
                    assert final_checkout.amount == final_amount
                    final_signature = hmac.new(
                        settings.RAZORPAY_KEY_SECRET.encode("utf-8"),
                        f"{final_order_id}|{final_payment_id}".encode("utf-8"),
                        hashlib.sha256,
                    ).hexdigest()
                    final_verified = await payments.verify_razorpay_payment(
                        RazorpayPaymentVerify(
                            scope="combined_order_final",
                            resource_id=order.id,
                            razorpay_order_id=final_order_id,
                            razorpay_payment_id=final_payment_id,
                            razorpay_signature=final_signature,
                        ),
                        customer,
                        db,
                    )
                    assert final_verified.success
                    await db.refresh(stored)
                    assert stored.final_payment_status == "paid"
                    assert stored.final_gateway_payment_id == final_payment_id

                    shipped = await orders.ship_paid_combined_order(
                        order.id, vendor, db
                    )
                    assert shipped["status"] == OrderStatus.READY_FOR_SHIPPING
            finally:
                await transaction.rollback()
    finally:
        payments._razorpay_client = original_client_factory


def verify() -> None:
    verify_offline_primitives()
    asyncio.run(verify_persisted_checkout())
    print("Razorpay checkout verification passed")


if __name__ == "__main__":
    verify()
