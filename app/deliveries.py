from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
import re
from typing import Iterable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from jose import JWTError, jwt
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import require_admin, require_buyer, require_delivery_agent, require_super_admin
from app.config import settings
from app.database import get_db
from app.maps import (
    MapProviderError,
    configured_maps_provider,
    compute_driving_route,
    geocode_address,
    reverse_geocode_location,
    location_reference_matches_provider,
    maps_configuration_message,
    maps_configured,
)
from app.models import (
    Delivery,
    DeliveryAddress,
    DeliverySettings,
    Design,
    DesignStatus,
    Notification,
    Order,
    OrderStatus,
    Product,
    ProductOrder,
    User,
    UserRole,
)
from app.schemas import (
    DeliveryListResponse,
    DeliveryAgentLocationUpdate,
    DeliveryAgentStatusUpdate,
    DeliveryAssignmentUpdate,
    DeliveryQuoteRequest,
    DeliveryQuoteResponse,
    DeliveryResponse,
    DeliverySettingsResponse,
    DeliverySettingsUpdate,
    DeliveryTrackingUpdate,
)


router = APIRouter(prefix="/api/delivery", tags=["delivery"])
admin_router = APIRouter(prefix="/api/admin/delivery", tags=["administration"])
agent_router = APIRouter(prefix="/api/delivery-agent", tags=["delivery agent"])

GEOCODE_REFRESH_AFTER = timedelta(days=29)
QUOTE_VALID_FOR = timedelta(minutes=10)
CUSTOMER_FULFILMENT_METHODS = {
    "home_delivery", "customer_self_delivery", "customer_self_pickup",
}


@dataclass(frozen=True)
class PreparedDelivery:
    vendor: User
    settings: DeliverySettings
    origin_address: str
    origin_place_id: str
    origin_latitude: float
    origin_longitude: float
    destination_address: str
    destination_place_id: str
    destination_latitude: float
    destination_longitude: float
    distance_meters: int
    duration_seconds: Optional[int]
    delivery_cost: float
    maps_provider: str
    fulfilment_method: str


def resolve_fulfilment_method(vendor: User, requested_method: str) -> str:
    if requested_method not in CUSTOMER_FULFILMENT_METHODS:
        raise HTTPException(status_code=422, detail="Choose a valid fulfilment method")
    if requested_method == "home_delivery":
        return (
            "vendor_delivery"
            if vendor.vendor_delivery_pricing == "vendor"
            else "platform_delivery"
        )
    return requested_method


def _non_platform_settings(vendor: User, method: str) -> DeliverySettings:
    if method == "vendor_delivery":
        return DeliverySettings(
            price_per_100m=0,
            provider_name=vendor.shop_name or vendor.full_name,
            provider_email=vendor.email,
            provider_phone=vendor.phone,
            communication_details="Delivery is managed directly by the vendor.",
            is_active=True,
        )
    label = (
        "Customer-arranged delivery"
        if method == "customer_self_delivery"
        else "Customer self pickup"
    )
    return DeliverySettings(
        price_per_100m=0,
        provider_name=label,
        provider_email=vendor.email,
        provider_phone=vendor.phone,
        communication_details="The customer selected a no-charge fulfilment option.",
        is_active=True,
    )


def format_delivery_address(address: DeliveryAddress) -> str:
    return ", ".join(filter(None, [
        address.street_address,
        address.city,
        address.state,
        address.postal_code,
        address.country,
    ]))


def _geocode_is_fresh(
    location_reference: Optional[str], geocoded_at: Optional[datetime]
) -> bool:
    if not location_reference_matches_provider(location_reference) or not geocoded_at:
        return False
    if geocoded_at.tzinfo is None:
        geocoded_at = geocoded_at.replace(tzinfo=timezone.utc)
    return geocoded_at >= datetime.now(timezone.utc) - GEOCODE_REFRESH_AFTER


async def geocode_customer_address(address: DeliveryAddress) -> None:
    if (
        address.google_place_id
        and address.latitude is not None
        and address.longitude is not None
        and _geocode_is_fresh(address.google_place_id, address.geocoded_at)
    ):
        return
    result = await geocode_address(format_delivery_address(address))
    address.google_place_id = result.place_id
    address.latitude = result.latitude
    address.longitude = result.longitude
    address.geocoded_at = datetime.now(timezone.utc)


