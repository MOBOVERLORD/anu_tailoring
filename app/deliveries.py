from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from jose import JWTError, jwt
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import require_admin, require_buyer, require_super_admin
from app.config import settings
from app.database import get_db
from app.google_maps import (
    GoogleMapsError,
    compute_driving_route,
    geocode_address,
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
    Product,
    ProductOrder,
    User,
)
from app.schemas import (
    DeliveryListResponse,
    DeliveryQuoteRequest,
    DeliveryQuoteResponse,
    DeliveryResponse,
    DeliverySettingsResponse,
    DeliverySettingsUpdate,
    DeliveryTrackingUpdate,
)


router = APIRouter(prefix="/api/delivery", tags=["delivery"])
admin_router = APIRouter(prefix="/api/admin/delivery", tags=["administration"])

GEOCODE_REFRESH_AFTER = timedelta(days=29)
QUOTE_VALID_FOR = timedelta(minutes=10)


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


def format_delivery_address(address: DeliveryAddress) -> str:
    return ", ".join(filter(None, [
        address.street_address,
        address.city,
        address.state,
        address.postal_code,
        address.country,
    ]))


def _geocode_is_fresh(geocoded_at: Optional[datetime]) -> bool:
    if not geocoded_at:
        return False
    if geocoded_at.tzinfo is None:
        geocoded_at = geocoded_at.replace(tzinfo=timezone.utc)
    return geocoded_at >= datetime.now(timezone.utc) - GEOCODE_REFRESH_AFTER


async def geocode_customer_address(address: DeliveryAddress) -> None:
    if (
        address.google_place_id
        and address.latitude is not None
        and address.longitude is not None
        and _geocode_is_fresh(address.geocoded_at)
    ):
        return
    result = await geocode_address(format_delivery_address(address))
    address.google_place_id = result.place_id
    address.latitude = result.latitude
    address.longitude = result.longitude
    address.geocoded_at = datetime.now(timezone.utc)


async def geocode_vendor_pickup(vendor: User, pickup_address: str) -> None:
    normalized = " ".join(pickup_address.split())
    if len(normalized) < 10:
        raise GoogleMapsError("Enter the vendor's complete pickup address")
    result = await geocode_address(normalized)
    vendor.vendor_pickup_address = result.formatted_address
    vendor.vendor_pickup_place_id = result.place_id
    vendor.vendor_pickup_latitude = result.latitude
    vendor.vendor_pickup_longitude = result.longitude
    vendor.vendor_pickup_geocoded_at = datetime.now(timezone.utc)


async def _ensure_vendor_pickup(vendor: User) -> None:
    if not vendor.vendor_pickup_address:
        raise GoogleMapsError(
            f"{vendor.full_name} does not have an administrator-verified pickup address"
        )
    if (
        vendor.vendor_pickup_place_id
        and vendor.vendor_pickup_latitude is not None
        and vendor.vendor_pickup_longitude is not None
        and _geocode_is_fresh(vendor.vendor_pickup_geocoded_at)
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
            detail="Google Maps delivery calculation is not configured on the server",
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
) -> list[PreparedDelivery]:
    delivery_settings = await active_delivery_settings(db)
    try:
        await geocode_customer_address(address)
        prepared: list[PreparedDelivery] = []
        for vendor in vendors:
            await _ensure_vendor_pickup(vendor)
            token = (quote_tokens or {}).get(vendor.id)
            if token:
                prepared.append(_prepared_delivery_from_token(
                    token, vendor, address, delivery_settings
                ))
                continue
            route = await compute_driving_route(
                vendor.vendor_pickup_latitude,
                vendor.vendor_pickup_longitude,
                address.latitude,
                address.longitude,
            )
            prepared.append(PreparedDelivery(
                vendor=vendor,
                settings=delivery_settings,
                origin_address=vendor.vendor_pickup_address,
                origin_place_id=vendor.vendor_pickup_place_id,
                origin_latitude=vendor.vendor_pickup_latitude,
                origin_longitude=vendor.vendor_pickup_longitude,
                destination_address=format_delivery_address(address),
                destination_place_id=address.google_place_id,
                destination_latitude=address.latitude,
                destination_longitude=address.longitude,
                distance_meters=route.distance_meters,
                duration_seconds=route.duration_seconds,
                delivery_cost=calculate_delivery_cost(
                    route.distance_meters, delivery_settings.price_per_100m
                ),
            ))
        return prepared
    except GoogleMapsError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _create_quote_token(
    quote: PreparedDelivery,
    address_id: int,
) -> tuple[str, datetime]:
    expires_at = datetime.now(timezone.utc) + QUOTE_VALID_FOR
    payload = {
        "type": "delivery_quote",
        "iss": settings.JWT_ISSUER,
        "aud": "anu-tailoring-delivery",
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
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM), expires_at


