from pathlib import PurePath
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import require_vendor
from app.config import settings
from app.database import get_db
from app.design_service import serialize_design_async, serialize_designs_async
from app.models import (
    Design,
    DesignImage,
    DesignStatus,
    Notification,
    OrderItem,
    User,
    UserRole,
)
from app.schemas import (
    DesignCreate,
    DesignResponse,
    DesignUpdate,
    VendorSummaryResponse,
)
from app.storage import (
    bucket_name,
    delete_objects,
    design_image_object_name,
    safe_extension,
    upload_image_object,
    validate_image_bytes,
)

router = APIRouter(prefix="/api/vendor", tags=["vendor designs"])


async def _owned_design(
    design_id: int,
    vendor: User,
    db: AsyncSession,
    for_update: bool = False,
) -> Design:
    query = (
        select(Design)
        .where(
            Design.id == design_id,
            Design.vendor_id == vendor.id,
            Design.is_custom_request_template.is_(False),
        )
        .options(selectinload(Design.images), selectinload(Design.vendor))
    )
    if for_update:
        query = query.with_for_update()
    result = await db.execute(query)
    design = result.scalar_one_or_none()
    if not design:
        raise HTTPException(status_code=404, detail="Design not found")
    return design


def _ensure_editable(design: Design) -> None:
    if design.status not in {
        DesignStatus.DRAFT.value,
        DesignStatus.REJECTED.value,
        DesignStatus.APPROVED.value,
    }:
        raise HTTPException(
            status_code=409,
            detail="A design under review cannot be changed",
        )


def _move_to_draft(design: Design) -> None:
    design.status = DesignStatus.DRAFT.value
    design.rejection_comment = None
    design.reviewed_by_id = None
    design.reviewed_at = None


def _ensure_submittable(design: Design) -> None:
    if design.status not in {
        DesignStatus.DRAFT.value,
        DesignStatus.REJECTED.value,
    }:
        raise HTTPException(
            status_code=409,
            detail="Only a draft or rejected design can be submitted",
        )


@router.get("/summary", response_model=VendorSummaryResponse)
async def vendor_summary(
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Design.status, func.count(Design.id))
        .where(
            Design.vendor_id == vendor.id,
            Design.is_custom_request_template.is_(False),
        )
        .group_by(Design.status)
    )
    counts = {row[0]: row[1] for row in result.all()}
    return VendorSummaryResponse(
        draft=counts.get(DesignStatus.DRAFT.value, 0),
        submitted=counts.get(DesignStatus.SUBMITTED.value, 0),
        approved=counts.get(DesignStatus.APPROVED.value, 0),
        rejected=counts.get(DesignStatus.REJECTED.value, 0),
    )


@router.get("/designs", response_model=list[DesignResponse])
async def list_vendor_designs(
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Design)
        .where(
            Design.vendor_id == vendor.id,
            Design.is_custom_request_template.is_(False),
        )
        .options(selectinload(Design.images), selectinload(Design.vendor))
        .order_by(Design.updated_at.desc())
    )
    return await serialize_designs_async(list(result.scalars().all()))