async def geocode_customer_coordinates(
    address: DeliveryAddress, latitude: float, longitude: float
) -> None:
    result = await reverse_geocode_location(latitude, longitude)
    if address.postal_code and address.postal_code not in result.formatted_address:
        raise MapProviderError(
            "The captured location does not match this PIN code; move to the delivery address and try again"
        )
    address.google_place_id = result.place_id
    address.latitude = latitude
    address.longitude = longitude
    address.geocoded_at = datetime.now(timezone.utc)


async def geocode_vendor_pickup(vendor: User, pickup_address: str) -> None:
    normalized = " ".join(pickup_address.split())
    if len(normalized) < 10:
        raise MapProviderError("Enter the vendor's complete pickup address")
    result = await geocode_address(normalized)
    vendor.vendor_pickup_address = result.formatted_address
    vendor.vendor_pickup_place_id = result.place_id
    vendor.vendor_pickup_latitude = result.latitude
    vendor.vendor_pickup_longitude = result.longitude
    vendor.vendor_pickup_geocoded_at = datetime.now(timezone.utc)


async def geocode_vendor_pickup_coordinates(
    vendor: User, pickup_address: str, latitude: float, longitude: float
) -> None:
    normalized = " ".join(pickup_address.split())
    if len(normalized) < 10:
        raise MapProviderError("Enter the vendor's complete pickup address")
    result = await reverse_geocode_location(latitude, longitude)
    postal_codes = re.findall(r"\b\d{6}\b", normalized)
    if postal_codes and not any(code in result.formatted_address for code in postal_codes):
        raise MapProviderError(
            "The captured location does not match the pickup address PIN code"
        )
    vendor.vendor_pickup_address = normalized
    vendor.vendor_pickup_place_id = result.place_id
    vendor.vendor_pickup_latitude = latitude
    vendor.vendor_pickup_longitude = longitude
    vendor.vendor_pickup_geocoded_at = datetime.now(timezone.utc)


async def _ensure_vendor_pickup(vendor: User) -> None:
    if not vendor.vendor_pickup_address:
        raise MapProviderError(
            f"{vendor.full_name} has not configured a verified workshop pickup location"
        )
    if (
        vendor.vendor_pickup_place_id
        and vendor.vendor_pickup_latitude is not None
        and vendor.vendor_pickup_longitude is not None
        and _geocode_is_fresh(
            vendor.vendor_pickup_place_id, vendor.vendor_pickup_geocoded_at
        )
    ):
        return
    await geocode_vendor_pickup(vendor, vendor.vendor_pickup_address)


async def active_delivery_settings(db: AsyncSession) -> DeliverySettings:
    delivery_settings = await db.get(DeliverySettings, 1)
    if not delivery_settings or not delivery_settings.is_active:
        raise HTTPException(
            status_code=409,
            detail="Delivery ordering is unavailable until an administrator activates delivery pricing",
        )
    if delivery_settings.price_per_100m <= 0:
        raise HTTPException(status_code=409, detail="Delivery pricing has not been configured")
    if not maps_configured():
        raise HTTPException(
            status_code=503,
            detail=maps_configuration_message(),
        )
    return delivery_settings


