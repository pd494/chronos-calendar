import logging

from supabase import create_client, Client

from app.config import get_settings

logger = logging.getLogger(__name__)


class SupabaseClient:
    """
    Supabase client factory.

    This application uses the service role client for all database operations.
    The service role bypasses RLS, so authorization is enforced at the application
    layer by validating the user JWT and filtering queries by user_id.

    Pattern:
    1. Validate user JWT via supabase.auth.get_user(token)
    2. Extract user.id from the validated response
    3. Use service client with explicit user_id filters in queries
    """
    _service_instance: Client | None = None

    @classmethod
    def get_service_client(cls) -> Client:
        """Returns the service role client (bypasses RLS)."""
        if cls._service_instance is None:
            settings = get_settings()
            cls._service_instance = create_client(
                settings.SUPABASE_URL,
                settings.SUPABASE_SERVICE_ROLE_KEY
            )
        return cls._service_instance

    @classmethod
    def get_client(cls) -> Client:
        """Alias for get_service_client. All operations use service role."""
        return cls.get_service_client()

    @classmethod
    def get_auth_client(cls) -> Client:
        """Returns a fresh service client for auth operations."""
        settings = get_settings()
        return create_client(
            settings.SUPABASE_URL,
            settings.SUPABASE_SERVICE_ROLE_KEY
        )
