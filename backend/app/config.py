from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    SUPABASE_URL: str
    SUPABASE_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str

    FRONTEND_URL: str

    ENCRYPTION_MASTER_KEY: str

    GOOGLE_CLIENT_ID: str
    GOOGLE_CLIENT_SECRET: str

    CEREBRAS_API_KEY: str = ""
    CEREBRAS_MODEL: str = "llama-4-scout-17b-16e-instruct"

    SESSION_COOKIE_NAME: str = "chronos_session"
    SESSION_MAX_AGE: int = 60 * 60 * 24 * 30
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: str = "lax"
    COOKIE_DOMAIN: str | None = None
    
    class Config:
        env_file = "../.env"
        case_sensitive = True
        extra = "ignore"

@lru_cache()
def get_settings() -> Settings:
    return Settings()