def calculate_delivery_cost(distance_meters: int, price_per_100m: float) -> float:
    # Charge any started 100-metre block as one full configured unit.
    units = (distance_meters + 99) // 100
    cost = Decimal(units) * Decimal(str(price_per_100m))
    return float(cost.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


async def prepare_delivery_quotes(
    vendors: Iterable[User],
    address: DeliveryAddress,
    db: AsyncSession,
    quote_tokens: Optional[dict[int, str]] = None,
    fulfilment_method: str = "home_delivery",
) -> list[PreparedDelivery]:
    try:
        prepared: list[PreparedDelivery] = []
        for vendor in vendors:
            resolved_method = resolve_fulfilment_method(vendor, fulfilment_method)
            await _ensure_vendor_pickup(vendor)
            delivery_settings = (
                await active_delivery_settings(db)
                if resolved_method == "platform_delivery"
                else _non_platform_settings(vendor, resolved_method)
            )
            if resolved_method != "customer_self_pickup" and (
                address.latitude is None or address.longitude is None
            ):
                await geocode_customer_address(address)
            token = (quote_tokens or {}).get(vendor.id)
            if token:
                prepared.append(_prepared_delivery_from_token(
                    token, vendor, address, delivery_settings, resolved_method
                ))
                continue
            if resolved_method == "platform_delivery":
                route = await compute_driving_route(
                    vendor.vendor_pickup_latitude,
                    vendor.vendor_pickup_longitude,
                    address.latitude,
                    address.longitude,
                )
                destination_address = format_delivery_address(address)
                destination_place_id = address.google_place_id
                destination_latitude = address.latitude
                destination_longitude = address.longitude
                distance_meters = route.distance_meters
                duration_seconds = route.duration_seconds
                delivery_cost = calculate_delivery_cost(
                    route.distance_meters, delivery_settings.price_per_100m
                )
                maps_provider = configured_maps_provider()
            elif resolved_method == "customer_self_pickup":
                destination_address = vendor.vendor_pickup_address
                destination_place_id = vendor.vendor_pickup_place_id
                destination_latitude = vendor.vendor_pickup_latitude
                destination_longitude = vendor.vendor_pickup_longitude
                distance_meters = 0
                duration_seconds = None
                delivery_cost = 0
                maps_provider = "not_required"
            else:
                destination_address = format_delivery_address(address)
                destination_place_id = address.google_place_id
                destination_latitude = address.latitude
                destination_longitude = address.longitude
                distance_meters = 0
                duration_seconds = None
                delivery_cost = (
                    float(vendor.vendor_delivery_fee)
                    if resolved_method == "vendor_delivery"
                    else 0
                )
                maps_provider = "not_required"
            prepared.append(PreparedDelivery(
                vendor=vendor,
                settings=delivery_settings,
                origin_address=vendor.vendor_pickup_address,
                origin_place_id=vendor.vendor_pickup_place_id,
                origin_latitude=vendor.vendor_pickup_latitude,
                origin_longitude=vendor.vendor_pickup_longitude,
                destination_address=destination_address,
                destination_place_id=destination_place_id,
                destination_latitude=destination_latitude,
                destination_longitude=destination_longitude,
                distance_meters=distance_meters,
                duration_seconds=duration_seconds,
                delivery_cost=delivery_cost,
                maps_provider=maps_provider,
                fulfilment_method=resolved_method,
            ))
        return prepared
    except MapProviderError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _create_quote_token(
    quote: PreparedDelivery,
    address_id: int,
) -> tuple[str, datetime]:
    expires_at = datetime.now(timezone.utc) + QUOTE_VALID_FOR
    payload = {
        "type": "delivery_quote",
        "iss": settings.JWT_ISSUER,
        "aud": "vastrivo-delivery",
        "exp": expires_at,
        "vendor_id": quote.vendor.id,
        "address_id": address_id,
        "origin_place_id": quote.origin_place_id,
        "destination_place_id": quote.destination_place_id,
        "distance_meters": quote.distance_meters,
        "duration_seconds": quote.duration_seconds,
        "delivery_cost": quote.delivery_cost,
        "price_per_100m": quote.settings.price_per_100m,
        "provider_name": quote.settings.provider_name,
        "maps_provider": quote.maps_provider,
        "fulfilment_method": quote.fulfilment_method,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM), expires_at


def _prepared_delivery_from_token(
    token: str,
    vendor: User,
    address: DeliveryAddress,
    delivery_settings: DeliverySettings,
    fulfilment_method: str,
) -> PreparedDelivery:
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
            audience="vastrivo-delivery",
            issuer=settings.JWT_ISSUER,
        )
        valid = (
            payload.get("type") == "delivery_quote"
            and int(payload.get("vendor_id")) == vendor.id
            and int(payload.get("address_id")) == address.id
            and payload.get("origin_place_id") == vendor.vendor_pickup_place_id
            and payload.get("destination_place_id") == (
                vendor.vendor_pickup_place_id
                if fulfilment_method == "customer_self_pickup"
                else address.google_place_id
            )
            and float(payload.get("price_per_100m")) == delivery_settings.price_per_100m
            and payload.get("provider_name") == delivery_settings.provider_name
            and payload.get("fulfilment_method") == fulfilment_method
            and payload.get("maps_provider") == (
                configured_maps_provider()
                if fulfilment_method == "platform_delivery"
                else "not_required"
            )
        )
        if fulfilment_method == "vendor_delivery":
            valid = valid and float(payload.get("delivery_cost")) == float(vendor.vendor_delivery_fee)
        elif fulfilment_method in {"customer_self_delivery", "customer_self_pickup"}:
            valid = valid and float(payload.get("delivery_cost")) == 0
        if not valid:
            raise ValueError("Quote context changed")
        distance_meters = int(payload["distance_meters"])
        delivery_cost = float(payload["delivery_cost"])
        duration = payload.get("duration_seconds")
        duration_seconds = int(duration) if duration is not None else None
    except (JWTError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=409,
            detail="The delivery quote expired or changed. Refresh the quote before ordering.",
        ) from exc

    if (fulfilment_method == "platform_delivery" and distance_meters <= 0) or delivery_cost < 0:
        raise HTTPException(status_code=409, detail="The delivery quote is invalid")
    return PreparedDelivery(
        vendor=vendor,
        settings=delivery_settings,
        origin_address=vendor.vendor_pickup_address,
        origin_place_id=vendor.vendor_pickup_place_id,
        origin_latitude=vendor.vendor_pickup_latitude,
        origin_longitude=vendor.vendor_pickup_longitude,
        destination_address=(
            vendor.vendor_pickup_address
            if fulfilment_method == "customer_self_pickup"
            else format_delivery_address(address)
        ),
        destination_place_id=(
            vendor.vendor_pickup_place_id
            if fulfilment_method == "customer_self_pickup"
            else address.google_place_id
        ),
        destination_latitude=(
            vendor.vendor_pickup_latitude
            if fulfilment_method == "customer_self_pickup"
            else address.latitude
        ),
        destination_longitude=(
            vendor.vendor_pickup_longitude
            if fulfilment_method == "customer_self_pickup"
            else address.longitude
        ),
        distance_meters=distance_meters,
        duration_seconds=duration_seconds,
        delivery_cost=delivery_cost,
        maps_provider=str(payload["maps_provider"]),
        fulfilment_method=fulfilment_method,
    )


