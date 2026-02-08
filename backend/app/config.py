from functools import lru_cache
from typing import Literal

from pydantic import field_validator
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
    CORS_ORIGINS: str
    OAUTH_REDIRECT_URLS: str
    DESKTOP_REDIRECT_URL: str

    ENCRYPTION_MASTER_KEY: str

    GOOGLE_CLIENT_ID: str
    GOOGLE_CLIENT_SECRET: str

    CEREBRAS_API_KEY: str
    CEREBRAS_MODEL: str

    WEBHOOK_BASE_URL: str
    WEBHOOK_SECRET: str
    CRON_SECRET: str

    SESSION_COOKIE_NAME: str
    REFRESH_COOKIE_NAME: str
    COOKIE_MAX_AGE: int
    COOKIE_DOMAIN: str | None

    @field_validator("COOKIE_DOMAIN", mode="before")
    @classmethod
    def empty_str_to_none(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        return v

    COOKIE_SECURE: bool
    COOKIE_SAMESITE: SameSitePolicy

    LOG_LEVEL: str
    DEBUG_MODE: bool
    ENVIRONMENT: str

    RATE_LIMIT_AUTH: str
    RATE_LIMIT_API: str

    @property
    def cors_origins(self) -> list[str]:
        origins = [self.FRONTEND_URL]
        if self.CORS_ORIGINS:
            origins.extend([o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()])
        return list(set(origins))

    @property
    def oauth_redirect_urls(self) -> list[str]:
        urls = [u.strip() for u in self.OAUTH_REDIRECT_URLS.split(",") if u.strip()]
        return list(set(urls))


@lru_cache()
def get_settings() -> Settings:
    return Settings()
