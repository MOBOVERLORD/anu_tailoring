from app.models import Product


def serialize_product(product: Product) -> dict:
    images = []
    for image in product.images:
        url = (
            f"/api/media/product-images/{image.id}"
            if image.upload_status == "ready"
            else None
        )
        images.append({
            "id": image.id,
            "original_filename": image.original_filename,
            "content_type": image.content_type,
            "size_bytes": image.size_bytes,
            "sort_order": image.sort_order,
            "upload_status": image.upload_status,
            "url": url,
        })
    cover = next((image["url"] for image in images if image["url"]), None)
    return {
        "id": product.id,
        "vendor_id": product.vendor_id,
        "vendor_name": product.vendor.full_name,
        "title": product.title,
        "description": product.description,
        "product_type": product.product_type,
        "category": product.category,
        "garment_type": product.garment_type,
        "price": product.price,
        "unit": product.unit,
        "stock_quantity": product.stock_quantity,
        "sizes": product.sizes or [],
        "colors": product.colors or [],
        "status": product.status,
        "rejection_comment": product.rejection_comment,
        "image_url": cover,
        "images": images,
        "created_at": product.created_at,
        "updated_at": product.updated_at,
    }
