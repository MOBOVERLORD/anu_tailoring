from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import get_current_user, require_vendor
from app.database import get_db
from app.models import MeasurementCategory, User, VendorCustomerMeasurement, VendorCustomerRelationship, utcnow
from app.schemas import MeasurementProfileCreate
from app.vendor_customers import _load_relationship

router = APIRouter(tags=["vendor customer measurements"])

class MeasurementWrite(BaseModel):
    profile_name: str = Field(min_length=2, max_length=50)
    garment_type: str = Field(min_length=1, max_length=50)
    unit: str = "inches"
    measurements: dict[str, float]
    notes: str | None = Field(default=None, max_length=1000)

    @field_validator("profile_name", mode="before")
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value

class MeasurementRead(MeasurementWrite):
    id: int
    relationship_id: int
    created_by_vendor_id: int
    gender: str
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}

class SharedMeasurement(MeasurementRead):
    vendor_name: str

async def validated(payload, db):
    category = await db.scalar(select(MeasurementCategory).where(MeasurementCategory.garment_type == payload.garment_type, MeasurementCategory.is_active.is_(True)))
    if not category:
        raise HTTPException(422, "Select an active measurement category")
    keys = {field["key"] for field in category.measurement_fields}
    if not payload.measurements or set(payload.measurements) - keys:
        raise HTTPException(422, "Provide measurements using the selected category's fields")
    try:
        MeasurementProfileCreate(**payload.model_dump(), gender=category.gender)
    except ValueError:
        raise HTTPException(422, "Use inches or cm and finite measurement values greater than 0 and at most 300")
    return {**payload.model_dump(), "gender": category.gender}

async def owned(db, relationship_id, profile_id, vendor):
    relationship = await _load_relationship(db, relationship_id, vendor.id, for_update=True)
    profile = await db.scalar(select(VendorCustomerMeasurement).where(VendorCustomerMeasurement.id == profile_id, VendorCustomerMeasurement.relationship_id == relationship.id, VendorCustomerMeasurement.created_by_vendor_id == vendor.id))
    if not profile:
        raise HTTPException(404, "Measurement profile not found")
    return relationship, profile

@router.get("/api/vendor/customers/{relationship_id}/measurements", response_model=list[MeasurementRead])
async def list_profiles(relationship_id: int, vendor: User = Depends(require_vendor), db: AsyncSession = Depends(get_db)):
    await _load_relationship(db, relationship_id, vendor.id)
    return (await db.scalars(select(VendorCustomerMeasurement).where(VendorCustomerMeasurement.relationship_id == relationship_id, VendorCustomerMeasurement.created_by_vendor_id == vendor.id).order_by(VendorCustomerMeasurement.updated_at.desc()))).all()

@router.post("/api/vendor/customers/{relationship_id}/measurements", response_model=MeasurementRead, status_code=201)
async def create_profile(relationship_id: int, payload: MeasurementWrite, vendor: User = Depends(require_vendor), db: AsyncSession = Depends(get_db)):
    relationship = await _load_relationship(db, relationship_id, vendor.id, for_update=True)
    if relationship.status == "declined":
        raise HTTPException(409, "This relationship was declined")
    profile = VendorCustomerMeasurement(**await validated(payload, db), relationship_id=relationship.id, created_by_vendor_id=vendor.id)
    relationship.updated_at = utcnow()
    db.add(profile)
    await db.commit()
    await db.refresh(profile)
    return profile

@router.get("/api/vendor/customers/{relationship_id}/measurements/{profile_id}", response_model=MeasurementRead)
async def get_profile(relationship_id: int, profile_id: int, vendor: User = Depends(require_vendor), db: AsyncSession = Depends(get_db)):
    return (await owned(db, relationship_id, profile_id, vendor))[1]

@router.patch("/api/vendor/customers/{relationship_id}/measurements/{profile_id}", response_model=MeasurementRead)
async def update_profile(relationship_id: int, profile_id: int, payload: MeasurementWrite, vendor: User = Depends(require_vendor), db: AsyncSession = Depends(get_db)):
    relationship, profile = await owned(db, relationship_id, profile_id, vendor)
    if relationship.status == "declined":
        raise HTTPException(409, "This relationship was declined")
    for key, value in (await validated(payload, db)).items():
        setattr(profile, key, value)
    relationship.updated_at = utcnow()
    await db.commit()
    await db.refresh(profile)
    return profile

@router.delete("/api/vendor/customers/{relationship_id}/measurements/{profile_id}", status_code=204)
async def delete_profile(relationship_id: int, profile_id: int, vendor: User = Depends(require_vendor), db: AsyncSession = Depends(get_db)):
    relationship, profile = await owned(db, relationship_id, profile_id, vendor)
    relationship.updated_at = utcnow()
    await db.delete(profile)
    await db.commit()

@router.get("/api/measurements/vendor-recorded", response_model=list[SharedMeasurement])
async def shared_profiles(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(VendorCustomerMeasurement, User).join(VendorCustomerRelationship, VendorCustomerMeasurement.relationship_id == VendorCustomerRelationship.id).join(User, User.id == VendorCustomerRelationship.vendor_id).where(VendorCustomerRelationship.customer_user_id == user.id, VendorCustomerRelationship.status == "active").order_by(VendorCustomerMeasurement.updated_at.desc()))).all()
    return [{**MeasurementRead.model_validate(profile).model_dump(), "vendor_name": vendor.shop_name or vendor.full_name} for profile, vendor in rows]
