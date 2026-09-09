"""Rollback-only custom order references, colour and measurement checks."""
import asyncio
from uuid import uuid4
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException, Request
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import engine
from app.models import User, Design, OrderReferencePhoto, MeasurementProfile, DeliveryAddress
from app.schemas import OrderItemCreate, OrderCreate
from app.orders import create_order
from app.order_references import resolve_references, view_reference


async def rejects(call, code):
    try:
        await call
    except HTTPException as error:
        assert error.status_code == code, error
    else:
        raise AssertionError("Expected rejection")


async def verify():
    engine.echo = False
    async with engine.connect() as conn:
        transaction = await conn.begin()
        try:
            async with AsyncSession(bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint") as db:
                users = [User(full_name=f"Reference {i}", email=f"{uuid4().hex}@example.test", hashed_password="test-only", role="customer" if i == 0 else "vendor", is_active=True) for i in range(3)]
                db.add_all(users); await db.flush()
                customer, vendor, other = users
                designs = [Design(title=f"Reference {i}", description="Reference test garment", category="men", garment_type="kurta", base_price=0, vendor_id=vendor.id if i < 2 else other.id, status="approved", is_custom_request_template=i == 0) for i in range(3)]
                fit = MeasurementProfile(user_id=customer.id, profile_name="Selected fit", gender="men", garment_type="kurta", unit="inches", measurements={"chest": 40})
                address = DeliveryAddress(user_id=customer.id, recipient_name="Test", phone_number="9999999999", street_address="Test", city="Chennai", state="TN", postal_code="600001")
                photo = OrderReferencePhoto(id=str(uuid4()), user_id=customer.id, object_name="test-only", content_type="image/png")
                db.add_all([*designs, fit, address, photo]); await db.flush()
                item = OrderItemCreate(design_id=designs[0].id, measurement_profile_id=fit.id, cloth_source="vendor_supplied", colour_preference="  Navy   blue ", custom_instructions="Custom kurta with reference style", reference_design_ids=[designs[1].id], reference_photo_ids=[photo.id])
                assert item.colour_preference == "Navy blue"
                assert len(await resolve_references(item, designs[0], customer.id, db)) == 2
                await rejects(resolve_references(item, designs[0], other.id, db), 404)
                await rejects(resolve_references(item.model_copy(update={"reference_design_ids": [designs[2].id]}), designs[0], customer.id, db), 422)
                await rejects(resolve_references(item, designs[1], customer.id, db), 422)
                request = Request({"type": "http", "headers": []})
                await rejects(view_reference(photo.id, request, vendor, db), 404)
                with patch("app.orders.prepare_delivery_quotes", new=AsyncMock(return_value=[])):
                    result = await create_order(OrderCreate(address_id=address.id, items=[item], fulfilment_method="customer_self_pickup"), customer, db)
                assert result["order_items"][0]["colour_preference"] == "Navy blue"
                assert result["order_items"][0]["measurement_snapshot"]["measurements"]["chest"] == 40
                with patch("app.order_references.download_image_object", return_value=b"test"):
                    assert (await view_reference(photo.id, request, vendor, db)).body == b"test"
                await rejects(view_reference(photo.id, request, other, db), 404)
                try:
                    OrderItemCreate(**{**item.model_dump(), "colour_preference": "x" * 101})
                except ValidationError:
                    pass
                else:
                    raise AssertionError("Colour length not validated")
        finally:
            await transaction.rollback()
    await engine.dispose()
    print("Order references passed: colour persistence, selected fit snapshot, vendor designs, private photo access and validation.")


if __name__ == "__main__":
    asyncio.run(verify())
