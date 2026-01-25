from typing import Any, cast

from app.core.supabase import SupabaseClient


def get_user_ai_preference(user_id: str) -> bool:
    supabase = SupabaseClient.get_client()
    result = (
        supabase.table("users")
        .select("ai_features_enabled")
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    data = cast(dict[str, Any] | None, result.data if result else None)
    if not data:
        return False
    return bool(data.get("ai_features_enabled", False))


def get_user_google_account_ids(user_id: str) -> list[str]:
    supabase = SupabaseClient.get_client()
    result = (
        supabase.table("google_accounts")
        .select("id")
        .eq("user_id", user_id)
        .execute()
    )
    rows = cast(list[dict[str, Any]], result.data or [])
    return [str(row["id"]) for row in rows]
