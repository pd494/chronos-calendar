import logging
from datetime import datetime

from fastapi import APIRouter, HTTPException

from app.config import get_settings
from app.core.dependencies import CurrentUser
from app.core.encryption import decrypt
from app.core.cerebras import get_async_cerebras_client
from app.chat.retrieval import get_query_context, hybrid_search_events
from app.chat.prompts import (
    SUMMARIZATION_PROMPT,
    SEARCH_PROMPT,
    CREATE_EVENT_PROMPT,
    UPDATE_EVENT_PROMPT,
    GENERAL_CHAT_PROMPT,
    NOT_FOUND_PROMPT,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def decrypt_event(event: dict, user_id: str) -> dict:
    result = dict(event)
    for field in ["title", "description", "location"]:
        if result.get(field):
            try:
                result[field] = decrypt(result[field], user_id)
            except Exception:
                pass
    return result


def format_events_for_prompt(events: list, user_id: str) -> str:
    if not events:
        return "No events found."

    lines = []
    for i, event in enumerate(events, 1):
        decrypted = decrypt_event(event, user_id)
        title = decrypted.get("title") or "Untitled"
        line = f"{i}. **{title}**"

        if event.get("start_time"):
            if event.get("is_all_day"):
                line += f" | {event['start_time']} (All day)"
            else:
                line += f" | {event['start_time']}"

        if decrypted.get("location"):
            line += f" | 📍 {decrypted['location']}"

        if event.get("similarity") and event["similarity"] < 1.0:
            line += f" (relevance: {event['similarity']:.0%})"

        lines.append(line)

    return "\n".join(lines)


def parse_temporal_context(temporal_context: dict | None) -> tuple:
    if not temporal_context:
        return None, None

    start_str = temporal_context.get("start")
    end_str = temporal_context.get("end")

    start_ts = datetime.fromisoformat(start_str.replace("Z", "+00:00")) if start_str else None
    end_ts = datetime.fromisoformat(end_str.replace("Z", "+00:00")) if end_str else None

    return start_ts, end_ts


@router.post("/calendar")
async def chat_calendar(
    body: dict,
    current_user: CurrentUser
):
    user_id = str(current_user["id"])
    user_prompt = body.get("content", "")

    if len(user_prompt) > 2000:
        raise HTTPException(status_code=400, detail="Prompt too long")

    query_context = get_query_context(user_prompt, user_id)

    intent = query_context.get("intent", "general_chat")
    temporal_context = query_context.get("temporal_context")
    search_keywords = query_context.get("search_keywords", [])
    sort_order = query_context.get("sort_order", "relevance")
    user_timezone = query_context.get("user_timezone", "America/Los_Angeles")

    matched_events = []
    system_prompt = GENERAL_CHAT_PROMPT

    if intent == "summarize":
        start_ts, end_ts = parse_temporal_context(temporal_context)
        matched_events = hybrid_search_events(
            query="",
            user_id=user_id,
            start_ts=start_ts,
            end_ts=end_ts,
            use_semantic=False,
            max_results=200,
        )
        system_prompt = SUMMARIZATION_PROMPT.format(
            events_context=format_events_for_prompt(matched_events, user_id),
            user_timezone=user_timezone
        )

    elif intent == "find_event":
        start_ts, end_ts = parse_temporal_context(temporal_context)
        search_query = " ".join(search_keywords) if search_keywords else user_prompt

        matched_events = hybrid_search_events(
            query=search_query,
            user_id=user_id,
            start_ts=start_ts,
            end_ts=end_ts,
            use_semantic=True,
            max_results=10,
            sort_by_recency=(sort_order == "recency"),
            similarity_threshold=0.7 if sort_order == "recency" else 0.3,
        )
        system_prompt = SEARCH_PROMPT.format(
            events_context=format_events_for_prompt(matched_events, user_id),
            user_timezone=user_timezone,
            count=len(matched_events),
        )
        matched_events = matched_events[:3]

    elif intent == "create_event":
        start_ts, end_ts = parse_temporal_context(temporal_context)
        event_title = query_context.get("event_title") or "New Event"

        matched_events = [{
            "id": None,
            "title": event_title,
            "location": query_context.get("event_location"),
            "description": query_context.get("event_description"),
            "start_time": start_ts.isoformat() if start_ts else None,
            "end_time": end_ts.isoformat() if end_ts else None,
            "is_all_day": query_context.get("event_is_all_day", False),
            "recurrence_rule": query_context.get("event_recurrence"),
            "is_pending_creation": True,
        }]
        system_prompt = CREATE_EVENT_PROMPT.format(
            user_timezone=user_timezone,
            event_title=event_title,
            event_date=start_ts.strftime("%a %b %d at %I:%M %p") if start_ts else "unspecified time",
        )

    elif intent == "update_event":
        search_query = " ".join(search_keywords) if search_keywords else user_prompt
        start_ts, end_ts = parse_temporal_context(temporal_context)

        found_events = hybrid_search_events(
            query=search_query,
            user_id=user_id,
            use_semantic=True,
            max_results=5,
            similarity_threshold=0.3,
        )

        if not found_events:
            system_prompt = NOT_FOUND_PROMPT.format(search_query=search_query)
        else:
            target = found_events[0]
            target["is_pending_update"] = True
            target["pending_updates"] = {
                k: v for k, v in {
                    "start": start_ts.isoformat() if start_ts else None,
                    "end": end_ts.isoformat() if end_ts else None,
                    "title": query_context.get("event_new_title"),
                    "description": query_context.get("event_new_description"),
                    "duration_minutes": query_context.get("event_new_duration_minutes"),
                    "is_all_day": query_context.get("event_make_all_day"),
                    "visibility": query_context.get("event_new_visibility"),
                }.items() if v is not None
            }
            if query_context.get("recurring_edit_scope"):
                target["pending_recurring_edit_scope"] = query_context["recurring_edit_scope"]

            matched_events = [target]
            decrypted = decrypt_event(target, user_id)
            system_prompt = UPDATE_EVENT_PROMPT.format(
                user_timezone=user_timezone,
                event_title=decrypted.get("title", "Event"),
                new_datetime=start_ts.strftime("%a %b %d at %I:%M %p") if start_ts else "same time",
                attendees="",
                duration="",
                visibility="",
                update_summary=f"Time: {start_ts.strftime('%a %b %d at %I:%M %p')}" if start_ts else "No changes",
            )

    elif intent == "delete_event":
        search_query = " ".join(search_keywords) if search_keywords else user_prompt

        found_events = hybrid_search_events(
            query=search_query,
            user_id=user_id,
            use_semantic=True,
            max_results=5,
            similarity_threshold=0.3,
        )

        if not found_events:
            system_prompt = NOT_FOUND_PROMPT.format(search_query=search_query)
        else:
            target = found_events[0]
            target["is_pending_deletion"] = True
            if query_context.get("recurring_edit_scope"):
                target["pending_recurring_edit_scope"] = query_context["recurring_edit_scope"]

            matched_events = [target]
            decrypted = decrypt_event(target, user_id)
            system_prompt = f"You are a helpful calendar assistant. Confirm: 'I'll delete **{decrypted.get('title', 'this event')}**. Press Delete to confirm.'"

    settings = get_settings()
    cerebras = get_async_cerebras_client()

    resp = await cerebras.chat.completions.create(
        model=settings.CEREBRAS_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
    )

    return {
        "message": resp.choices[0].message.content,
        "matched_events": [decrypt_event(e, user_id) for e in matched_events],
    }
