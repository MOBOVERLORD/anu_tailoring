"""Verify vendor invoice, cloth, payment, and work-start gates without keeping test data."""

import asyncio
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import engine
from app.models import (
    DeliveryAddress,
    Design,
    DesignStatus,
    MeasurementProfile,
    Order,
    OrderInvoice,
    OrderItem,
    OrderStatus,
    User,
    UserRole,
    VendorInvoice,
)
from app.orders import (
    add_order_comment,
    advance_combined_item_work,
    advance_vendor_work,
    cancel_customer_order,
    confirm_combined_customer_cloth,
    confirm_customer_cloth_received,
    decide_vendor_invoice,
    issue_vendor_invoice,
    get_order,
    get_order_comments,
    reject_vendor_order_item,
    save_vendor_invoice,
    start_vendor_work,
    submit_cloth_payment,
    verify_cloth_payment,
)
from app.schemas import (
    InvoiceDecision,
    OrderCancellationRequest,
    OrderCommentCreate,
    PaymentReferenceCreate,
    VendorInvoiceLineItemUpsert,
    VendorInvoiceUpsert,
)


async def expect_conflict(action) -> None:
    try:
        await action
    except HTTPException as exc:
        if exc.status_code != 409:
            raise
    else:
        raise AssertionError("A guarded order action was unexpectedly allowed")


