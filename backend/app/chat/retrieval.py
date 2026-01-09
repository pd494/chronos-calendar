import json
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone, timedelta

from app.config import get_settings
from app.core.supabase import get_supabase_client
from app.core.cerebras import get_cerebras_client
from app.chat.embedding import embed_texts
from app.chat.prompts import QUERY_UNDERSTANDING_PROMPT
from app.chat.models import QueryContext

logger = logging.getLogger(__name__)


def get_query_context(user_query: str, user_id: str) -> dict:
    user_timezone = "America/Los_Angeles"

    current_datetime = datetime.now(timezone.utc).isoformat()
    current_day = datetime.now(timezone.utc).strftime("%A")

    formatted_prompt = QUERY_UNDERSTANDING_PROMPT.format(
        current_utc_time=current_datetime,
        current_day_of_week=current_day,
        user_timezone=user_timezone,
    )

    settings = get_settings()
    client = get_cerebras_client()
    completion = client.chat.completions.create(
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

    result = json.loads(completion.choices[0].message.content)
    result["user_timezone"] = user_timezone
    return result


def hybrid_search_events(
    query: str,
    user_id: str,
    start_ts: Optional[datetime] = None,
    end_ts: Optional[datetime] = None,
    use_semantic: bool = True,
    max_results: int = 50,
    sort_by_recency: bool = False,
    similarity_threshold: float = 0.25,
) -> List[Dict[str, Any]]:
    if start_ts is None:
        start_ts = datetime.now(timezone.utc) - timedelta(days=365)
    if end_ts is None:
        end_ts = datetime.now(timezone.utc) + timedelta(days=365)

    query_vector = None
    if use_semantic and query.strip():
        try:
            query_vector = embed_texts([query])[0]
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
        return result.data or []
    except Exception:
        logger.exception("Hybrid search RPC failed")
        raise
