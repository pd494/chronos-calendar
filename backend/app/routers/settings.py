from fastapi import APIRouter, BackgroundTasks

from app.chat.embedding import EmbeddingService
from app.core.dependencies import CurrentUser, SupabaseClientDep
from app.core.user_repository import get_user_ai_preference, get_user_google_account_ids

router = APIRouter()


@router.get("/ai-preference")
async def get_ai_preference(
    current_user: CurrentUser
):
    return {"ai_features_enabled": get_user_ai_preference(current_user["id"])}


@router.post("/ai-preference/toggle")
async def toggle_ai_preference(
    background_tasks: BackgroundTasks,
    current_user: CurrentUser,
    supabase: SupabaseClientDep
):
    user_id = current_user["id"]
    current = get_user_ai_preference(user_id)
    new_value = not current

    (
        supabase.table("users")
        .update({"ai_features_enabled": new_value})
        .eq("id", user_id)
        .execute()
    )

    account_ids = get_user_google_account_ids(user_id)

    if new_value and account_ids:
        (
            supabase.table("events")
            .update({"embedding_pending": True})
            .in_("google_account_id", account_ids)
            .execute()
        )
        background_tasks.add_task(EmbeddingService.process_embedding_queue, user_id)

    elif not new_value and account_ids:
        (
            supabase.table("events")
            .update({
                "embedding": None,
                "embedding_pending": False,
                "embedding_text_hash": None
            })
            .in_("google_account_id", account_ids)
            .execute()
        )

    return {"ai_features_enabled": new_value}