def delivery_from_prepared(
    quote: PreparedDelivery,
    *,
    order_id: Optional[int] = None,
    product_order_id: Optional[int] = None,
) -> Delivery:
    if (order_id is None) == (product_order_id is None):
        raise ValueError("A delivery must belong to exactly one order")
    return Delivery(
        order_id=order_id,
        product_order_id=product_order_id,
        vendor_id=quote.vendor.id,
        fulfilment_method=quote.fulfilment_method,
        provider_name=quote.settings.provider_name,
        provider_email=quote.settings.provider_email,
        provider_phone=quote.settings.provider_phone,
        provider_details=quote.settings.communication_details,
        origin_address=quote.origin_address,
        origin_place_id=quote.origin_place_id,
        origin_latitude=quote.origin_latitude,
        origin_longitude=quote.origin_longitude,
        destination_address=quote.destination_address,
        destination_place_id=quote.destination_place_id,
        destination_latitude=quote.destination_latitude,
        destination_longitude=quote.destination_longitude,
        distance_meters=quote.distance_meters,
        duration_seconds=quote.duration_seconds,
        price_per_100m=quote.settings.price_per_100m,
        delivery_cost=quote.delivery_cost,
        maps_provider=quote.maps_provider,
    )


def ensure_tracking_number(delivery: Delivery) -> str:
    """Create a stable internal tracking reference at vendor handoff."""
    if not delivery.tracking_number:
        if delivery.id is None:
            raise ValueError("Delivery must be persisted before tracking can be generated")
        delivery.tracking_number = f"VST-D{delivery.id:08d}"
    return delivery.tracking_number


