from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import EmailStr
from typing import Optional


class Settings(BaseSettings):
    # Application Config
    PROJECT_NAME: str = "Tailored Clothing API"
    ENVIRONMENT: str = "development"

    # Database Settings
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: Optional[str] = None
    POSTGRES_SERVER: str = "localhost"
    POSTGRES_PORT: str = "5432"
    POSTGRES_DB: str = "tailor_db"
    # Set this in production (preferably from Secret Manager) to support
    # managed databases and Cloud SQL Unix sockets.
    DATABASE_URL: Optional[str] = None

    @property
    def database_url(self) -> str:
        if self.DATABASE_URL:
            if self.DATABASE_URL.startswith("postgres://"):
                return self.DATABASE_URL.replace(
                    "postgres://", "postgresql+asyncpg://", 1
                )
            if self.DATABASE_URL.startswith("postgresql://"):
                return self.DATABASE_URL.replace(
                    "postgresql://", "postgresql+asyncpg://", 1
                )
            return self.DATABASE_URL
        if not self.POSTGRES_PASSWORD:
            raise ValueError(
                "Set DATABASE_URL or POSTGRES_PASSWORD before starting the API"
            )
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_SERVER}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def is_development(self) -> bool:
        return self.ENVIRONMENT.lower() == "development"

    # JWT Authentication Settings
    # No default on purpose: the app should fail to boot rather than silently
    # run with a known/shared secret key.
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    SERVE_FRONTEND: bool = False

    # Google Cloud Storage for durable design media.
    GCS_BUCKET_NAME: Optional[str] = None
    # Optional locally: ADC impersonates this service account for GCS operations.
    # Cloud Run derives its attached identity.
    GCS_SIGNING_SERVICE_ACCOUNT: Optional[EmailStr] = None
    MAX_DESIGN_IMAGE_MB: int = 2
    VENDOR_CONTACT_EMAIL: str = "vendors@anutailoring.com"

    # Admin Account Initial Credentials
    ADMIN_NAME: str = "System Admin"
    ADMIN_EMAIL: Optional[EmailStr] = None
    ADMIN_PASSWORD: Optional[str] = None

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
