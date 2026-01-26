from functools import lru_cache

from supabase import create_client, Client

from app.config import get_settings


@lru_cache()
def get_supabase_client() -> Client:
    settings = get_settings()
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


def clear_supabase_cache():
    """Clear the cached Supabase client. Call this after settings changes or in tests."""
    get_supabase_client.cache_clear()
