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
    ALLOWED_ORIGINS: str = ""
    ALLOWED_REDIRECT_URLS: str = ""
    DESKTOP_REDIRECT_URL: str = "chronos://auth/callback"
    DESKTOP_OAUTH_REDIRECT_URL: str = ""

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
        origins = [self.FRONTEND_URL, "tauri://localhost", "http://tauri.localhost"]
        if self.ALLOWED_ORIGINS:
            origins.extend([o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()])
        return list(set(origins))

    @property
    def oauth_redirect_urls(self) -> list[str]:
        frontend_base = self.FRONTEND_URL.rstrip("/")
        urls = {f"{frontend_base}/auth/callback"}
        if self.DESKTOP_REDIRECT_URL:
            urls.add(self.DESKTOP_REDIRECT_URL)
        if self.DESKTOP_OAUTH_REDIRECT_URL:
            urls.add(self.DESKTOP_OAUTH_REDIRECT_URL)
        else:
            urls.add(f"{self.BACKEND_URL.rstrip('/')}/auth/desktop/callback")
        if self.ALLOWED_REDIRECT_URLS:
            urls.update({u.strip() for u in self.ALLOWED_REDIRECT_URLS.split(",") if u.strip()})
        return list(urls)


@lru_cache()
def get_settings() -> Settings:
    return Settings()
