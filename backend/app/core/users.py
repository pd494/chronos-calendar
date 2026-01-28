import logging

from postgrest.exceptions import APIError

logger = logging.getLogger(__name__)


def get_user(supabase, user_id: str) -> dict | None:
    try:
        result = (
            supabase.table("users")
            .select("id, email, name, avatar_url")
            .eq("id", user_id)
            .single()
            .execute()
        )
        return result.data
    except APIError as e:
        logger.debug("User lookup failed for %s: %s", user_id, e)
        return None


