import logging
from datetime import datetime, timezone

from app.core.supabase import get_supabase_client
from app.core.encryption import encrypt, decrypt

logger = logging.getLogger(__name__)


def time_range_to_months(time_min: str, time_max: str) -> list[tuple[int, int]]:
    start = datetime.fromisoformat(time_min.replace("Z", "+00:00"))
    end = datetime.fromisoformat(time_max.replace("Z", "+00:00"))

    months = []
    current_year = start.year
    current_month = start.month

    while (current_year, current_month) <= (end.year, end.month):
        months.append((current_year, current_month))
        if current_month == 12:
            current_year += 1
            current_month = 1
        else:
            current_month += 1

    return months


def get_google_account_tokens(google_account_id: str) -> dict:
    client = get_supabase_client()
    result = (
        client
        .table("google_account_tokens")
        .select("access_token, refresh_token, expires_at")
        .eq("google_account_id", google_account_id)
        .single()
        .execute()
    )
    return result.data


def update_google_account_tokens(google_account_id: str, access_token: str, expires_at: str):
    client = get_supabase_client()
    (
        client
        .table("google_account_tokens")
        .update({"access_token": access_token, "expires_at": expires_at})
        .eq("google_account_id", google_account_id)
        .execute()
    )


def mark_needs_reauth(google_account_id: str):
    client = get_supabase_client()
    (
        client
        .table("google_accounts")
        .update({"needs_reauth": True})
        .eq("id", google_account_id)
        .execute()
    )


def get_decrypted_tokens(user_id: str, google_account_id: str):
    row = get_google_account_tokens(google_account_id)
    return {
        "access_token": decrypt(row["access_token"], user_id),
        "refresh_token": decrypt(row["refresh_token"], user_id),
        "expires_at": row["expires_at"]
    }


def update_calendar_sync_state(
    calendar_id: str,
    sync_token: str,
    page_token: str = None,
    pages_fetched: int = None,
    items_upserted: int = None,
    sync_duration_ms: int = None
):
    client = get_supabase_client()
    data = {
        "google_calendar_id": calendar_id,
        "sync_token": sync_token,
        "next_page_token": page_token,
        "last_sync_at": datetime.now(timezone.utc).isoformat()
    }
    if pages_fetched is not None:
        data["pages_fetched"] = pages_fetched
    if items_upserted is not None:
        data["items_upserted"] = items_upserted
    if sync_duration_ms is not None:
        data["sync_duration_ms"] = sync_duration_ms
    (
        client
        .table("calendar_sync_state")
        .upsert(data, on_conflict="google_calendar_id")
        .execute()
    )


def update_page_token(calendar_id: str, page_token: str | None):
    client = get_supabase_client()
    (
        client
        .table("calendar_sync_state")
        .upsert({
            "google_calendar_id": calendar_id,
            "next_page_token": page_token
        }, on_conflict="google_calendar_id")
        .execute()
    )


def get_calendar_sync_state(calendar_id: str) -> dict | None:
    client = get_supabase_client()
    result = (
        client
        .table("calendar_sync_state")
        .select("sync_token, next_page_token, last_sync_at, pages_fetched, items_upserted, sync_duration_ms")
        .eq("google_calendar_id", calendar_id)
        .maybe_single()
        .execute()
    )
    return result.data if result else None


def clear_calendar_sync_state(calendar_id: str):
    client = get_supabase_client()
    (
        client
        .table("calendar_sync_state")
        .update({"sync_token": None, "next_page_token": None})
        .eq("google_calendar_id", calendar_id)
        .execute()
    )


def get_google_calendar(calendar_id: str) -> dict | None:
    client = get_supabase_client()
    result = (
        client
        .table("google_calendars")
        .select("*")
        .eq("id", calendar_id)
        .maybe_single()
        .execute()
    )
    return result.data if result else None


def get_google_account(google_account_id: str) -> dict | None:
    client = get_supabase_client()
    result = (
        client
        .table("google_accounts")
        .select("*")
        .eq("id", google_account_id)
        .maybe_single()
        .execute()
    )
    return result.data if result else None


