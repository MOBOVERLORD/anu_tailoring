from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.database import get_db
from app.models import MeasurementCategory, MeasurementProfile, VendorCustomerMeasurement, User
from app.schemas import (
    MeasurementCategoryCreate,
    MeasurementCategoryResponse,
    MeasurementProfileCreate,
    MeasurementProfileResponse,
)
from app.auth import get_current_user, require_admin

router = APIRouter(prefix="/api/measurements", tags=["measurements"])
admin_router = APIRouter(
    prefix="/api/admin/measurement-categories",
    tags=["administration"],
)


@router.get("/categories", response_model=List[MeasurementCategoryResponse])
async def list_measurement_categories(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(MeasurementCategory)
        .where(MeasurementCategory.is_active.is_(True))
        .order_by(MeasurementCategory.sort_order, MeasurementCategory.name)
    )
    return result.scalars().all()


async def _validated_category_payload(
    payload: MeasurementCategoryCreate,
) -> dict:
    data = payload.model_dump()
    fields = data["measurement_fields"]
    keys = [field["key"] for field in fields]
    if len(keys) != len(set(keys)):
        raise HTTPException(status_code=422, detail="Measurement field keys must be unique")
    unknown_size_fields = {
        key
        for values in data["standard_sizes"].values()
        for key in values
        if key not in keys
    }
    if unknown_size_fields:
        raise HTTPException(
            status_code=422,
            detail=f"Standard sizes contain unknown fields: {', '.join(sorted(unknown_size_fields))}",
        )
    return data


@admin_router.get("", response_model=List[MeasurementCategoryResponse])
async def list_all_measurement_categories(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(MeasurementCategory).order_by(
            MeasurementCategory.sort_order,
            MeasurementCategory.name,
        )
    )
    return result.scalars().all()


@admin_router.post("", response_model=MeasurementCategoryResponse, status_code=201)
async def create_measurement_category(
    payload: MeasurementCategoryCreate,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    category = MeasurementCategory(**await _validated_category_payload(payload))
    db.add(category)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Garment type already exists")
    await db.refresh(category)
    return category


@admin_router.put("/{category_id}", response_model=MeasurementCategoryResponse)
async def update_measurement_category(
    category_id: int,
    payload: MeasurementCategoryCreate,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    category = await db.get(MeasurementCategory, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Measurement category not found")
    for field, value in (await _validated_category_payload(payload)).items():
        setattr(category, field, value)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Garment type already exists")
    await db.refresh(category)
    return category


@admin_router.delete("/{category_id}", status_code=204)
async def delete_measurement_category(
    category_id: int,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    category = await db.get(MeasurementCategory, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Measurement category not found")
    in_use = await db.scalar(
        select(MeasurementProfile.id)
        .where(MeasurementProfile.garment_type == category.garment_type)
        .limit(1)
    )
    vendor_in_use = await db.scalar(select(VendorCustomerMeasurement.id).where(VendorCustomerMeasurement.garment_type == category.garment_type).limit(1))
    if in_use or vendor_in_use:
        raise HTTPException(
            status_code=409,
            detail="This category is used by measurement profiles. Deactivate it instead.",
        )
    await db.delete(category)
    await db.commit()


@router.post("", response_model=MeasurementProfileResponse, status_code=201)
async def create_measurement_profile(
    profile: MeasurementProfileCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    new_profile = MeasurementProfile(**profile.model_dump(), user_id=current_user.id)
    db.add(new_profile)
    await db.commit()
    await db.refresh(new_profile)
    return new_profile


@router.get("", response_model=List[MeasurementProfileResponse])
async def get_my_measurement_profiles(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(MeasurementProfile).where(MeasurementProfile.user_id == current_user.id)
    )
    return result.scalars().all()


async def _get_owned_profile(
    profile_id: int, current_user: User, db: AsyncSession
) -> MeasurementProfile:
    profile = await db.get(MeasurementProfile, profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Measurement profile not found")
    return profile


@router.get("/{profile_id}", response_model=MeasurementProfileResponse)
async def get_measurement_profile(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _get_owned_profile(profile_id, current_user, db)


@router.put("/{profile_id}", response_model=MeasurementProfileResponse)
async def update_measurement_profile(
    profile_id: int,
    profile_data: MeasurementProfileCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    profile = await _get_owned_profile(profile_id, current_user, db)
    for field, value in profile_data.model_dump().items():
        setattr(profile, field, value)
    await db.commit()
    await db.refresh(profile)
    return profile


@router.delete("/{profile_id}", status_code=204)
async def delete_measurement_profile(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    profile = await _get_owned_profile(profile_id, current_user, db)
    # Profiles referenced by past orders can't be deleted (FK is RESTRICT) —
    # the order's measurement_snapshot preserves that history regardless.
    try:
        await db.delete(profile)
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="This profile is referenced by an existing order and cannot be deleted",
        )
