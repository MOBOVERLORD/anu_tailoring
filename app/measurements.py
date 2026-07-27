from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import MeasurementProfile, User
from app.schemas import MeasurementProfileCreate, MeasurementProfileResponse
from app.auth import get_current_user

router = APIRouter(prefix="/api/measurements", tags=["measurements"])


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
