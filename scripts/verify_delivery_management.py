"""Local delivery/provider smoke test without calling an external map service."""

import asyncio
from decimal import Decimal
from types import SimpleNamespace

import httpx

from sqlalchemy import select

from app.database import AsyncSessionLocal, engine
from app.addresses import _apply_verified_location, _create_location_token
from app.deliveries import calculate_delivery_cost
from app.main import app, init_db_and_seed_admin
from app import maps
from app.config import settings as app_settings
from app.models import DeliveryAddress, DeliverySettings
from app.schemas import (
    BrowserLocationRequest,
    DeliverySettingsUpdate,
    DeliveryTrackingUpdate,
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
    assert "/api/admin/delivery/settings" in paths
    assert "/api/admin/delivery/{delivery_id}" in paths
    await engine.dispose()
    print("Delivery pricing, OSM provider contract, migrations, and API routes passed")


if __name__ == "__main__":
    asyncio.run(main())
