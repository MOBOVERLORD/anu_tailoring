from uuid import uuid4
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import get_current_user
from app.database import get_db
from app.media import _validated_account_image, _private_image_response
from app.models import Design, OrderItem, OrderReferencePhoto, User
from app.storage import profile_image_object_name, upload_image_object, download_image_object

router = APIRouter(prefix="/api/order-reference-photos", tags=["order references"])


@router.post("", status_code=201)
async def upload_reference(file: UploadFile = File(...), user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    data, content_type, filename = await _validated_account_image(file)
    photo_id = str(uuid4())
    # UUID keys prevent collisions even when environments share a bucket.
    from app.storage import safe_extension
    object_name = profile_image_object_name(user.id, f"order-reference-{photo_id}", safe_extension(filename, content_type))
    await run_in_threadpool(upload_image_object, object_name, content_type, data)
    db.add(OrderReferencePhoto(id=photo_id, user_id=user.id, object_name=object_name, content_type=content_type))
    await db.commit()
    return {"id": photo_id, "url": f"/api/order-reference-photos/{photo_id}"}


@router.get("/{photo_id}")
async def view_reference(photo_id: str, request: Request, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    photo = await db.get(OrderReferencePhoto, photo_id)
    if not photo:
        raise HTTPException(404, "Reference photo not found")
    if photo.user_id != user.id:
        allowed = await db.scalar(select(OrderItem.id).join(Design, Design.id == OrderItem.design_id).where(
            Design.vendor_id == user.id,
            OrderItem.design_references.contains([{"photo_id": photo_id}]),
        ).limit(1))
        if not allowed:
            raise HTTPException(404, "Reference photo not found")
    content = await run_in_threadpool(download_image_object, photo.object_name)
    return _private_image_response(request, photo.object_name, photo.content_type, content)


async def resolve_references(item, design: Design, user_id: int, db: AsyncSession) -> list[dict]:
    if not design.is_custom_request_template and (item.reference_design_ids or item.reference_photo_ids):
        raise HTTPException(422, "Reference designs are for custom orders")
    references = []
    for reference_id in dict.fromkeys(item.reference_design_ids):
        reference = await db.get(Design, reference_id)
        if not reference or reference.vendor_id != design.vendor_id or reference.status != "approved" or reference.is_custom_request_template:
            raise HTTPException(422, "Choose an available design from this vendor")
        references.append({"design_id": reference.id, "title": reference.title})
    for photo_id in dict.fromkeys(item.reference_photo_ids):
        photo = await db.get(OrderReferencePhoto, photo_id)
        if not photo or photo.user_id != user_id:
            raise HTTPException(404, "Reference photo not found")
        references.append({"photo_id": photo.id, "url": f"/api/order-reference-photos/{photo.id}"})
    return references
