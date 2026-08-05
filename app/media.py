from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.auth import get_current_user
from app.database import get_db
from app.models import (
    DesignImage,
    DesignStatus,
    ProductImage,
    ProductOrder,
    User,
    UserRole,
)
from app.storage import download_image_object, private_object_etag


router = APIRouter(prefix="/api/media", tags=["media"])


@router.get("/design-images/{image_id}", response_class=Response)
async def get_design_image(
    image_id: int,
    request: Request,
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

    etag = private_object_etag(image.object_name)
    cache_headers = {
        "Cache-Control": "private, max-age=300",
        "ETag": etag,
        "Vary": "Authorization, Cookie",
        "X-Content-Type-Options": "nosniff",
    }
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=cache_headers)

    content = await run_in_threadpool(download_image_object, image.object_name)
    return Response(
        content=content,
        media_type=image.content_type,
        headers=cache_headers,
    )


@router.get("/product-images/{image_id}", response_class=Response)
async def get_product_image(
    image_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    image = await db.scalar(
        select(ProductImage)
        .where(ProductImage.id == image_id)
        .options(joinedload(ProductImage.product))
    )
    if not image or image.upload_status != "ready":
        raise HTTPException(status_code=404, detail="Image not found")

    product = image.product
    can_view = (
        product.status == DesignStatus.APPROVED.value
        or current_user.role in {UserRole.ADMIN.value, UserRole.SUPER_ADMIN.value}
        or (
            current_user.role == UserRole.VENDOR.value
            and product.vendor_id == current_user.id
        )
    )
    if not can_view and current_user.role == UserRole.CUSTOMER.value:
        can_view = bool(await db.scalar(
            select(ProductOrder.id).where(
                ProductOrder.product_id == product.id,
                ProductOrder.user_id == current_user.id,
            ).limit(1)
        ))
    if not can_view:
        raise HTTPException(status_code=404, detail="Image not found")

    etag = private_object_etag(image.object_name)
    cache_headers = {
        "Cache-Control": "private, max-age=300",
        "ETag": etag,
        "Vary": "Authorization, Cookie",
        "X-Content-Type-Options": "nosniff",
    }
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=cache_headers)
    content = await run_in_threadpool(download_image_object, image.object_name)
    return Response(content=content, media_type=image.content_type, headers=cache_headers)
