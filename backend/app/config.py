from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

SameSitePolicy = Literal["lax", "strict", "none"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file="../.env",
        case_sensitive=True,
        extra="ignore",
    )
    SUPABASE_URL: str
    SUPABASE_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str

    FRONTEND_URL: str
    ALLOWED_ORIGINS: str = ""

    ENCRYPTION_MASTER_KEY: str

    GOOGLE_CLIENT_ID: str
    GOOGLE_CLIENT_SECRET: str

    CEREBRAS_API_KEY: str = ""
    CEREBRAS_MODEL: str = "llama-4-scout-17b-16e-instruct"

    WEBHOOK_BASE_URL: str = ""
    WEBHOOK_SECRET: str = ""
    CRON_SECRET: str = ""

    SESSION_COOKIE_NAME: str = "chronos_session"
    REFRESH_COOKIE_NAME: str = "chronos_refresh"
    COOKIE_MAX_AGE: int = 60 * 60 * 24 * 30
    COOKIE_DOMAIN: str | None = None

    LOG_LEVEL: str = "INFO"
    DEBUG_MODE: bool = False
    ENVIRONMENT: str = "development"

    RATE_LIMIT_AUTH: str = "10/minute"
    RATE_LIMIT_API: str = "100/minute"

    @property
    def COOKIE_SECURE(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def COOKIE_SAMESITE(self) -> SameSitePolicy:
        return "strict" if self.ENVIRONMENT == "production" else "lax"

    @property
    def cors_origins(self) -> list[str]:
        origins = [self.FRONTEND_URL]
        if self.DEBUG_MODE or self.ENVIRONMENT == "development":
            if self.ALLOWED_ORIGINS:
                origins.extend([o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()])
            origins.extend([
                "http://localhost:5174",
                "http://127.0.0.1:5174",
            ])
        return list(set(origins))


@lru_cache()
def get_settings() -> Settings:
    return Settings()
