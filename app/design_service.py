from app.models import Design


def serialize_design(design: Design) -> dict:
    images = []
    for image in design.images:
        url = None
        if image.upload_status == "ready":
            url = f"/api/media/design-images/{image.id}"
        images.append(
            {
                "id": image.id,
                "original_filename": image.original_filename,
                "content_type": image.content_type,
                "size_bytes": image.size_bytes,
                "sort_order": image.sort_order,
                "upload_status": image.upload_status,
                "url": url,
            }
        )

    cover = next((image["url"] for image in images if image["url"]), None)
    return {
        "id": design.id,
        "title": design.title,
        "description": design.description,
        "category": design.category,
        "garment_type": design.garment_type,
        "base_price": design.base_price,
        "image_url": cover,
        "vendor_id": design.vendor_id,
        "vendor_name": design.vendor.full_name if design.vendor else None,
        "status": design.status,
        "rejection_comment": design.rejection_comment,
        "images": images,
        "created_at": design.created_at,
        "updated_at": design.updated_at,
    }


async def serialize_design_async(design: Design) -> dict:
    return serialize_design(design)


async def serialize_designs_async(designs: list[Design]) -> list[dict]:
    return [serialize_design(design) for design in designs]
