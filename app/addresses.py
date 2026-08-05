from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.database import get_db
from app.models import DeliveryAddress, User
from app.schemas import DeliveryAddressCreate, DeliveryAddressUpdate, DeliveryAddressResponse
from app.auth import get_current_user
from app.deliveries import geocode_customer_address
from app.google_maps import GoogleMapsError, maps_configured

router = APIRouter(prefix="/api/addresses", tags=["addresses"])


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

    new_address = DeliveryAddress(**address_data.model_dump(), user_id=current_user.id)
    if maps_configured():
        try:
            await geocode_customer_address(new_address)
        except GoogleMapsError as exc:
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

    if update_fields.get("is_default") is True:
        await _clear_existing_default(current_user.id, db)

    for field, value in update_fields.items():
        setattr(address, field, value)

    address_fields = {
        "street_address", "city", "state", "postal_code", "country"
    }
    if address_fields.intersection(update_fields):
        address.google_place_id = None
        address.latitude = None
        address.longitude = None
        address.geocoded_at = None
        if maps_configured():
            try:
                await geocode_customer_address(address)
            except GoogleMapsError as exc:
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
