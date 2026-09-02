"""Verify secure vendor-customer identity, invitation, and ownership rules."""

import asyncio
from unittest.mock import patch
from uuid import uuid4

from fastapi import BackgroundTasks, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import UI_REQUEST_HEADER, confirm_password_reset
from app.database import engine
from app.main import app
from app.models import User, UserRole, VendorCustomerRelationship
from app.schemas import (
    PasswordResetConfirm,
    VendorCustomerInviteCreate,
    VendorCustomerLinkCreate,
    VendorCustomerNotesUpdate,
)
from app.vendor_customers import (
    get_vendor_customer,
    invite_vendor_customer,
    link_vendor_customer,
    list_vendor_customers,
    update_vendor_customer_notes,
)


async def expect_status(awaitable, expected_status: int) -> None:
    try:
        await awaitable
    except HTTPException as exc:
        if exc.status_code != expected_status:
            raise
    else:
        raise AssertionError(f"Expected HTTP {expected_status}")


async def verify() -> None:
    engine.echo = False
    paths = app.openapi()["paths"]
    expected_paths = {
        "/api/vendor/customers",
        "/api/vendor/customers/link",
        "/api/vendor/customers/invite",
        "/api/vendor/customers/{relationship_id}",
        "/api/customer/vendor-relationships/{relationship_id}/accept",
        "/api/customer/vendor-relationships/{relationship_id}/decline",
    }
    assert expected_paths <= set(paths), "Vendor customer API contract is incomplete"
    marker = uuid4().hex[:12]
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            async with AsyncSession(
                bind=connection,
                expire_on_commit=False,
                join_transaction_mode="create_savepoint",
            ) as db:
                vendor = User(
                    full_name="Relationship Test Tailor",
                    email=f"relationship-vendor-{marker}@example.com",
                    phone="9000000001",
                    hashed_password="test-only",
                    role=UserRole.VENDOR.value,
                )
                other_vendor = User(
                    full_name="Relationship Test Vendor Customer",
                    email=f"relationship-vendor-customer-{marker}@example.com",
                    phone="9000000002",
                    hashed_password="test-only",
                    role=UserRole.VENDOR.value,
                )
                customer = User(
                    full_name="Relationship Test Customer",
                    email=f"relationship-customer-{marker}@example.com",
                    phone="9000000003",
                    hashed_password="test-only",
                    role=UserRole.CUSTOMER.value,
                )
                administrator = User(
                    full_name="Relationship Test Administrator",
                    email=f"relationship-admin-{marker}@example.com",
                    phone="9000000004",
                    hashed_password="test-only",
                    role=UserRole.ADMIN.value,
                )
                db.add_all([vendor, other_vendor, customer, administrator])
                await db.commit()

                customer_payload = VendorCustomerLinkCreate(
                    email=customer.email,
                    phone="+91 90000 00003",
                    vendor_notes="Prefers morning appointments",
                )
                customer_link = await link_vendor_customer(customer_payload, vendor, db)
                assert customer_link.status == "pending_acceptance"
                duplicate_link = await link_vendor_customer(customer_payload, vendor, db)
                assert duplicate_link.id == customer_link.id

                vendor_customer_link = await link_vendor_customer(
                    VendorCustomerLinkCreate(
                        email=other_vendor.email,
                        phone=other_vendor.phone,
                    ),
                    vendor,
                    db,
                )
                assert vendor_customer_link.account_role == UserRole.VENDOR.value
                assert other_vendor.role == UserRole.VENDOR.value

                await expect_status(
                    link_vendor_customer(
                        VendorCustomerLinkCreate(
                            email=customer.email,
                            phone=other_vendor.phone,
                        ),
                        vendor,
                        db,
                    ),
                    409,
                )
                await expect_status(
                    link_vendor_customer(
                        VendorCustomerLinkCreate(
                            email=vendor.email,
                            phone=vendor.phone,
                        ),
                        vendor,
                        db,
                    ),
                    409,
                )
                await expect_status(
                    link_vendor_customer(
                        VendorCustomerLinkCreate(
                            email=administrator.email,
                            phone=administrator.phone,
                        ),
                        vendor,
                        db,
                    ),
                    409,
                )

                invite_payload = VendorCustomerInviteCreate(
                    full_name="Invited Relationship Customer",
                    email=f"relationship-invite-{marker}@example.com",
                    phone="9000000005",
                    vendor_notes="Invited from the shop counter",
                )
                raw_setup_token = f"setup-token-{marker}-secure"
                with patch(
                    "app.vendor_customers.secrets.token_urlsafe",
                    side_effect=[raw_setup_token, f"random-password-{marker}"],
                ):
                    invitation = await invite_vendor_customer(
                        invite_payload,
                        BackgroundTasks(),
                        vendor,
                        db,
                    )
                invited_user = await db.get(User, invitation.customer_user_id)
                assert invited_user.role == UserRole.CUSTOMER.value
                assert invited_user.hashed_password != raw_setup_token
                assert invitation.status == "invited"

                duplicate_invitation = await invite_vendor_customer(
                    invite_payload,
                    BackgroundTasks(),
                    vendor,
                    db,
                )
                assert duplicate_invitation.id == invitation.id
                invited_count = await db.scalar(
                    select(func.count(User.id)).where(
                        func.lower(User.email) == str(invite_payload.email).lower()
                    )
                )
                assert invited_count == 1

                result = await confirm_password_reset(
                    PasswordResetConfirm(
                        token=raw_setup_token,
                        new_password="SecureInvite123",
                    ),
                    Response(),
                    BackgroundTasks(),
                    UI_REQUEST_HEADER,
                    db,
                )
                assert "relationship accepted" in result["message"]
                saved_invitation = await db.get(
                    VendorCustomerRelationship, invitation.id
                )
                assert saved_invitation.status == "active"
                assert saved_invitation.accepted_at is not None

                updated = await update_vendor_customer_notes(
                    customer_link.id,
                    VendorCustomerNotesUpdate(vendor_notes="Updated private note"),
                    vendor,
                    db,
                )
                assert updated.vendor_notes == "Updated private note"
                page = await list_vendor_customers("", None, 20, 0, vendor, db)
                assert page.total == 3
                assert {item.id for item in page.items} == {
                    customer_link.id,
                    vendor_customer_link.id,
                    invitation.id,
                }

                await expect_status(
                    get_vendor_customer(customer_link.id, other_vendor, db),
                    404,
                )
        finally:
            await transaction.rollback()

    print(
        "Vendor customers passed: exact identity, vendor-as-customer, invitation, "
        "password setup, ownership, and duplicate constraints"
    )


if __name__ == "__main__":
    asyncio.run(verify())
