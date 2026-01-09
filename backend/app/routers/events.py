import logging

from fastapi import APIRouter, Query

from app.core.dependencies import CurrentUser, SupabaseClient
from app.core.encryption import decrypt

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("")
async def list_events(
    current_user: CurrentUser,
    supabase: SupabaseClient,
    start: str = Query(..., description="ISO datetime for range start"),
    end: str = Query(..., description="ISO datetime for range end"),
    calendar_ids: str = Query(None, description="Comma-separated calendar IDs (optional)")
):
    user_id = current_user["id"]

    google_calendar_ids = _get_user_calendar_ids(supabase, user_id, calendar_ids)
    if not google_calendar_ids:
        return {"events": [], "masters": []}

    events = _query_events_in_range(supabase, user_id, google_calendar_ids, start, end)
    masters = _query_recurring_masters(supabase, user_id, google_calendar_ids)

    return {"events": events, "masters": masters}


def _get_user_calendar_ids(supabase, user_id: str, calendar_ids_param: str | None) -> list[str]:
    """Get calendar IDs the user has access to, optionally filtered."""
    result = (
        supabase
        .table("google_calendars")
        .select("id, google_accounts!inner(user_id)")
        .eq("google_accounts.user_id", user_id)
        .execute()
    )

    all_ids = [row["id"] for row in result.data or []]

    if calendar_ids_param:
        requested = set(calendar_ids_param.split(","))
        return [cid for cid in all_ids if cid in requested]

    return all_ids


def _query_events_in_range(
    supabase,
    user_id: str,
    calendar_ids: list[str],
    start: str,
    end: str
) -> list[dict]:
    """
    Query events from database for display.
    Excludes recurring masters (those have recurrence array set).
    Filters by date range in SQL for performance.
    """
    start_date = start[:10]
    end_date = end[:10]

    result = (
        supabase
        .table("events")
        .select("*")
        .in_("google_calendar_id", calendar_ids)
        .eq("source", "google")
        .is_("recurrence", "null")
        .or_(
            f"start_datetime->>dateTime.gte.{start},start_datetime->>dateTime.lte.{end},"
            f"start_datetime->>date.gte.{start_date},start_datetime->>date.lte.{end_date}"
        )
        .execute()
    )

    events = result.data or []
    return [_decrypt_event(e, user_id) for e in events]


def _get_event_start_str(event: dict) -> str | None:
    """Extract start datetime/date string from event for comparison."""
    start_dt = event.get("start_datetime") or {}
    return start_dt.get("dateTime") or start_dt.get("date")


def _query_recurring_masters(supabase, user_id: str, calendar_ids: list[str]) -> list[dict]:
    """Query recurring event masters from database."""
    result = (
        supabase
        .table("events")
        .select("*")
        .in_("google_calendar_id", calendar_ids)
        .eq("source", "google")
        .not_.is_("recurrence", "null")
        .is_("recurring_event_id", "null")
        .execute()
    )

    masters = result.data or []
    return [_decrypt_event(m, user_id) for m in masters]


def _decrypt_event(event: dict, user_id: str) -> dict:
    """Decrypt sensitive fields and transform to API response format."""
    result = {
        "id": event.get("google_event_id"),
        "calendarId": event.get("google_calendar_id"),
        "start": event.get("start_datetime") or {},
        "end": event.get("end_datetime") or {},
        "status": event.get("status", "confirmed"),
        "visibility": event.get("visibility", "default"),
        "transparency": event.get("transparency", "opaque"),
        "recurrence": event.get("recurrence"),
        "recurringEventId": event.get("recurring_event_id"),
        "colorId": event.get("color_id"),
        "created": event.get("created_at"),
        "updated": event.get("updated_at"),
    }

    summary = event.get("summary")
    if summary:
        try:
            result["summary"] = decrypt(summary, user_id)
        except Exception:
            result["summary"] = "(Unable to decrypt)"
    else:
        result["summary"] = ""

    description = event.get("description")
    if description:
        try:
            result["description"] = decrypt(description, user_id)
        except Exception:
            result["description"] = None

    location = event.get("location")
    if location:
        try:
            result["location"] = decrypt(location, user_id)
        except Exception:
            result["location"] = None

    return result
