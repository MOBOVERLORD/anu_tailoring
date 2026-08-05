"""Local delivery schema and migration smoke test without calling Google Maps."""

import asyncio
from decimal import Decimal

from sqlalchemy import select

from app.database import AsyncSessionLocal, engine
from app.deliveries import calculate_delivery_cost
from app.main import app, init_db_and_seed_admin
from app.models import DeliverySettings
from app.schemas import DeliverySettingsUpdate, DeliveryTrackingUpdate, VendorInvoiceUpsert


async def main() -> None:
    assert calculate_delivery_cost(1, 2.5) == 2.5
    assert calculate_delivery_cost(100, 2.5) == 2.5
    assert calculate_delivery_cost(101, 2.5) == 5.0
    assert calculate_delivery_cost(1_001, 0.75) == 8.25

    settings = DeliverySettingsUpdate(
        price_per_100m=Decimal("2.50"),
        provider_name="Example Logistics",
        provider_email="dispatch@example.com",
        is_active=False,
    )
    assert settings.price_per_100m == Decimal("2.50")

    try:
        DeliveryTrackingUpdate(status="booked", tracking_url="javascript:alert(1)")
    except ValueError:
        pass
    else:
        raise AssertionError("Unsafe tracking URL was accepted")

    try:
        VendorInvoiceUpsert(
            cloth_type="Cotton",
            cloth_requirement="Three metres of cotton",
            cloth_cost=Decimal("0"),
            delivery_cost=Decimal("500"),
        )
    except ValueError:
        pass
    else:
        raise AssertionError("Vendor invoice accepted a delivery price")

    await init_db_and_seed_admin()
    async with AsyncSessionLocal() as db:
        # The new table must be selectable after startup compatibility runs.
        await db.execute(select(DeliverySettings).limit(1))

    paths = app.openapi()["paths"]
    assert "/api/delivery/quote" in paths
    assert "/api/admin/delivery/settings" in paths
    assert "/api/admin/delivery/{delivery_id}" in paths
    await engine.dispose()
    print("Delivery pricing, validation, migrations, and API routes passed")


if __name__ == "__main__":
    asyncio.run(main())
