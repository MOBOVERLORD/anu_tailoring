"""Local delivery/provider smoke test without calling an external map service."""

import asyncio
from decimal import Decimal
from types import SimpleNamespace

import httpx

from sqlalchemy import select

from app.database import AsyncSessionLocal, engine
from app.admin import update_managed_user
from app.addresses import (
    _apply_verified_location,
    _create_location_token,
    update_my_vendor_pickup,
)
from app.deliveries import calculate_delivery_cost
from app.main import app, init_db_and_seed_admin
from app import maps
from app.config import settings as app_settings
from app.models import DeliveryAddress, DeliverySettings, UserRole
from app.schemas import (
    AdminUserUpdate,
    BrowserLocationRequest,
    DeliverySettingsUpdate,
    DeliveryTrackingUpdate,
    VendorPickupUpdate,
    VendorInvoiceUpsert,
)


async def main() -> None:
    assert calculate_delivery_cost(1, 2.5) == 2.5
    assert calculate_delivery_cost(100, 2.5) == 2.5
    assert calculate_delivery_cost(101, 2.5) == 5.0
    assert calculate_delivery_cost(1_001, 0.75) == 8.25

    browser_location = BrowserLocationRequest(
        latitude=17.520818,
        longitude=78.381094,
        accuracy_meters=50,
    )
    resolved = SimpleNamespace(
        place_id="osm:way:281250533",
        formatted_address="Road No 1, Nizampet, Telangana, 500090, India",
        postal_code="500090",
    )
    location_token = _create_location_token(42, browser_location, resolved)
    address = DeliveryAddress(
        user_id=42,
        recipient_name="Receiver",
        phone_number="9999999999",
        street_address="Floor 2, Road No 1",
        city="Nizampet",
        state="Telangana",
        postal_code="500090",
        country="India",
        is_default=False,
    )
    _apply_verified_location(
        address,
        location_token,
        42,
        browser_location.latitude,
        browser_location.longitude,
    )
    assert address.latitude == browser_location.latitude
    assert address.longitude == browser_location.longitude
    assert address.google_place_id == resolved.place_id

    # Role assignment must not contain or require map/address data. Vendors own
    # their pickup setup after promotion and reuse the signed location proof.
    role_update = AdminUserUpdate(
        full_name="New Vendor",
        phone=None,
        location=None,
        role="vendor",
    )
    assert role_update.role == UserRole.VENDOR.value
    assert "vendor_pickup_address" not in AdminUserUpdate.model_fields

    class RoleDb:
        def __init__(self, managed_user) -> None:
            self.managed_user = managed_user
            self.notifications = []

        async def scalar(self, _statement):
            return self.managed_user

        async def execute(self, _statement):
            return None

        def add(self, value) -> None:
            self.notifications.append(value)

        async def commit(self) -> None:
            pass

        async def rollback(self) -> None:
            pass

        async def refresh(self, _value) -> None:
            pass

    promoted_user = SimpleNamespace(
        id=77,
        full_name="Promoted User",
        phone=None,
        location=None,
        role=UserRole.CUSTOMER.value,
    )
    role_db = RoleDb(promoted_user)
    await update_managed_user(
        promoted_user.id,
        role_update,
        _super_admin=SimpleNamespace(id=1),
        db=role_db,
    )
    assert promoted_user.role == UserRole.VENDOR.value
    assert len(role_db.notifications) == 1

    class FakeDb:
        async def commit(self) -> None:
            pass

        async def refresh(self, _value) -> None:
            pass

    vendor = SimpleNamespace(
        id=42,
        role=UserRole.VENDOR.value,
        vendor_pickup_address=None,
        vendor_pickup_place_id=None,
        vendor_pickup_latitude=None,
        vendor_pickup_longitude=None,
        vendor_pickup_geocoded_at=None,
    )
    await update_my_vendor_pickup(
        VendorPickupUpdate(
            pickup_address="Shop 11, Road No 1, Nizampet, Telangana 500090",
            pickup_latitude=browser_location.latitude,
            pickup_longitude=browser_location.longitude,
            location_token=location_token,
        ),
        current_user=vendor,
        db=FakeDb(),
    )
    assert vendor.vendor_pickup_place_id == resolved.place_id
    assert vendor.vendor_pickup_latitude == browser_location.latitude

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

    original_client = maps.httpx.AsyncClient
    original_settings = {
        "MAPS_PROVIDER": app_settings.MAPS_PROVIDER,
        "ENVIRONMENT": app_settings.ENVIRONMENT,
        "OSM_MIN_REQUEST_INTERVAL_SECONDS": app_settings.OSM_MIN_REQUEST_INTERVAL_SECONDS,
    }
    requests: list[httpx.Request] = []

    def map_response(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("/search"):
            return httpx.Response(200, json=[{
                "display_name": "Hyderabad, Telangana, India",
                "osm_type": "relation",
                "osm_id": 1986051,
                "lat": "17.4065",
                "lon": "78.4772",
            }])
        if "/route/v1/driving/" in request.url.path:
            return httpx.Response(200, json={
                "code": "Ok",
                "routes": [{"distance": 12550.4, "duration": 1800.2}],
            })
        return httpx.Response(404)

    class MockAsyncClient:
        def __init__(self, **kwargs) -> None:
            self.client = original_client(
                transport=httpx.MockTransport(map_response),
                timeout=kwargs.get("timeout"),
            )

        async def __aenter__(self):
            return await self.client.__aenter__()

        async def __aexit__(self, exc_type, exc, traceback):
            return await self.client.__aexit__(exc_type, exc, traceback)

    try:
        app_settings.MAPS_PROVIDER = "openstreetmap"
        app_settings.ENVIRONMENT = "development"
        app_settings.OSM_MIN_REQUEST_INTERVAL_SECONDS = 0
        maps.httpx.AsyncClient = MockAsyncClient
        location = await maps.geocode_address("Hyderabad, Telangana 500001")
        route = await maps.compute_driving_route(
            17.4065, 78.4772, 17.3850, 78.4867
        )
        assert location.place_id == "osm:relation:1986051"
        assert location.latitude == 17.4065
        assert route.distance_meters == 12_550
        assert route.duration_seconds == 1_800
        assert len(requests) == 2
        assert requests[0].url.params["countrycodes"] == "in"
        assert requests[0].headers["User-Agent"].startswith("Vastrivo/")
        assert "78.4772000,17.4065000" in requests[1].url.path
    finally:
        maps.httpx.AsyncClient = original_client
        for name, value in original_settings.items():
            setattr(app_settings, name, value)

    await init_db_and_seed_admin()
    async with AsyncSessionLocal() as db:
        # The new table must be selectable after startup compatibility runs.
        await db.execute(select(DeliverySettings).limit(1))

    paths = app.openapi()["paths"]
    assert "/api/delivery/quote" in paths
    assert "/api/addresses/vendor-pickup" in paths
    assert "/api/admin/delivery/settings" in paths
    assert "/api/admin/delivery/{delivery_id}" in paths
    await engine.dispose()
    print("Delivery pricing, OSM provider contract, migrations, and API routes passed")


if __name__ == "__main__":
    asyncio.run(main())
