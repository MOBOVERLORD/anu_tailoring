"""Local delivery/provider smoke test without calling an external map service."""

import asyncio
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import httpx

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal, engine
from app.admin import update_managed_user
from app.addresses import (
    _apply_verified_location,
    _create_location_token,
    update_my_vendor_delivery_settings,
    update_my_vendor_pickup,
)
from app.deliveries import (
    _create_quote_token,
    calculate_delivery_cost,
    ensure_tracking_number,
    assign_delivery_agent,
    update_assigned_delivery_status,
    update_delivery_agent_location,
    prepare_delivery_quotes,
    resolve_fulfilment_method,
)
from app.main import app, init_db_and_seed_admin
from app import maps
from app.config import settings as app_settings
from app.models import Delivery, DeliveryAddress, DeliverySettings, Order, OrderStatus, User, UserRole
from app.schemas import (
    AdminUserUpdate,
    BrowserLocationRequest,
    DeliverySettingsUpdate,
    DeliveryAgentLocationUpdate,
    DeliveryAgentStatusUpdate,
    DeliveryAssignmentUpdate,
    DeliveryTrackingUpdate,
    VendorPickupUpdate,
    VendorDeliverySettingsUpdate,
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
    assert AdminUserUpdate(
        full_name="Courier One", phone=None, location=None, role="delivery_agent"
    ).role == UserRole.DELIVERY_AGENT.value

    delivery_stub = SimpleNamespace(id=42, tracking_number=None)
    assert ensure_tracking_number(delivery_stub) == "VST-D00000042"
    assert ensure_tracking_number(delivery_stub) == "VST-D00000042"
    assert DeliveryAssignmentUpdate(delivery_agent_id=12).delivery_agent_id == 12
    assert DeliveryAgentStatusUpdate(status="picked_up").status == "picked_up"
    assert DeliveryAgentLocationUpdate(
        latitude=17.4065, longitude=78.4772, accuracy_meters=25
    ).accuracy_meters == 25

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
        shop_name=None,
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
        full_name="Vendor Test",
        shop_name="Vendor Test Shop",
        email="vendor@example.com",
        phone="9999999999",
        role=UserRole.VENDOR.value,
        vendor_pickup_address=None,
        vendor_pickup_place_id=None,
        vendor_pickup_latitude=None,
        vendor_pickup_longitude=None,
        vendor_pickup_geocoded_at=None,
        vendor_delivery_pricing="platform",
        vendor_delivery_fee=0,
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
    assert resolve_fulfilment_method(vendor, "home_delivery") == "platform_delivery"
    assert resolve_fulfilment_method(vendor, "customer_self_delivery") == "customer_self_delivery"
    assert resolve_fulfilment_method(vendor, "customer_self_pickup") == "customer_self_pickup"
    await update_my_vendor_delivery_settings(
        VendorDeliverySettingsUpdate(
            pricing="vendor",
            delivery_fee=Decimal("125.50"),
        ),
        current_user=vendor,
        db=FakeDb(),
    )
    assert vendor.vendor_delivery_pricing == "vendor"
    assert vendor.vendor_delivery_fee == 125.5
    assert resolve_fulfilment_method(vendor, "home_delivery") == "vendor_delivery"
    address.id = 99
    address.google_place_id = "osm:node:99"
    address.latitude = 17.50
    address.longitude = 78.40
    address.geocoded_at = datetime.now(timezone.utc)
    vendor.vendor_pickup_geocoded_at = datetime.now(timezone.utc)
    vendor_quote = (await prepare_delivery_quotes(
        [vendor], address, FakeDb(), fulfilment_method="home_delivery"
    ))[0]
    assert vendor_quote.fulfilment_method == "vendor_delivery"
    assert vendor_quote.delivery_cost == 125.5
    assert vendor_quote.distance_meters == 0
    vendor_token, _ = _create_quote_token(vendor_quote, address.id)
    verified_vendor_quote = (await prepare_delivery_quotes(
        [vendor],
        address,
        FakeDb(),
        {vendor.id: vendor_token},
        fulfilment_method="home_delivery",
    ))[0]
    assert verified_vendor_quote.delivery_cost == 125.5
    pickup_quote = (await prepare_delivery_quotes(
        [vendor], address, FakeDb(), fulfilment_method="customer_self_pickup"
    ))[0]
    assert pickup_quote.delivery_cost == 0
    assert pickup_quote.destination_address == vendor.vendor_pickup_address

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
    marker = uuid4().hex
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            async with AsyncSession(
                bind=connection,
                expire_on_commit=False,
                join_transaction_mode="create_savepoint",
            ) as db:
                customer = User(full_name="Delivery Customer", email=f"delivery-customer-{marker}@example.com", hashed_password="test", role=UserRole.CUSTOMER.value)
                persisted_vendor = User(full_name="Delivery Vendor", email=f"delivery-vendor-{marker}@example.com", hashed_password="test", role=UserRole.VENDOR.value, shop_name="Delivery Test Shop")
                agent = User(full_name="Delivery Agent", email=f"delivery-agent-{marker}@example.com", hashed_password="test", role=UserRole.DELIVERY_AGENT.value)
                administrator = User(full_name="Delivery Admin", email=f"delivery-admin-{marker}@example.com", hashed_password="test", role=UserRole.ADMIN.value)
                db.add_all([customer, persisted_vendor, agent, administrator])
                await db.flush()
                persisted_address = DeliveryAddress(user_id=customer.id, recipient_name=customer.full_name, phone_number="9999999999", street_address="Customer address", city="Hyderabad", state="Telangana", postal_code="500001")
                db.add(persisted_address)
                await db.flush()
                persisted_order = Order(user_id=customer.id, address_id=persisted_address.id, vendor_id=persisted_vendor.id, total_amount=100, status=OrderStatus.READY_FOR_SHIPPING)
                db.add(persisted_order)
                await db.flush()
                persisted_delivery = Delivery(order_id=persisted_order.id, vendor_id=persisted_vendor.id, fulfilment_method="platform_delivery", provider_name="Test provider", provider_email="dispatch@example.com", maps_provider="openstreetmap", origin_address="Vendor pickup", origin_latitude=17.40, origin_longitude=78.40, destination_address="Customer address", destination_latitude=17.50, destination_longitude=78.50, distance_meters=1000, duration_seconds=600, price_per_100m=1, delivery_cost=10, status="booked")
                db.add(persisted_delivery)
                await db.flush()
                ensure_tracking_number(persisted_delivery)
                await db.commit()

                assigned = await assign_delivery_agent(persisted_delivery.id, DeliveryAssignmentUpdate(delivery_agent_id=agent.id), administrator, db)
                assert assigned["delivery_agent_id"] == agent.id
                assert assigned["status"] == "booked"
                await update_delivery_agent_location(DeliveryAgentLocationUpdate(latitude=17.41, longitude=78.41, accuracy_meters=20), agent, db)
                picked_up = await update_assigned_delivery_status(persisted_delivery.id, DeliveryAgentStatusUpdate(status="picked_up"), agent, db)
                assert picked_up["status"] == "picked_up"
                assert (await db.get(Order, persisted_order.id)).status == OrderStatus.SHIPPED
                in_transit = await update_assigned_delivery_status(persisted_delivery.id, DeliveryAgentStatusUpdate(status="in_transit"), agent, db)
                assert in_transit["status"] == "in_transit"
                delivered = await update_assigned_delivery_status(persisted_delivery.id, DeliveryAgentStatusUpdate(status="delivered"), agent, db)
                assert delivered["status"] == "delivered"
                assert (await db.get(Order, persisted_order.id)).status == OrderStatus.DELIVERED
        finally:
            await transaction.rollback()
    async with AsyncSessionLocal() as db:
        # The new table must be selectable after startup compatibility runs.
        await db.execute(select(DeliverySettings).limit(1))

    paths = app.openapi()["paths"]
    assert "/api/delivery/quote" in paths
    assert "/api/addresses/vendor-pickup" in paths
    assert "/api/addresses/vendor-delivery-settings" in paths
    assert "/api/admin/delivery/settings" in paths
    assert "/api/admin/delivery/{delivery_id}" in paths
    assert "/api/admin/delivery/agents" in paths
    assert "/api/admin/delivery/{delivery_id}/assignment" in paths
    assert "/api/delivery-agent/location" in paths
    assert "/api/delivery-agent/deliveries" in paths
    assert "/api/delivery-agent/deliveries/{delivery_id}/status" in paths
    await engine.dispose()
    print("Delivery pricing, agent workflow, OSM provider contract, migrations, and API routes passed")


if __name__ == "__main__":
    asyncio.run(main())
