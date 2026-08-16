from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import Design, DesignStatus, User
from app.schemas import DesignResponse
from app.auth import get_current_user
from app.design_service import serialize_design_async, serialize_designs_async

router = APIRouter(prefix="/api/designs", tags=["designs"])


@router.get("", response_model=List[DesignResponse])
async def get_designs(
    category: Optional[str] = None,
    garment_type: Optional[str] = None,
    vendor_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(Design)
        .where(
            Design.status == DesignStatus.APPROVED.value,
            Design.is_custom_request_template.is_(False),
        )
        .options(selectinload(Design.images), selectinload(Design.vendor))
        .order_by(Design.created_at.desc())
    )
    if category:
        query = query.where(Design.category == category)
    if garment_type:
        query = query.where(Design.garment_type == garment_type)
    if vendor_id is not None:
        query = query.where(Design.vendor_id == vendor_id)
    result = await db.execute(query)
    return await serialize_designs_async(list(result.scalars().all()))


@router.post("/{design_id}/like", status_code=204)
async def like_design(
    design_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    design = await db.scalar(
        select(Design).where(
            Design.id == design_id,
            Design.status == DesignStatus.APPROVED.value,
            Design.is_custom_request_template.is_(False),
        )
    )
    if not design:
        raise HTTPException(status_code=404, detail="Design not found")

    result = await db.execute(
        select(User)
        .options(
            selectinload(User.liked_designs).selectinload(Design.images),
            selectinload(User.liked_designs).selectinload(Design.vendor),
        )
        .where(User.id == current_user.id)
    )
    user = result.scalar_one()
    if design not in user.liked_designs:
        user.liked_designs.append(design)
        await db.commit()


@router.delete("/{design_id}/like", status_code=204)
async def unlike_design(
    design_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User)
        .options(
            selectinload(User.liked_designs).selectinload(Design.images),
            selectinload(User.liked_designs).selectinload(Design.vendor),
        )
        .where(User.id == current_user.id)
    )
    user = result.scalar_one()
    user.liked_designs = [d for d in user.liked_designs if d.id != design_id]
    await db.commit()


@router.get("/liked/me", response_model=List[DesignResponse])
async def get_my_liked_designs(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User)
        .options(
            selectinload(User.liked_designs).selectinload(Design.images),
            selectinload(User.liked_designs).selectinload(Design.vendor),
        )
        .where(User.id == current_user.id)
    )
    user = result.scalar_one()
    return await serialize_designs_async([
        design
        for design in user.liked_designs
        if design.status == DesignStatus.APPROVED.value
        and not design.is_custom_request_template
    ])


@router.get("/{design_id}", response_model=DesignResponse)
async def get_design(design_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Design)
        .where(
            Design.id == design_id,
            Design.status == DesignStatus.APPROVED.value,
            Design.is_custom_request_template.is_(False),
        )
        .options(selectinload(Design.images), selectinload(Design.vendor))
    )
    design = result.scalar_one_or_none()
    if not design:
        raise HTTPException(status_code=404, detail="Design not found")
    return await serialize_design_async(design)