@router.post(
    "/designs",
    response_model=DesignResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_vendor_design(
    payload: DesignCreate,
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    design = Design(
        **payload.model_dump(),
        vendor_id=vendor.id,
        status=DesignStatus.DRAFT.value,
    )
    db.add(design)
    await db.commit()
    return await serialize_design_async(await _owned_design(design.id, vendor, db))


@router.put("/designs/{design_id}", response_model=DesignResponse)
async def update_vendor_design(
    design_id: int,
    payload: DesignUpdate,
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    design = await _owned_design(design_id, vendor, db, for_update=True)
    _ensure_editable(design)
    for key, value in payload.model_dump().items():
        setattr(design, key, value)
    _move_to_draft(design)
    await db.commit()
    return await serialize_design_async(await _owned_design(design_id, vendor, db))


@router.delete("/designs/{design_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vendor_design(
    design_id: int,
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    design = await _owned_design(design_id, vendor, db, for_update=True)
    order_reference = await db.execute(
        select(OrderItem.id).where(OrderItem.design_id == design.id).limit(1)
    )
    if order_reference.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail="This design belongs to an order and cannot be deleted",
        )

    await run_in_threadpool(
        delete_objects,
        [image.object_name for image in design.images],
    )
    await db.delete(design)
    await db.commit()


@router.post(
    "/designs/{design_id}/images",
    response_model=DesignResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_design_image(
    design_id: int,
    file: UploadFile = File(...),
    sort_order: int = Form(0),
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    design = await _owned_design(design_id, vendor, db, for_update=True)
    _ensure_editable(design)
    if len(design.images) >= 10:
        raise HTTPException(
            status_code=409,
            detail="A design can contain at most 10 images",
        )
    if not 0 <= sort_order <= 9:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Image sort order must be between 0 and 9",
        )

    content_type = (file.content_type or "").lower()
    if content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only JPEG, PNG, and WebP images are supported",
        )

    max_bytes = settings.MAX_DESIGN_IMAGE_MB * 1024 * 1024
    try:
        data = await file.read(max_bytes + 1)
    finally:
        await file.close()
    if not data or len(data) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Each image must be between 1 byte and {settings.MAX_DESIGN_IMAGE_MB} MB",
        )
    validate_image_bytes(data, content_type)

    filename = PurePath(file.filename or "image").name
    extension = safe_extension(filename, content_type)
    object_name = design_image_object_name(
        vendor.id,
        design.id,
        uuid4().hex,
        extension,
    )
    await run_in_threadpool(upload_image_object, object_name, content_type, data)
    image = DesignImage(
        design_id=design.id,
        bucket_name=bucket_name(),
        object_name=object_name,
        original_filename=filename,
        content_type=content_type,
        size_bytes=len(data),
        upload_status="ready",
        sort_order=sort_order,
    )
    db.add(image)
    _move_to_draft(design)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        try:
            await run_in_threadpool(delete_objects, [object_name])
        except HTTPException:
            pass
        raise
    return await serialize_design_async(await _owned_design(design_id, vendor, db))


@router.delete(
    "/designs/{design_id}/images/{image_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_design_image(
    design_id: int,
    image_id: int,
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    design = await _owned_design(design_id, vendor, db, for_update=True)
    _ensure_editable(design)
    image = next((item for item in design.images if item.id == image_id), None)
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    try:
        await run_in_threadpool(delete_objects, [image.object_name])
    except HTTPException:
        if image.upload_status != "uploading":
            raise
        # An unfinished upload must not remain stuck in the database when the
        # bucket is temporarily unavailable. The pending-prefix lifecycle rule
        # removes any abandoned object independently.
    await db.delete(image)
    _move_to_draft(design)
    await db.commit()


@router.post("/designs/{design_id}/submit", response_model=DesignResponse)
async def submit_design_for_review(
    design_id: int,
    vendor: User = Depends(require_vendor),
    db: AsyncSession = Depends(get_db),
):
    design = await _owned_design(design_id, vendor, db)
    _ensure_submittable(design)
    ready_images = [image for image in design.images if image.upload_status == "ready"]
    if not 1 <= len(ready_images) <= 10:
        raise HTTPException(
            status_code=409,
            detail="Upload and finish between 1 and 10 images before submitting",
        )

    design.status = DesignStatus.SUBMITTED.value
    design.rejection_comment = None
    admins = (
        await db.execute(
            select(User).where(
                User.role.in_([
                    UserRole.ADMIN.value,
                    UserRole.SUPER_ADMIN.value,
                ]),
                User.is_active.is_(True),
            )
        )
    ).scalars().all()
    for admin in admins:
        db.add(
            Notification(
                user_id=admin.id,
                title="Design awaiting review",
                message=f'{vendor.full_name} submitted "{design.title}".',
                notification_type="design_submitted",
                link="/admin",
            )
        )
    await db.commit()
    return await serialize_design_async(await _owned_design(design_id, vendor, db))
