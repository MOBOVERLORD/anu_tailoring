"""Rollback-only ownership, consent and validation regression."""
import asyncio
from uuid import uuid4
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import engine
from app.models import User, VendorCustomerRelationship, MeasurementCategory
from app.vendor_measurements import MeasurementWrite, create_profile, list_profiles, get_profile, update_profile, delete_profile, shared_profiles
from scripts.verify_vendor_customers import expect_status

async def verify():
    engine.echo = False
    async with engine.connect() as conn:
        transaction = await conn.begin()
        try:
            async with AsyncSession(bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint") as db:
                marker = uuid4().hex[:12]
                users = [User(full_name=f"Measure {i}", email=f"{marker}-{i}@example.com", hashed_password="test-only", role="vendor" if i < 2 else "customer") for i in range(3)]
                db.add_all(users)
                await db.flush()
                vendor, other, customer = users
                rel = VendorCustomerRelationship(vendor_id=vendor.id, customer_user_id=customer.id, status="pending_acceptance")
                rel2 = VendorCustomerRelationship(vendor_id=other.id, customer_user_id=customer.id, status="active")
                category = MeasurementCategory(name="Test category", garment_type=marker, gender="unisex", measurement_fields=[{"key": "chest", "label": "Chest"}], standard_sizes={})
                db.add_all([rel, rel2, category]); await db.flush()
                payload = MeasurementWrite(profile_name="Test fit", garment_type=marker, measurements={"chest": 38})
                profile = await create_profile(rel.id, payload, vendor, db)
                assert profile.created_by_vendor_id == vendor.id
                assert len(await list_profiles(rel.id, vendor, db)) == 1
                await expect_status(get_profile(rel.id, profile.id, other, db), 404)
                await expect_status(get_profile(rel2.id, profile.id, other, db), 404)
                await expect_status(update_profile(rel.id, profile.id, payload, other, db), 404)
                await expect_status(delete_profile(rel.id, profile.id, other, db), 404)
                assert not await shared_profiles(customer, db)
                rel.status = "active"; await db.flush()
                shared = await shared_profiles(customer, db)
                assert shared[0]["vendor_name"] == vendor.full_name
                assert not await shared_profiles(other, db)
                for values in ({}, {"unknown": 3}, {"chest": 0}, {"chest": float("nan")}, {"chest": 301}):
                    await expect_status(create_profile(rel.id, payload.model_copy(update={"measurements": values}), vendor, db), 422)
                await expect_status(create_profile(rel.id, payload.model_copy(update={"unit": "feet"}), vendor, db), 422)
                updated = await update_profile(rel.id, profile.id, payload.model_copy(update={"measurements": {"chest": 40}}), vendor, db)
                assert updated.measurements["chest"] == 40
                rel.status = "declined"; await db.flush()
                assert not await shared_profiles(customer, db)
                await expect_status(create_profile(rel.id, payload, vendor, db), 409)
                await delete_profile(rel.id, profile.id, vendor, db)
                assert not await list_profiles(rel.id, vendor, db)
        finally:
            await transaction.rollback()
    await engine.dispose()
    print("Vendor measurement CRUD, ownership, consent and validation passed")

if __name__ == "__main__":
    asyncio.run(verify())