def get_calendars_for_account(google_account_id: str) -> list[dict]:
    client = get_supabase_client()
    result = (
        client
        .table("google_calendars")
        .select("*")
        .eq("google_account_id", google_account_id)
        .execute()
    )
    return result.data if result else []


def get_google_accounts_for_user(user_id: str) -> list[dict]:
    client = get_supabase_client()
    result = (
        client
        .table("google_accounts")
        .select("id, email, name, needs_reauth, created_at")
        .eq("user_id", user_id)
        .execute()
    )
    return result.data if result else []


def get_all_calendars_for_user(user_id: str) -> list[dict]:
    client = get_supabase_client()
    result = (
        client
        .table("google_calendars")
        .select("*, google_accounts!inner(user_id)")
        .eq("google_accounts.user_id", user_id)
        .execute()
    )
    return result.data if result else []


def get_synced_months(calendar_id: str) -> list[tuple[int, int]]:
    client = get_supabase_client()
    result = (
        client
        .table("calendar_synced_months")
        .select("year, month")
        .eq("google_calendar_id", calendar_id)
        .execute()
    )
    return [(row["year"], row["month"]) for row in (result.data or [])]


def mark_months_synced(calendar_id: str, months: list[tuple[int, int]]):
    if not months:
        return

    client = get_supabase_client()
    rows = [
        {"google_calendar_id": calendar_id, "year": year, "month": month}
        for year, month in months
    ]
    (
        client
        .table("calendar_synced_months")
        .upsert(rows, on_conflict="google_calendar_id,year,month")
        .execute()
    )


def transform_google_event(event: dict, google_calendar_id: str, google_account_id: str, user_id: str) -> dict:
    start = event.get("start", {})
    end = event.get("end", {})
    is_all_day = "date" in start

    summary = event.get("summary", "(No title)")
    description = event.get("description")
    location = event.get("location")

    return {
        "google_event_id": event["id"],
        "google_calendar_id": google_calendar_id,
        "google_account_id": google_account_id,
        "source": "google",
        "summary": encrypt(summary, user_id),
        "description": encrypt(description, user_id) if description else None,
        "location": encrypt(location, user_id) if location else None,
        "start_datetime": start,
        "end_datetime": end,
        "is_all_day": is_all_day,
        "all_day_date": start.get("date"),
        "recurrence": event.get("recurrence"),
        "recurring_event_id": event.get("recurringEventId"),
        "original_start_time": event.get("originalStartTime", {}).get("dateTime"),
        "status": event.get("status", "confirmed"),
        "visibility": event.get("visibility", "default"),
        "transparency": event.get("transparency", "opaque"),
        "attendees": event.get("attendees"),
        "organizer": event.get("organizer"),
        "color_id": event.get("colorId"),
        "reminders": event.get("reminders"),
        "conference_data": event.get("conferenceData"),
        "html_link": event.get("htmlLink"),
        "ical_uid": event.get("iCalUID"),
        "etag": event.get("etag"),
        "embedding_pending": True,
    }


def process_events(events: list, google_calendar_id: str, google_account_id: str, user_id: str) -> dict:
    to_upsert = []
    to_delete = []

    for event in events:
        if event.get("status") == "cancelled":
            to_delete.append(event["id"])
        else:
            try:
                transformed = transform_google_event(event, google_calendar_id, google_account_id, user_id)
                to_upsert.append(transformed)
            except Exception as e:
                logger.error(f"Failed to transform event {event.get('id')}: {e}")
                raise

    supabase = get_supabase_client()

    if to_upsert:
        (
            supabase
            .table("events")
            .upsert(to_upsert, on_conflict="google_calendar_id,google_event_id,source")
            .execute()
        )

    if to_delete:
        (
            supabase
            .table("events")
            .delete()
            .in_("google_event_id", to_delete)
            .eq("google_calendar_id", google_calendar_id)
            .eq("source", "google")
            .execute()
        )

    return {"upserted": len(to_upsert), "deleted": len(to_delete)}
