import json
import logging
from datetime import datetime, timedelta, timezone

from app.chat.embedding import EmbeddingService
from app.chat.models import QueryContext
from app.chat.prompts import Prompts
from app.config import get_settings
from app.core.cerebras import CerebrasClient
from app.core.db_utils import all_rows, first_row
from app.core.supabase import get_supabase_client

logger = logging.getLogger(__name__)


def get_user_timezone(user_id: str) -> str:
    supabase = get_supabase_client()
    result = (
        supabase.table("users")
        .select("timezone")
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    row = first_row(result.data) if result else None
    if row and row.get("timezone"):
        return str(row["timezone"])
    return "America/Los_Angeles"


async def get_query_context(user_query: str, user_id: str) -> dict:
    user_timezone = get_user_timezone(user_id)

    current_datetime = datetime.now(timezone.utc).isoformat()
    current_day = datetime.now(timezone.utc).strftime("%A")

    formatted_prompt = Prompts.QUERY_UNDERSTANDING.format(
        current_utc_time=current_datetime,
        current_day_of_week=current_day,
        user_timezone=user_timezone,
    )

    settings = get_settings()
    client = CerebrasClient.get_async_client()
    completion = await client.chat.completions.create(
        model=settings.CEREBRAS_MODEL,
        messages=[
            {"role": "system", "content": formatted_prompt},
            {"role": "user", "content": user_query},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "query_context",
                "schema": QueryContext.model_json_schema(),
            },
        },
        temperature=0,
    )

    try:
        result = json.loads(completion.choices[0].message.content)  # type: ignore[union-attr]
    except json.JSONDecodeError:
        logger.warning("Failed to parse query context JSON, using defaults")
        return {"intent": "general_chat", "user_timezone": user_timezone}
    result["user_timezone"] = user_timezone
    return result


def hybrid_search_events(
    query: str,
    user_id: str,
    start_ts: datetime | None = None,
    end_ts: datetime | None = None,
    use_semantic: bool = True,
    max_results: int = 50,
    sort_by_recency: bool = False,
    similarity_threshold: float = 0.25,
) -> list[dict]:
    if start_ts is None:
        start_ts = datetime.now(timezone.utc) - timedelta(days=365)
    if end_ts is None:
        end_ts = datetime.now(timezone.utc) + timedelta(days=365)

    query_vector = None
    if use_semantic and query.strip():
        try:
            query_vector = EmbeddingService.embed_texts([query])[0]
        except Exception as e:
            logger.error("Embedding failed: %s", e)
            query_vector = None

    supabase = get_supabase_client()

    try:
        result = supabase.rpc(
            "hybrid_calendar_search",
            {
                "uid_param": user_id,
                "start_param": start_ts.isoformat(),
                "end_param": end_ts.isoformat(),
                "query_vector": query_vector,
                "max_results": max_results,
                "sort_by_recency": sort_by_recency,
                "similarity_threshold": similarity_threshold,
            },
        ).execute()
        return all_rows(result.data)
    except Exception:
        logger.exception("Hybrid search RPC failed")
        raise
