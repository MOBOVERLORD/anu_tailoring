from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import EmailStr


class Settings(BaseSettings):
    # Application Config
    PROJECT_NAME: str = "Tailored Clothing API"
    ENVIRONMENT: str = "development"

    # Database Settings
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str
    POSTGRES_SERVER: str = "localhost"
    POSTGRES_PORT: str = "5432"
    POSTGRES_DB: str = "tailor_db"

    @property
    def DATABASE_URL(self) -> str:
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

    # Admin Account Initial Credentials
    ADMIN_NAME: str = "System Admin"
    ADMIN_EMAIL: EmailStr
    ADMIN_PASSWORD: str

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
