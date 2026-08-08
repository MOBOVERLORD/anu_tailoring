from datetime import datetime, timedelta, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.database import get_db
from app.config import settings
from app.models import DeliveryAddress, User
from app.schemas import (
    BrowserLocationRequest,
    DeliveryAddressCreate,
    DeliveryAddressUpdate,
    DeliveryAddressResponse,
    ResolvedLocationResponse,
)
from app.auth import get_current_user
from app.deliveries import geocode_customer_address, geocode_customer_coordinates
from app.maps import (
    MapProviderError,
    configured_maps_provider,
    maps_configured,
    maps_provider_label,
    reverse_geocode_location,
)

router = APIRouter(prefix="/api/addresses", tags=["addresses"])
LOCATION_TOKEN_AUDIENCE = "vastrivo-location"
LOCATION_TOKEN_VALID_FOR = timedelta(minutes=30)


def _create_location_token(user_id: int, location: BrowserLocationRequest, result) -> str:
    payload = {
        "type": "browser_location",
        "iss": settings.JWT_ISSUER,
        "aud": LOCATION_TOKEN_AUDIENCE,
        "exp": datetime.now(timezone.utc) + LOCATION_TOKEN_VALID_FOR,
        "user_id": user_id,
        "latitude": location.latitude,
        "longitude": location.longitude,
        "place_id": result.place_id,
        "maps_provider": configured_maps_provider(),
        "formatted_address": result.formatted_address,
        "postal_code": result.postal_code,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def _apply_verified_location(
    address: DeliveryAddress,
    token: str,
    user_id: int,
    latitude: float,
    longitude: float,
) -> None:
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
            audience=LOCATION_TOKEN_AUDIENCE,
            issuer=settings.JWT_ISSUER,
        )
        valid = (
            payload.get("type") == "browser_location"
            and int(payload.get("user_id")) == user_id
            and abs(float(payload.get("latitude")) - latitude) < 0.0000001
            and abs(float(payload.get("longitude")) - longitude) < 0.0000001
            and payload.get("maps_provider") == configured_maps_provider()
            and isinstance(payload.get("place_id"), str)
        )
        if not valid:
            raise ValueError("Location context changed")
        provider_postal_code = payload.get("postal_code")
        if provider_postal_code and address.postal_code != provider_postal_code:
            raise ValueError("PIN code changed")
    except (JWTError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=422,
            detail="The captured location expired or the address changed. Tap Update location and try again.",
        ) from exc

    address.google_place_id = payload["place_id"]
    address.latitude = latitude
    address.longitude = longitude
    address.geocoded_at = datetime.now(timezone.utc)


@router.post("/resolve-location", response_model=ResolvedLocationResponse)
async def resolve_browser_location(
    location: BrowserLocationRequest,
    current_user: User = Depends(get_current_user),
):
    try:
        result = await reverse_geocode_location(location.latitude, location.longitude)
    except MapProviderError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    missing_components = [
        label for label, value in (
            ("city/locality", result.city),
            ("state", result.state),
            ("PIN code", result.postal_code),
        ) if not value
    ]
    if missing_components:
        raise HTTPException(
            status_code=422,
            detail=(
                "The map provider could not determine "
                + ", ".join(missing_components)
                + " here. Choose a nearby mapped road or building."
            ),
        )
    return ResolvedLocationResponse(
        latitude=location.latitude,
        longitude=location.longitude,
        accuracy_meters=location.accuracy_meters,
        formatted_address=result.formatted_address,
        place_id=result.place_id,
        provider_name=maps_provider_label(),
        street_address=result.street_address,
        city=result.city,
        state=result.state,
        postal_code=result.postal_code,
        country=result.country,
        location_token=_create_location_token(current_user.id, location, result),
    )


async def _clear_existing_default(user_id: int, db: AsyncSession):
    await db.execute(
        update(DeliveryAddress)
        .where(DeliveryAddress.user_id == user_id, DeliveryAddress.is_default.is_(True))
        .values(is_default=False)
    )


@router.post("", response_model=DeliveryAddressResponse, status_code=201)
async def create_address(
    address_data: DeliveryAddressCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if address_data.is_default:
        await _clear_existing_default(current_user.id, db)

    new_address = DeliveryAddress(
        **address_data.model_dump(exclude={"location_token"}),
        user_id=current_user.id,
    )
    if address_data.latitude is not None and address_data.longitude is not None:
        if address_data.location_token:
            _apply_verified_location(
                new_address,
                address_data.location_token,
                current_user.id,
                address_data.latitude,
                address_data.longitude,
            )
        else:
            try:
                await geocode_customer_coordinates(
                    new_address, address_data.latitude, address_data.longitude
                )
            except MapProviderError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
    elif maps_configured():
        try:
            await geocode_customer_address(new_address)
        except MapProviderError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.add(new_address)
    await db.commit()
    await db.refresh(new_address)
    return new_address


@router.get("", response_model=List[DeliveryAddressResponse])
async def get_my_addresses(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(DeliveryAddress).where(DeliveryAddress.user_id == current_user.id)
    )
    return result.scalars().all()


async def _get_owned_address(
    address_id: int, current_user: User, db: AsyncSession
) -> DeliveryAddress:
    address = await db.get(DeliveryAddress, address_id)
    if not address or address.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Address not found")
    return address


@router.put("/{address_id}", response_model=DeliveryAddressResponse)
async def update_address(
    address_id: int,
    address_data: DeliveryAddressUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    address = await _get_owned_address(address_id, current_user, db)
    update_fields = address_data.model_dump(exclude_unset=True)
    location_token = update_fields.pop("location_token", None)
    previous_location = (
        address.latitude,
        address.longitude,
        address.google_place_id,
    )

    if update_fields.get("is_default") is True:
        await _clear_existing_default(current_user.id, db)

    for field, value in update_fields.items():
        setattr(address, field, value)

    address_fields = {
        "street_address", "city", "state", "postal_code", "country"
    }
    coordinates_supplied = (
        update_fields.get("latitude") is not None
        and update_fields.get("longitude") is not None
    )
    if coordinates_supplied:
        location_unchanged = (
            previous_location[0] == update_fields["latitude"]
            and previous_location[1] == update_fields["longitude"]
            and previous_location[2]
        )
        if location_token:
            _apply_verified_location(
                address,
                location_token,
                current_user.id,
                update_fields["latitude"],
                update_fields["longitude"],
            )
        elif not location_unchanged:
            try:
                await geocode_customer_coordinates(
                    address, update_fields["latitude"], update_fields["longitude"]
                )
            except MapProviderError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
    elif address_fields.intersection(update_fields):
        address.google_place_id = None
        address.latitude = None
        address.longitude = None
        address.geocoded_at = None
        if maps_configured():
            try:
                await geocode_customer_address(address)
            except MapProviderError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc

    await db.commit()
    await db.refresh(address)
    return address


@router.delete("/{address_id}", status_code=204)
async def delete_address(
    address_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    address = await _get_owned_address(address_id, current_user, db)
    try:
        await db.delete(address)
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="This address is referenced by an existing order and cannot be deleted",
        )