def serialize_delivery(delivery: Delivery) -> dict:
    business_order = delivery.order or delivery.product_order
    agent = delivery.delivery_agent
    return {
        "id": delivery.id,
        "order_id": delivery.order_id,
        "product_order_id": delivery.product_order_id,
        "order_type": "tailoring" if delivery.order_id else "product",
        "vendor_id": delivery.vendor_id,
        "delivery_agent_id": delivery.delivery_agent_id,
        "delivery_agent_name": agent.full_name if agent else None,
        "delivery_agent_phone": agent.phone if agent else None,
        "delivery_agent_latitude": agent.delivery_agent_latitude if agent else None,
        "delivery_agent_longitude": agent.delivery_agent_longitude if agent else None,
        "delivery_agent_location_accuracy_meters": (
            agent.delivery_agent_location_accuracy_meters if agent else None
        ),
        "delivery_agent_location_updated_at": (
            agent.delivery_agent_location_updated_at if agent else None
        ),
        "assigned_at": delivery.assigned_at,
        "fulfilment_method": delivery.fulfilment_method,
        "vendor_name": delivery.vendor.shop_name or delivery.vendor.full_name,
        "customer_name": business_order.user.full_name,
        "customer_phone": business_order.address.phone_number,
        "provider_name": delivery.provider_name,
        "provider_email": delivery.provider_email,
        "provider_phone": delivery.provider_phone,
        "provider_details": delivery.provider_details,
        "maps_provider": delivery.maps_provider,
        "origin_address": delivery.origin_address,
        "destination_address": delivery.destination_address,
        "origin_latitude": delivery.origin_latitude,
        "origin_longitude": delivery.origin_longitude,
        "destination_latitude": delivery.destination_latitude,
        "destination_longitude": delivery.destination_longitude,
        "distance_meters": delivery.distance_meters,
        "duration_seconds": delivery.duration_seconds,
        "price_per_100m": delivery.price_per_100m,
        "delivery_cost": delivery.delivery_cost,
        "status": delivery.status,
        "tracking_number": delivery.tracking_number,
        "tracking_url": delivery.tracking_url,
        "external_reference": delivery.external_reference,
        "admin_notes": delivery.admin_notes,
        "status_updated_at": delivery.status_updated_at,
        "created_at": delivery.created_at,
        "updated_at": delivery.updated_at,
    }


def serialize_order_delivery(delivery: Delivery) -> dict:
    """Customer/vendor view excludes private route coordinates and admin notes."""
    return {
        "id": delivery.id,
        "vendor_id": delivery.vendor_id,
        "fulfilment_method": delivery.fulfilment_method,
        "provider_name": delivery.provider_name,
        "maps_provider": delivery.maps_provider,
        "destination_address": delivery.destination_address,
        "distance_meters": delivery.distance_meters,
        "duration_seconds": delivery.duration_seconds,
        "delivery_cost": delivery.delivery_cost,
        "status": delivery.status,
        "tracking_number": delivery.tracking_number,
        "tracking_url": delivery.tracking_url,
    }


def _delivery_options():
    return (
        selectinload(Delivery.vendor),
        selectinload(Delivery.delivery_agent),
        selectinload(Delivery.order).selectinload(Order.user),
        selectinload(Delivery.order).selectinload(Order.address),
        selectinload(Delivery.order).selectinload(Order.product_items),
        selectinload(Delivery.product_order).selectinload(ProductOrder.user),
        selectinload(Delivery.product_order).selectinload(ProductOrder.address),
    )


async def _loaded_delivery(delivery_id: int, db: AsyncSession) -> Delivery:
    result = await db.execute(
        select(Delivery).where(Delivery.id == delivery_id).options(*_delivery_options())
    )
    delivery = result.scalar_one_or_none()
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")
    return delivery