def _prepared_delivery_from_token(
    token: str,
    vendor: User,
    address: DeliveryAddress,
    delivery_settings: DeliverySettings,
) -> PreparedDelivery:
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
            audience="anu-tailoring-delivery",
            issuer=settings.JWT_ISSUER,
        )
        valid = (
            payload.get("type") == "delivery_quote"
            and int(payload.get("vendor_id")) == vendor.id
            and int(payload.get("address_id")) == address.id
            and payload.get("origin_place_id") == vendor.vendor_pickup_place_id
            and payload.get("destination_place_id") == address.google_place_id
            and float(payload.get("price_per_100m")) == delivery_settings.price_per_100m
            and payload.get("provider_name") == delivery_settings.provider_name
        )
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

    if distance_meters <= 0 or delivery_cost < 0:
        raise HTTPException(status_code=409, detail="The delivery quote is invalid")
    return PreparedDelivery(
        vendor=vendor,
        settings=delivery_settings,
        origin_address=vendor.vendor_pickup_address,
        origin_place_id=vendor.vendor_pickup_place_id,
        origin_latitude=vendor.vendor_pickup_latitude,
        origin_longitude=vendor.vendor_pickup_longitude,
        destination_address=format_delivery_address(address),
        destination_place_id=address.google_place_id,
        destination_latitude=address.latitude,
        destination_longitude=address.longitude,
        distance_meters=distance_meters,
        duration_seconds=duration_seconds,
        delivery_cost=delivery_cost,
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
    )


def serialize_delivery(delivery: Delivery) -> dict:
    business_order = delivery.order or delivery.product_order
    return {
        "id": delivery.id,
        "order_id": delivery.order_id,
        "product_order_id": delivery.product_order_id,
        "order_type": "tailoring" if delivery.order_id else "product",
        "vendor_id": delivery.vendor_id,
        "vendor_name": delivery.vendor.full_name,
        "customer_name": business_order.user.full_name,
        "customer_phone": business_order.address.phone_number,
        "provider_name": delivery.provider_name,
        "provider_email": delivery.provider_email,
        "provider_phone": delivery.provider_phone,
        "provider_details": delivery.provider_details,
        "origin_address": delivery.origin_address,
        "destination_address": delivery.destination_address,
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
        "provider_name": delivery.provider_name,
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
        selectinload(Delivery.order).selectinload(Order.user),
        selectinload(Delivery.order).selectinload(Order.address),
        selectinload(Delivery.product_order).selectinload(ProductOrder.user),
        selectinload(Delivery.product_order).selectinload(ProductOrder.address),
    )


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

    quote = (await prepare_delivery_quotes([subject.vendor], address, db))[0]
    quote_token, expires_at = _create_quote_token(quote, address.id)
    await db.commit()
    return {
        "vendor_id": subject.vendor.id,
        "vendor_name": subject.vendor.full_name,
        "distance_meters": quote.distance_meters,
        "duration_seconds": quote.duration_seconds,
        "delivery_cost": quote.delivery_cost,
        "price_per_100m": quote.settings.price_per_100m,
        "provider_name": quote.settings.provider_name,
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
            detail="Add GOOGLE_MAPS_API_KEY to the backend before activating delivery",
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
