from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.auth import get_current_user
from app.database import get_db
from app.models import DesignImage, DesignStatus, User, UserRole
from app.storage import download_image_object


router = APIRouter(prefix="/api/media", tags=["media"])


@router.get("/design-images/{image_id}", response_class=Response)
async def get_design_image(
    image_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(DesignImage)
        .where(DesignImage.id == image_id)
        .options(joinedload(DesignImage.design))
    )
    image = result.scalar_one_or_none()
    if not image or image.upload_status != "ready":
        raise HTTPException(status_code=404, detail="Image not found")

    design = image.design
    can_view = (
        design.status == DesignStatus.APPROVED.value
        or current_user.role in {
            UserRole.ADMIN.value,
            UserRole.SUPER_ADMIN.value,
        }
        or (
            current_user.role == UserRole.VENDOR.value
            and design.vendor_id == current_user.id
        )
    )
    if not can_view:
        raise HTTPException(status_code=404, detail="Image not found")

    content = await run_in_threadpool(download_image_object, image.object_name)
    return Response(
        content=content,
        media_type=image.content_type,
        headers={
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
        },
    )
