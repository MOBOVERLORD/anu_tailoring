from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import EmailStr

class Settings(BaseSettings):
    # Application Config
    PROJECT_NAME: str = "Tailored Clothing API"
    ENVIRONMENT: str = "development"

    # Database Settings
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "postgres"
    POSTGRES_SERVER: str = "localhost"
    POSTGRES_PORT: str = "5432"
    POSTGRES_DB: str = "tailor_db"

    # Computed DB URL
    @property
    def DATABASE_URL(self) -> str:
        return f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{self.POSTGRES_SERVER}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"

    # JWT Authentication Settings
    SECRET_KEY: str = "super_secret_jwt_key_change_me_in_production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours

    # Admin Account Initial Credentials
    ADMIN_NAME: str = "System Admin"
    ADMIN_EMAIL: EmailStr = "admin@tailor.com"
    ADMIN_PASSWORD: str = "AdminPass123!"

    # Load from .env file if available
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()