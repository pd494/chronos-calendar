import logging

logger = logging.getLogger(__name__)


def get_or_create_user(supabase, user_id: str, email: str | None = None, metadata: dict | None = None) -> dict:
    user_row = (
        supabase.table("users")
        .select("*")
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    if user_row and user_row.data:
        return user_row.data

    user_data = {
        "id": user_id,
        "email": email or "",
        "name": (metadata or {}).get("name"),
        "avatar_url": (metadata or {}).get("avatar_url"),
    }
    insert_result = (
        supabase.table("users")
        .upsert(user_data)
        .execute()
    )
    if insert_result and insert_result.data:
        return insert_result.data[0]
    logger.warning("User upsert may have failed for user %s", user_id)
    return user_data