@router.post("/quote", response_model=DeliveryQuoteResponse)
async def quote_delivery(
    payload: DeliveryQuoteRequest,
    customer: User = Depends(require_buyer),
    db: AsyncSession = Depends(get_db),
):
    address = await db.get(DeliveryAddress, payload.address_id)
    if not address or address.user_id != customer.id:
        raise HTTPException(status_code=404, detail="Delivery address not found")
    if payload.design_id is not None:
        subject = await db.scalar(
            select(Design)
            .where(Design.id == payload.design_id)
            .options(selectinload(Design.vendor))
        )
        not_found = "Design or vendor not found"
    else:
        subject = await db.scalar(
            select(Product)
            .where(Product.id == payload.product_id)
            .options(selectinload(Product.vendor))
        )
        not_found = "Product or vendor not found"
    if (
        not subject
        or subject.status != DesignStatus.APPROVED.value
        or not subject.vendor
        or not subject.vendor.is_active
    ):
        raise HTTPException(status_code=404, detail=not_found)
    if customer.role == "vendor" and subject.vendor_id == customer.id:
        raise HTTPException(status_code=409, detail="Vendors cannot order their own listing")

    quote = (await prepare_delivery_quotes(
        [subject.vendor], address, db, fulfilment_method=payload.fulfilment_method
    ))[0]
    quote_token, expires_at = _create_quote_token(quote, address.id)
    await db.commit()
    return {
        "vendor_id": subject.vendor.id,
        "vendor_name": subject.vendor.full_name,
        "fulfilment_method": quote.fulfilment_method,
        "distance_meters": quote.distance_meters,
        "duration_seconds": quote.duration_seconds,
        "delivery_cost": quote.delivery_cost,
        "price_per_100m": quote.settings.price_per_100m,
        "provider_name": quote.settings.provider_name,
        "maps_provider": quote.maps_provider,
        "quote_token": quote_token,
        "expires_at": expires_at,
    }


def _settings_response(delivery_settings: Optional[DeliverySettings]) -> dict:
    return {
        "price_per_100m": delivery_settings.price_per_100m if delivery_settings else 0,
        "provider_name": delivery_settings.provider_name if delivery_settings else "",
        "provider_email": delivery_settings.provider_email if delivery_settings else "",
        "provider_phone": delivery_settings.provider_phone if delivery_settings else None,
        "communication_details": delivery_settings.communication_details if delivery_settings else None,
        "is_active": delivery_settings.is_active if delivery_settings else False,
        "maps_configured": maps_configured(),
        "maps_provider": configured_maps_provider(),
        "maps_configuration_message": maps_configuration_message(),
        "updated_at": delivery_settings.updated_at if delivery_settings else None,
    }


