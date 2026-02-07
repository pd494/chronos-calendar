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
    BACKEND_URL: str
    CORS_ORIGINS: str = ""
    OAUTH_REDIRECT_URLS: str = ""
    DESKTOP_REDIRECT_URL: str = "chronos://auth/callback"

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

    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: SameSitePolicy = "lax"

    LOG_LEVEL: str = "INFO"
    DEBUG_MODE: bool = False
    ENVIRONMENT: str = "development"

    RATE_LIMIT_AUTH: str = "10/minute"
    RATE_LIMIT_API: str = "100/minute"

    @property
    def cors_origins(self) -> list[str]:
        origins = [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]
        return list(set(origins))

    @property
    def oauth_redirect_urls(self) -> list[str]:
        urls = [u.strip() for u in self.OAUTH_REDIRECT_URLS.split(",") if u.strip()]
        return list(set(urls))


@lru_cache()
def get_settings() -> Settings:
    return Settings()
