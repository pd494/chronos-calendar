import logging

from fastapi import APIRouter, Query

from app.core.dependencies import CurrentUser, SupabaseClient
from app.calendar.helpers import decrypt_event

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
    Filters by overlap in SQL for performance.
    """
    start_date = start[:10]
    end_date = end[:10]

    def _base_query():
        return (
            supabase
            .table("events")
            .select("*")
            .in_("google_calendar_id", calendar_ids)
            .eq("source", "google")
            .is_("recurrence", "null")
        )

    timed = (
        _base_query()
        .eq("is_all_day", False)
        .lt("start_datetime->>dateTime", end)
        .gt("end_datetime->>dateTime", start)
        .execute()
    )

    all_day = (
        _base_query()
        .eq("is_all_day", True)
        .lt("start_datetime->>date", end_date)
        .gt("end_datetime->>date", start_date)
        .execute()
    )

    timed_by_original = (
        _base_query()
        .not_.is_("recurring_event_id", "null")
        .not_.is_("original_start_time", "null")
        .eq("is_all_day", False)
        .gte("original_start_time", start)
        .lt("original_start_time", end)
        .execute()
    )

    all_day_by_original = (
        _base_query()
        .not_.is_("recurring_event_id", "null")
        .not_.is_("original_start_time", "null")
        .eq("is_all_day", True)
        .gte("original_start_time", start_date)
        .lt("original_start_time", end_date)
        .execute()
    )

    raw_events = [
        *(timed.data or []),
        *(all_day.data or []),
        *(timed_by_original.data or []),
        *(all_day_by_original.data or []),
    ]

    deduped: dict[str, dict] = {}
    for event in raw_events:
        key = f"{event.get('google_calendar_id')}:{event.get('google_event_id')}"
        deduped[key] = event

    return [decrypt_event(e, user_id) for e in deduped.values()]


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
    return [decrypt_event(m, user_id) for m in masters]