@admin_router.get("/settings", response_model=DeliverySettingsResponse)
async def get_delivery_settings(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return _settings_response(await db.get(DeliverySettings, 1))


@admin_router.put("/settings", response_model=DeliverySettingsResponse)
async def update_delivery_settings(
    payload: DeliverySettingsUpdate,
    admin: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    if payload.is_active and not maps_configured():
        raise HTTPException(
            status_code=409,
            detail=maps_configuration_message(),
        )
    delivery_settings = await db.get(DeliverySettings, 1, with_for_update=True)
    if not delivery_settings:
        delivery_settings = DeliverySettings(id=1)
        db.add(delivery_settings)
    delivery_settings.price_per_100m = float(payload.price_per_100m)
    delivery_settings.provider_name = payload.provider_name
    delivery_settings.provider_email = str(payload.provider_email)
    delivery_settings.provider_phone = payload.provider_phone
    delivery_settings.communication_details = payload.communication_details
    delivery_settings.is_active = payload.is_active
    delivery_settings.updated_by_id = admin.id
    await db.commit()
    await db.refresh(delivery_settings)
    return _settings_response(delivery_settings)


@admin_router.get("", response_model=DeliveryListResponse)
async def list_deliveries(
    delivery_status: Optional[str] = Query(default=None, alias="status", max_length=30),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=100_000),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    filters = []
    if delivery_status:
        filters.append(Delivery.status == delivery_status)
    total = await db.scalar(select(func.count(Delivery.id)).where(*filters))
    result = await db.execute(
        select(Delivery)
        .where(*filters)
        .options(*_delivery_options())
        .order_by(Delivery.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return {
        "items": [serialize_delivery(item) for item in result.scalars().all()],
        "total": total or 0,
        "limit": limit,
        "offset": offset,
    }


@admin_router.get("/agents", response_model=list[dict])
async def list_delivery_agents(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User)
        .where(
            User.role == UserRole.DELIVERY_AGENT.value,
            User.is_active.is_(True),
        )
        .order_by(User.full_name.asc())
    )
    return [
        {
            "id": agent.id,
            "full_name": agent.full_name,
            "email": agent.email,
            "phone": agent.phone,
            "location": agent.location,
            "latitude": agent.delivery_agent_latitude,
            "longitude": agent.delivery_agent_longitude,
            "accuracy_meters": agent.delivery_agent_location_accuracy_meters,
            "location_updated_at": agent.delivery_agent_location_updated_at,
        }
        for agent in result.scalars().all()
    ]


@admin_router.put("/{delivery_id}/assignment", response_model=DeliveryResponse)
async def assign_delivery_agent(
    delivery_id: int,
    payload: DeliveryAssignmentUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await db.scalar(select(Delivery.id).where(Delivery.id == delivery_id).with_for_update())
    delivery = await _loaded_delivery(delivery_id, db)
    if delivery.fulfilment_method != "platform_delivery":
        raise HTTPException(
            status_code=409,
            detail="Delivery agents can only be assigned to platform deliveries",
        )
    if delivery.status != "booked":
        raise HTTPException(
            status_code=409,
            detail="Assign an agent while the delivery is booked and awaiting pickup",
        )

    agent = None
    if payload.delivery_agent_id is not None:
        agent = await db.get(User, payload.delivery_agent_id)
        if (
            not agent
            or agent.role != UserRole.DELIVERY_AGENT.value
            or not agent.is_active
        ):
            raise HTTPException(status_code=422, detail="Choose an active delivery agent")

    delivery.delivery_agent_id = agent.id if agent else None
    delivery.assigned_by_id = admin.id if agent else None
    delivery.assigned_at = datetime.now(timezone.utc) if agent else None
    if agent:
        business_order_id = delivery.order_id or delivery.product_order_id
        db.add(Notification(
            user_id=agent.id,
            title=f"Delivery #{delivery.id} assigned to you",
            message=(
                f"Pick up order #{business_order_id} from "
                f"{delivery.vendor.shop_name or delivery.vendor.full_name}."
            ),
            notification_type="delivery_assigned",
            link="/delivery-agent",
        ))
    await db.commit()
    return serialize_delivery(await _loaded_delivery(delivery_id, db))


@agent_router.put("/location", response_model=dict)
async def update_delivery_agent_location(
    payload: DeliveryAgentLocationUpdate,
    agent: User = Depends(require_delivery_agent),
    db: AsyncSession = Depends(get_db),
):
    agent.delivery_agent_latitude = payload.latitude
    agent.delivery_agent_longitude = payload.longitude
    agent.delivery_agent_location_accuracy_meters = payload.accuracy_meters
    agent.delivery_agent_location_updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {
        "latitude": agent.delivery_agent_latitude,
        "longitude": agent.delivery_agent_longitude,
        "accuracy_meters": agent.delivery_agent_location_accuracy_meters,
        "location_updated_at": agent.delivery_agent_location_updated_at,
    }


@agent_router.get("/location", response_model=dict)
async def get_delivery_agent_location(
    agent: User = Depends(require_delivery_agent),
):
    return {
        "latitude": agent.delivery_agent_latitude,
        "longitude": agent.delivery_agent_longitude,
        "accuracy_meters": agent.delivery_agent_location_accuracy_meters,
        "location_updated_at": agent.delivery_agent_location_updated_at,
    }


@agent_router.get("/deliveries", response_model=DeliveryListResponse)
async def list_assigned_deliveries(
    delivery_status: Optional[str] = Query(default=None, alias="status", max_length=30),
    agent: User = Depends(require_delivery_agent),
    db: AsyncSession = Depends(get_db),
):
    filters = [Delivery.delivery_agent_id == agent.id]
    if delivery_status:
        filters.append(Delivery.status == delivery_status)
    result = await db.execute(
        select(Delivery)
        .where(*filters)
        .options(*_delivery_options())
        .order_by(Delivery.created_at.desc())
    )
    deliveries = result.scalars().all()
    return {"items": [serialize_delivery(item) for item in deliveries], "total": len(deliveries), "limit": 100, "offset": 0}


@agent_router.patch("/deliveries/{delivery_id}/status", response_model=DeliveryResponse)
async def update_assigned_delivery_status(
    delivery_id: int,
    payload: DeliveryAgentStatusUpdate,
    agent: User = Depends(require_delivery_agent),
    db: AsyncSession = Depends(get_db),
):
    await db.scalar(select(Delivery.id).where(Delivery.id == delivery_id).with_for_update())
    delivery = await _loaded_delivery(delivery_id, db)
    if delivery.delivery_agent_id != agent.id:
        raise HTTPException(status_code=403, detail="This delivery is not assigned to you")
    transitions = {
        "booked": "picked_up",
        "picked_up": "in_transit",
        "in_transit": "delivered",
    }
    expected = transitions.get(delivery.status)
    if payload.status != expected:
        raise HTTPException(
            status_code=409,
            detail=f"The next delivery status must be {expected.replace('_', ' ') if expected else 'set by an administrator'}",
        )

    now = datetime.now(timezone.utc)
    delivery.status = payload.status
    delivery.status_updated_at = now
    if payload.status == "picked_up":
        delivery.picked_up_at = now
        if delivery.order:
            delivery.order.status = OrderStatus.SHIPPED
            for product_item in delivery.order.product_items:
                if product_item.status != "cancelled":
                    product_item.status = "shipped"
        elif delivery.product_order:
            delivery.product_order.status = "shipped"
    elif payload.status == "delivered":
        delivery.delivered_at = now
        if delivery.order:
            delivery.order.status = OrderStatus.DELIVERED
            for product_item in delivery.order.product_items:
                if product_item.status != "cancelled":
                    product_item.status = "delivered"
        elif delivery.product_order:
            delivery.product_order.status = "delivered"

    business_order = delivery.order or delivery.product_order
    order_id = delivery.order_id or delivery.product_order_id
    status_label = payload.status.replace("_", " ")
    for user_id in {business_order.user_id, delivery.vendor_id}:
        db.add(Notification(
            user_id=user_id,
            title=f"Delivery update for order #{order_id}",
            message=f"Delivery {delivery.tracking_number} is now {status_label}.",
            notification_type="delivery_status",
            link="/orders" if user_id == business_order.user_id else "/vendor/sales-orders",
        ))
    await db.commit()
    return serialize_delivery(await _loaded_delivery(delivery_id, db))


@admin_router.patch("/{delivery_id}", response_model=DeliveryResponse)
async def update_delivery_tracking(
    delivery_id: int,
    payload: DeliveryTrackingUpdate,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await db.scalar(
        select(Delivery.id).where(Delivery.id == delivery_id).with_for_update()
    )
    result = await db.execute(
        select(Delivery)
        .where(Delivery.id == delivery_id)
        .options(*_delivery_options())
    )
    delivery = result.scalar_one_or_none()
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")

    changed_status = delivery.status != payload.status
    delivery.status = payload.status
    delivery.tracking_number = payload.tracking_number
    delivery.tracking_url = payload.tracking_url
    delivery.external_reference = payload.external_reference
    delivery.admin_notes = payload.admin_notes
    if changed_status:
        delivery.status_updated_at = datetime.now(timezone.utc)
        status_label = payload.status.replace("_", " ")
        business_order = delivery.order or delivery.product_order
        order_id = delivery.order_id or delivery.product_order_id
        order_label = "order" if delivery.order_id else "shop order"
        for user_id in {business_order.user_id, delivery.vendor_id}:
            db.add(Notification(
                user_id=user_id,
                title=f"Delivery update for {order_label} #{order_id}",
                message=f"Delivery with {delivery.provider_name} is now {status_label}.",
                notification_type="delivery_status",
                link="/orders",
            ))
    await db.commit()

    refreshed = await db.execute(
        select(Delivery)
        .where(Delivery.id == delivery_id)
        .options(*_delivery_options())
    )
    return serialize_delivery(refreshed.scalar_one())
