from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import EmailStr
from typing import Optional


class Settings(BaseSettings):
    # Application Config
    PROJECT_NAME: str = "Vastrivo API"
    APP_NAME: str = "Vastrivo"
    PUBLIC_APP_URL: str = "http://localhost:5173"
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
    JWT_ISSUER: str = "vastrivo-api"
    JWT_AUDIENCE: str = "vastrivo-ui"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 10
    REFRESH_TOKEN_EXPIRE_MINUTES: int = 30
    MAX_ACTIVE_SESSIONS_PER_USER: int = 5
    SERVE_FRONTEND: bool = False

    # Google Cloud Storage for durable design media.
    GCS_BUCKET_NAME: Optional[str] = None
    # Optional locally: ADC impersonates this service account for GCS operations.
    # Cloud Run derives its attached identity.
    GCS_SIGNING_SERVICE_ACCOUNT: Optional[EmailStr] = None
    MAX_DESIGN_IMAGE_MB: int = 2
    MAX_INVOICE_ATTACHMENT_MB: int = 5
    # Safe to expose through the public UI config endpoint. This is the support
    # contact shown to prospective vendors, not a provider credential.
    VENDOR_CONTACT_EMAIL: EmailStr = "vendors@vastrivo.com"
    # Public business identity shown on the policy/contact pages. Configure the
    # registered entity and correspondence address before Razorpay review.
    BUSINESS_LEGAL_NAME: str = "Vastrivo"
    BUSINESS_ADDRESS: Optional[str] = None
    SUPPORT_PHONE: Optional[str] = None

    # Transactional email. Use `console` only for local development. On Cloud
    # Run, keep RESEND_API_KEY in Secret Manager and use `resend`.
    EMAIL_PROVIDER: str = "disabled"
    RESEND_API_KEY: Optional[str] = None
    EMAIL_FROM_ADDRESS: Optional[EmailStr] = None
    EMAIL_FROM_NAME: Optional[str] = None
    EMAIL_NOTIFICATIONS_ENABLED: bool = False
    PASSWORD_RESET_EXPIRE_MINUTES: int = 20
    EMAIL_HTTP_TIMEOUT_SECONDS: float = 10.0

    # Map/geocoding provider. Public OSM endpoints are for low-volume local
    # development only. Production should use managed/self-hosted compatible
    # endpoints, or switch to Google with a server-only key.
    MAPS_PROVIDER: str = "openstreetmap"
    OSM_NOMINATIM_URL: str = "https://nominatim.openstreetmap.org"
    OSM_ROUTING_URL: str = "https://router.project-osrm.org"
    OSM_ALLOW_PUBLIC_SERVICES_IN_PRODUCTION: bool = False
    OSM_MIN_REQUEST_INTERVAL_SECONDS: float = 1.05
    MAPS_HTTP_TIMEOUT_SECONDS: float = 8.0
    # Called only by FastAPI. Store this key in .env locally and Secret Manager
    # in Cloud Run; never expose it through a VITE_ browser variable.
    GOOGLE_MAPS_API_KEY: Optional[str] = None

    # Razorpay Standard Checkout. Both credentials stay on the FastAPI server;
    # the authenticated create-order response exposes only the Key ID needed
    # by Checkout.js. Use Test Mode locally and Secret Manager in Cloud Run.
    RAZORPAY_KEY_ID: Optional[str] = None
    RAZORPAY_KEY_SECRET: Optional[str] = None
    # Created separately in Razorpay Dashboard. It is not an API key and must
    # be used only to authenticate the raw webhook request body.
    RAZORPAY_WEBHOOK_SECRET: Optional[str] = None
    RAZORPAY_CURRENCY: str = "INR"
    RAZORPAY_HTTP_TIMEOUT_SECONDS: float = 10.0

    # Admin Account Initial Credentials
    ADMIN_NAME: str = "System Admin"
    ADMIN_EMAIL: Optional[EmailStr] = None
    ADMIN_PASSWORD: Optional[str] = None

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
