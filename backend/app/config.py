from functools import lru_cache
from typing import Literal

from pydantic import field_validator, model_validator
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
    DESKTOP_PROXY_ORIGINS: str = ""
    OAUTH_REDIRECT_URLS: str
    DESKTOP_REDIRECT_URL: str

    ENCRYPTION_MASTER_KEY: str
    CSRF_SECRET_KEY: str
    CSRF_COOKIE_NAME: str
    CSRF_TOKEN_TTL_SECONDS: int

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

    COOKIE_SECURE: bool
    COOKIE_SAMESITE: SameSitePolicy

    LOG_LEVEL: str
    DEBUG_MODE: bool
    ENVIRONMENT: str

    RATE_LIMIT_AUTH: str
    RATE_LIMIT_API: str

    @field_validator("COOKIE_DOMAIN", mode="before")
    @classmethod
    def empty_str_to_none(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        return v
    @property
    def cors_origins(self) -> list[str]:
        origins = [self.FRONTEND_URL]
        if self.CORS_ORIGINS:
            origins.extend([o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()])
        if self.DESKTOP_PROXY_ORIGINS:
            origins.extend([o.strip() for o in self.DESKTOP_PROXY_ORIGINS.split(",") if o.strip()])
        return list(set(origins))

    @property
    def oauth_redirect_urls(self) -> list[str]:
        urls = [u.strip() for u in self.OAUTH_REDIRECT_URLS.split(",") if u.strip()]
        return list(set(urls))

    @model_validator(mode="after")
    def validate_security_invariants(self):
        if self.ENVIRONMENT == "production":
            if not self.COOKIE_SECURE:
                raise ValueError("COOKIE_SECURE must be true in production")

            if self.COOKIE_SAMESITE not in ("lax", "strict"):
                raise ValueError("COOKIE_SAMESITE must be 'lax' or 'strict' in production")

            if self.SESSION_COOKIE_NAME.startswith("__Host-") and self.COOKIE_DOMAIN is not None:
                raise ValueError("SESSION_COOKIE_NAME with __Host- prefix cannot set COOKIE_DOMAIN")

            if self.REFRESH_COOKIE_NAME.startswith("__Host-") and self.COOKIE_DOMAIN is not None:
                raise ValueError("REFRESH_COOKIE_NAME with __Host- prefix cannot set COOKIE_DOMAIN")

        return self

@lru_cache()
def get_settings() -> Settings:
    return Settings()
