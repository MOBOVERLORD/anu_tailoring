from pathlib import PurePath
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.auth import get_current_user, require_vendor
from app.config import settings
from app.database import get_db
from app.models import (
    DesignImage,
    DesignStatus,
    ProductImage,
    ProductOrder,
    User,
    UserRole,
)
from app.schemas import VendorApplicationResponse
from app.storage import (
    bucket_name,
    delete_objects,
    download_image_object,
    private_object_etag,
    profile_image_object_name,
    safe_extension,
    upload_image_object,
    validate_image_bytes,
    vendor_logo_object_name,
)


router = APIRouter(prefix="/api/media", tags=["media"])
ACCOUNT_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


async def _validated_account_image(file: UploadFile) -> tuple[bytes, str, str]:
    content_type = (file.content_type or "").lower()
    if content_type not in ACCOUNT_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Use a JPEG, PNG, or WebP image")
    max_bytes = settings.MAX_DESIGN_IMAGE_MB * 1024 * 1024
    data = await file.read(max_bytes + 1)
    if not data or len(data) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"Image must be no larger than {settings.MAX_DESIGN_IMAGE_MB} MB",
        )
    validate_image_bytes(data, content_type)
    filename = PurePath(file.filename or "image").name[:255]
    return data, content_type, filename


def _private_image_response(
    request: Request,
    object_name: str,
    content_type: str,
    content: bytes,
) -> Response:
    etag = private_object_etag(object_name)
    headers = {
        "Cache-Control": "private, max-age=300",
        "ETag": etag,
        "Vary": "Authorization, Cookie",
        "X-Content-Type-Options": "nosniff",
    }
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return Response(content=content, media_type=content_type, headers=headers)


@router.post("/profile-image", response_model=VendorApplicationResponse)
async def upload_profile_image(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    data, content_type, filename = await _validated_account_image(file)
    object_name = profile_image_object_name(
        current_user.id, uuid4().hex, safe_extension(filename, content_type)
    )
    await run_in_threadpool(upload_image_object, object_name, content_type, data)
    old_object = current_user.profile_image_object_name
    current_user.profile_image_bucket_name = bucket_name()
    current_user.profile_image_object_name = object_name
    current_user.profile_image_content_type = content_type
    current_user.profile_image_original_filename = filename
    current_user.profile_image_size_bytes = len(data)
    await db.commit()
    await db.refresh(current_user)
    if old_object and old_object != object_name:
        try:
            await run_in_threadpool(delete_objects, [old_object])
        except HTTPException:
            pass
    return current_user


@router.post("/vendor-logo", response_model=VendorApplicationResponse)
async def upload_vendor_logo(
    file: UploadFile = File(...),
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    data, content_type, filename = await _validated_account_image(file)
    object_name = vendor_logo_object_name(
        vendor.id, uuid4().hex, safe_extension(filename, content_type)
    )
    await run_in_threadpool(upload_image_object, object_name, content_type, data)
    old_object = vendor.vendor_logo_object_name
    vendor.vendor_logo_bucket_name = bucket_name()
    vendor.vendor_logo_object_name = object_name
    vendor.vendor_logo_content_type = content_type
    vendor.vendor_logo_original_filename = filename
    vendor.vendor_logo_size_bytes = len(data)
    await db.commit()
    await db.refresh(vendor)
    if old_object and old_object != object_name:
        try:
            await run_in_threadpool(delete_objects, [old_object])
        except HTTPException:
            pass
    return vendor


@router.get("/users/{user_id}/profile-image", response_class=Response)
async def get_profile_image(
    user_id: int,
    request: Request,
    viewer: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if not user or not user.profile_image_object_name or not user.profile_image_content_type:
        raise HTTPException(status_code=404, detail="Profile image not found")
    can_view = (
        viewer.id == user.id
        or viewer.role in {UserRole.ADMIN.value, UserRole.SUPER_ADMIN.value}
        or user.role == UserRole.VENDOR.value
    )
    if not can_view:
        raise HTTPException(status_code=404, detail="Profile image not found")
    content = await run_in_threadpool(download_image_object, user.profile_image_object_name)
    return _private_image_response(
        request, user.profile_image_object_name, user.profile_image_content_type, content
    )


@router.get("/vendors/{vendor_id}/logo", response_class=Response)
async def get_vendor_logo(
    vendor_id: int,
    request: Request,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vendor = await db.get(User, vendor_id)
    if (
        not vendor
        or vendor.role != UserRole.VENDOR.value
        or not vendor.vendor_logo_object_name
        or not vendor.vendor_logo_content_type
    ):
        raise HTTPException(status_code=404, detail="Vendor logo not found")
    content = await run_in_threadpool(download_image_object, vendor.vendor_logo_object_name)
    return _private_image_response(
        request, vendor.vendor_logo_object_name, vendor.vendor_logo_content_type, content
    )


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
