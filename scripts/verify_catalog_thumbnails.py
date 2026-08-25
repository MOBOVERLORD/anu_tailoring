"""Offline checks for private catalog thumbnail generation and API metadata."""

from io import BytesIO

from PIL import Image

from app.main import app
from app.storage import create_image_thumbnail, thumbnail_object_name


def main() -> None:
    source = BytesIO()
    Image.new("RGB", (2400, 1600), "#d97852").save(source, "JPEG", quality=95)

    thumbnail = create_image_thumbnail(source.getvalue())
    with Image.open(BytesIO(thumbnail)) as preview:
        assert preview.format == "WEBP"
        assert preview.size == (900, 600)

    assert (
        thumbnail_object_name("vendors/7/designs/11/photo.jpg")
        == "vendors/7/designs/11/photo.thumb.webp"
    )

    paths = app.openapi()["paths"]
    for path in (
        "/api/media/design-images/{image_id}",
        "/api/media/product-images/{image_id}",
    ):
        parameters = paths[path]["get"]["parameters"]
        assert any(parameter["name"] == "thumbnail" for parameter in parameters)

    print(f"Catalog thumbnail verification passed ({len(thumbnail)} bytes).")


if __name__ == "__main__":
    main()
