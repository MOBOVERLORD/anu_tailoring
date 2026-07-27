from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import Design, User
from app.schemas import DesignResponse
from app.auth import get_current_user

router = APIRouter(prefix="/api/designs", tags=["designs"])


@router.get("", response_model=List[DesignResponse])
async def get_designs(
    category: Optional[str] = None,
    garment_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(Design)
    if category:
        query = query.where(Design.category == category)
    if garment_type:
        query = query.where(Design.garment_type == garment_type)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{design_id}", response_model=DesignResponse)
async def get_design(design_id: int, db: AsyncSession = Depends(get_db)):
    design = await db.get(Design, design_id)
    if not design:
        raise HTTPException(status_code=404, detail="Design not found")
    return design


@router.post("/{design_id}/like", status_code=204)
async def like_design(
    design_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    design = await db.get(Design, design_id)
    if not design:
        raise HTTPException(status_code=404, detail="Design not found")

    result = await db.execute(
        select(User)
        .options(selectinload(User.liked_designs))
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
        .options(selectinload(User.liked_designs))
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
        .options(selectinload(User.liked_designs))
        .where(User.id == current_user.id)
    )
    user = result.scalar_one()
    return user.liked_designs