async def verify() -> None:
    engine.echo = False
    marker = uuid4().hex
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            async with AsyncSession(
                bind=connection,
                expire_on_commit=False,
                join_transaction_mode="create_savepoint",
            ) as db:
                customer = User(
                    full_name="Invoice Test Customer",
                    email=f"invoice-customer-{marker}@example.test",
                    hashed_password="test-only",
                    role=UserRole.CUSTOMER.value,
                )
                vendor = User(
                    full_name="Invoice Test Vendor",
                    email=f"invoice-vendor-{marker}@example.test",
                    hashed_password="test-only",
                    role=UserRole.VENDOR.value,
                )
                db.add_all([customer, vendor])
                await db.flush()

                measurement = MeasurementProfile(
                    user_id=customer.id,
                    profile_name="Test kurta fit",
                    gender="men",
                    garment_type="kurta",
                    unit="inches",
                    measurements={"chest": 40, "length": 42},
                )
                address = DeliveryAddress(
                    user_id=customer.id,
                    recipient_name=customer.full_name,
                    phone_number="9999999999",
                    street_address="Test address",
                    city="Chennai",
                    state="Tamil Nadu",
                    postal_code="600001",
                )
                design = Design(
                    title="Invoice workflow test design",
                    description="Temporary regression-test design",
                    category="men",
                    garment_type="kurta",
                    base_price=1200,
                    vendor_id=vendor.id,
                    status=DesignStatus.APPROVED.value,
                )
                db.add_all([measurement, address, design])
                await db.flush()

                order = Order(
                    user_id=customer.id,
                    address_id=address.id,
                    total_amount=2400,
                    status=OrderStatus.PENDING,
                )
                db.add(order)
                await db.flush()
                snapshot = {
                    "profile_name": measurement.profile_name,
                    "gender": measurement.gender,
                    "garment_type": measurement.garment_type,
                    "standard_size": None,
                    "unit": measurement.unit,
                    "measurements": measurement.measurements,
                    "notes": None,
                }
                vendor_cloth_item = OrderItem(
                    order_id=order.id,
                    design_id=design.id,
                    measurement_profile_id=measurement.id,
                    measurement_snapshot=snapshot,
                    cloth_source="vendor_supplied",
                    price=1200,
                )
                customer_cloth_item = OrderItem(
                    order_id=order.id,
                    design_id=design.id,
                    measurement_profile_id=measurement.id,
                    measurement_snapshot=snapshot,
                    cloth_source="customer_provided",
                    price=1200,
                )
                db.add_all([vendor_cloth_item, customer_cloth_item])
                await db.commit()

                await save_vendor_invoice(
                    vendor_cloth_item.id,
                    VendorInvoiceUpsert(
                        cloth_type="44-inch cotton",
                        cloth_requirement="3.5 metres based on the selected measurements",
                        cloth_cost=600,
                        line_items=[
                            VendorInvoiceLineItemUpsert(
                                name="Matching buttons",
                                quantity=8,
                                unit_price=10,
                            )
                        ],
                    ),
                    vendor,
                    db,
                )
                await issue_vendor_invoice(vendor_cloth_item.id, vendor, db)
                approved = await decide_vendor_invoice(
                    vendor_cloth_item.id,
                    InvoiceDecision(decision="approved"),
                    customer,
                    db,
                )
                assert approved["work_status"] == "awaiting_cloth_payment"
                assert approved["invoice"]["additional_amount"] == 80
                await expect_conflict(start_vendor_work(vendor_cloth_item.id, vendor, db))
                await expect_conflict(submit_cloth_payment(
                    vendor_cloth_item.id,
                    PaymentReferenceCreate(payment_reference="TEST-UPI-001"),
                    customer,
                    db,
                ))
                vendor_cloth_invoice = await db.scalar(
                    select(VendorInvoice).where(
                        VendorInvoice.order_item_id == vendor_cloth_item.id
                    )
                )
                vendor_cloth_invoice.cloth_bill_object_name = "test/cloth-bill.pdf"
                vendor_cloth_invoice.cloth_bill_content_type = "application/pdf"
                vendor_cloth_invoice.cloth_bill_original_filename = "cloth-bill.pdf"
                await db.commit()
                await submit_cloth_payment(
                    vendor_cloth_item.id,
                    PaymentReferenceCreate(payment_reference="TEST-UPI-001"),
                    customer,
                    db,
                )
                verified = await verify_cloth_payment(vendor_cloth_item.id, vendor, db)
                assert verified["work_status"] == "ready_to_start"
                started = await start_vendor_work(vendor_cloth_item.id, vendor, db)
                assert started["work_status"] == "fabric_cutting"
                stitched = await advance_vendor_work(vendor_cloth_item.id, vendor, db)
                assert stitched["work_status"] == "stitching"
                checked = await advance_vendor_work(vendor_cloth_item.id, vendor, db)
                assert checked["work_status"] == "quality_check"
                completed = await advance_vendor_work(vendor_cloth_item.id, vendor, db)
                assert completed["work_status"] == "completed"

                await save_vendor_invoice(
                    customer_cloth_item.id,
                    VendorInvoiceUpsert(
                        cloth_type="44-inch cotton",
                        cloth_requirement="3.5 metres based on the selected measurements",
                        cloth_cost=0,
                    ),
                    vendor,
                    db,
                )
                await issue_vendor_invoice(customer_cloth_item.id, vendor, db)
                own_cloth_approved = await decide_vendor_invoice(
                    customer_cloth_item.id,
                    InvoiceDecision(decision="approved"),
                    customer,
                    db,
                )
                assert own_cloth_approved["work_status"] == "awaiting_cloth"
                await expect_conflict(start_vendor_work(customer_cloth_item.id, vendor, db))
                received = await confirm_customer_cloth_received(customer_cloth_item.id, vendor, db)
                assert received["work_status"] == "ready_to_start"
                started = await start_vendor_work(customer_cloth_item.id, vendor, db)
                assert started["work_status"] == "fabric_cutting"

                combined_order = Order(
                    user_id=customer.id,
                    vendor_id=vendor.id,
                    address_id=address.id,
                    total_amount=1200,
                    status=OrderStatus.CONFIRMED,
                )
                db.add(combined_order)
                await db.flush()
                combined_item = OrderItem(
                    order_id=combined_order.id,
                    design_id=design.id,
                    measurement_profile_id=measurement.id,
                    measurement_snapshot=snapshot,
                    cloth_source="customer_provided",
                    price=1200,
                    work_status="awaiting_cloth",
                )
                combined_invoice = OrderInvoice(
                    order_id=combined_order.id,
                    vendor_id=vendor.id,
                    invoice_number=f"VERIFY-COMBINED-{marker[:16]}",
                    service_amount=1200,
                    cloth_source="customer_provided",
                    cloth_type="Customer cotton",
                    cloth_requirement="Three metres supplied by the customer",
                    cloth_cost=0,
                    status="approved",
                    payment_status="not_required",
                )
                db.add_all([combined_item, combined_invoice])
                await db.commit()
                vendor_view = await get_order(combined_order.id, vendor, db)
                customer_view = await get_order(combined_order.id, customer, db)
                assert vendor_view["id"] == combined_order.id
                assert customer_view["id"] == combined_order.id
                assert vendor_view["order_items"][0]["design"]["vendor_id"] == vendor.id
                combined_received = await confirm_combined_customer_cloth(
                    combined_order.id, vendor, db
                )
                assert combined_received["order_items"][0]["work_status"] == "ready_to_start"
                for expected in ("fabric_cutting", "stitching", "quality_check", "completed"):
                    combined_updated = await advance_combined_item_work(
                        combined_order.id, combined_item.id, vendor, db
                    )
                    assert combined_updated["order_items"][0]["work_status"] == expected

                # Invoice acceptance is the irreversible cancellation boundary.
                await expect_conflict(cancel_customer_order(
                    order.id,
                    OrderCancellationRequest(reason="Changed my plans"),
                    customer,
                    db,
                ))

                rejectable_order = Order(
                    user_id=customer.id,
                    address_id=address.id,
                    total_amount=1200,
                    status=OrderStatus.PENDING,
                )
                db.add(rejectable_order)
                await db.flush()
                rejectable_item = OrderItem(
                    order_id=rejectable_order.id,
                    design_id=design.id,
                    measurement_profile_id=measurement.id,
                    measurement_snapshot=snapshot,
                    cloth_source="customer_provided",
                    price=1200,
                )
                db.add(rejectable_item)
                await db.commit()
                rejected = await reject_vendor_order_item(
                    rejectable_item.id,
                    OrderCancellationRequest(reason="Capacity is unavailable this week"),
                    vendor,
                    db,
                )
                assert rejected["status"] == "cancelled"
                assert rejected["order_items"][0]["work_status"] == "rejected"

                cancellable_order = Order(
                    user_id=customer.id,
                    address_id=address.id,
                    total_amount=1200,
                    status=OrderStatus.PENDING,
                )
                db.add(cancellable_order)
                await db.flush()
                cancellable_item = OrderItem(
                    order_id=cancellable_order.id,
                    design_id=design.id,
                    measurement_profile_id=measurement.id,
                    measurement_snapshot=snapshot,
                    cloth_source="customer_provided",
                    price=1200,
                )
                db.add(cancellable_item)
                await db.commit()
                cancelled = await cancel_customer_order(
                    cancellable_order.id,
                    OrderCancellationRequest(reason="Placed this order by mistake"),
                    customer,
                    db,
                )
                assert cancelled["status"] == "cancelled"
                assert cancelled["total_amount"] == 0
                assert cancelled["order_items"][0]["work_status"] == "cancelled"
                await add_order_comment(
                    cancellable_item.id,
                    OrderCommentCreate(message="Can we discuss a future replacement order?"),
                    customer,
                    db,
                )
                chat_messages = await get_order_comments(
                    cancellable_item.id,
                    0,
                    vendor,
                    db,
                )
                assert any("future replacement" in message["message"] for message in chat_messages)
        finally:
            await transaction.rollback()

    print("Order workflow passed: invoice gates, cloth receipt, vendor progress, rejection, cancellation, and acceptance lock")


if __name__ == "__main__":
    asyncio.run(verify())
