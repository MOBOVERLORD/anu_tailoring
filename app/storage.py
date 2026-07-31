from functools import lru_cache
from pathlib import PurePath

from fastapi import HTTPException, status

from app.config import settings


def _raise_storage_error(action: str, exc: Exception) -> None:
    if isinstance(exc, HTTPException):
        raise exc

    error_name = type(exc).__name__
    if error_name == "DefaultCredentialsError":
        detail = (
            "Google Cloud credentials are unavailable. Install the Google Cloud CLI "
            "and run 'gcloud auth application-default login'."
        )
    elif error_name in {"Forbidden", "RefreshError", "TransportError", "Unauthorized"}:
        detail = (
            "Cloud Storage access was denied. Verify the bucket IAM role and the "
            "Service Account Token Creator permission."
        )
    else:
        detail = (
            f"Cloud Storage could not {action}. Verify local Google credentials, "
            "bucket configuration, and IAM permissions."
        )
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=detail,
    ) from exc


@lru_cache(maxsize=1)
def _storage_client():
    try:
        import google.auth
        from google.auth import impersonated_credentials
        from google.cloud import storage
    except ImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google Cloud Storage support is not installed",
        ) from exc

    if not settings.GCS_BUCKET_NAME:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GCS_BUCKET_NAME is not configured",
        )

    try:
        source_credentials, project_id = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        target_service_account = (
            str(settings.GCS_SIGNING_SERVICE_ACCOUNT)
            if settings.GCS_SIGNING_SERVICE_ACCOUNT
            else None
        )
        current_service_account = (
            getattr(source_credentials, "service_account_email", None)
            or getattr(source_credentials, "_target_principal", None)
        )

        # Local development starts with the developer's short-lived ADC and
        # impersonates the bucket runtime identity. Cloud Run normally skips this
        # because it already receives the attached service identity through ADC.
        if target_service_account and current_service_account != target_service_account:
            credentials = impersonated_credentials.Credentials(
                source_credentials=source_credentials,
                target_principal=target_service_account,
                target_scopes=["https://www.googleapis.com/auth/cloud-platform"],
                lifetime=3600,
            )
        else:
            credentials = source_credentials

        return storage.Client(project=project_id, credentials=credentials)
    except Exception as exc:
        _raise_storage_error("initialize the storage client", exc)


def bucket_name() -> str:
    if not settings.GCS_BUCKET_NAME:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GCS_BUCKET_NAME is not configured",
        )
    return settings.GCS_BUCKET_NAME


def safe_extension(filename: str, content_type: str) -> str:
    supported = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
    }
    extension = PurePath(filename).suffix.lower()
    return extension if extension in supported.values() else supported[content_type]


def design_image_object_name(
    vendor_id: int,
    design_id: int,
    image_key: str,
    extension: str,
) -> str:
    """Build the stable vendor/design prefix used inside the GCS bucket."""
    return f"vendors/{vendor_id}/designs/{design_id}/{image_key}{extension}"


def validate_image_bytes(data: bytes, content_type: str) -> None:
    signatures = {
        "image/jpeg": lambda value: value.startswith(b"\xff\xd8\xff"),
        "image/png": lambda value: value.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": lambda value: (
            len(value) >= 12
            and value.startswith(b"RIFF")
            and value[8:12] == b"WEBP"
        ),
    }
    validator = signatures.get(content_type)
    if not validator or not validator(data):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The uploaded file content does not match its image type",
        )


def upload_image_object(object_name: str, content_type: str, data: bytes) -> None:
    try:
        client = _storage_client()
        blob = client.bucket(bucket_name()).blob(object_name)
        blob.upload_from_string(
            data,
            content_type=content_type,
            if_generation_match=0,
        )
    except Exception as exc:
        _raise_storage_error("upload the image", exc)


def download_image_object(object_name: str) -> bytes:
    try:
        client = _storage_client()
        blob = client.bucket(bucket_name()).blob(object_name)
        return blob.download_as_bytes()
    except Exception as exc:
        if type(exc).__name__ == "NotFound":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Image file was not found",
            ) from exc
        _raise_storage_error("download the image", exc)


def delete_objects(object_names: list[str]) -> None:
    if not object_names:
        return
    client = _storage_client()
    bucket = client.bucket(bucket_name())
    try:
        from google.api_core.exceptions import NotFound

        for object_name in object_names:
            try:
                bucket.blob(object_name).delete()
            except NotFound:
                # Retrying a cleanup must remain safe if an earlier attempt
                # already removed the object or an upload never completed.
                continue
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Cloud Storage cleanup failed; the design was not deleted",
        ) from exc
