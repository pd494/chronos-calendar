import json
import logging

from supabase import Client

from app.core.db_utils import Row, all_rows, first_row

logger = logging.getLogger(__name__)


class GoogleAPIError(Exception):
    def __init__(self, status_code: int, message: str, retryable: bool = False):
        self.status_code = status_code
        self.message = message
        self.retryable = retryable
        super().__init__(f"Google API Error {status_code}: {message}")


def get_google_calendar(supabase: Client, calendar_id: str, user_id: str) -> Row | None:
    query = (
        supabase
        .table("google_calendars")
        .select("*, google_accounts!inner(user_id)")
        .eq("id", calendar_id)
    )
    query = query.eq("google_accounts.user_id", user_id)
    result = query.limit(1).execute()
    return first_row(result.data)


def get_google_account(supabase: Client, google_account_id: str) -> Row | None:
    result = (
        supabase
        .table("google_accounts")
        .select("*")
        .eq("id", google_account_id)
        .limit(1)
        .execute()
    )
    return first_row(result.data)


def get_google_accounts_for_user(supabase: Client, user_id: str) -> list[Row]:
    result = (
        supabase
        .table("google_accounts")
        .select("id, email, name, created_at, google_account_tokens(refresh_token)")
        .eq("user_id", user_id)
        .execute()
    )
    accounts = all_rows(result.data)
    for account in accounts:
        tokens = account.pop("google_account_tokens", None)
        account["needs_reauth"] = not tokens or tokens.get("refresh_token") is None
    return accounts


def transform_events(
    events: list[dict],
    google_calendar_id: str,
    google_account_id: str,
    calendar_color: str | None = None,
) -> list[dict]:
    transformed = []

    for event in events:
        start = event.get("start") or event.get("originalStartTime") or {}
        end = event.get("end") or {}

        transformed.append({
            "googleEventId": event["id"],
            "googleCalendarId": google_calendar_id,
            "googleAccountId": google_account_id,
            "source": "google",
            "summary": event.get("summary", "(No title)"),
            "description": event.get("description"),
            "location": event.get("location"),
            "start": start,
            "end": end,
            "recurrence": event.get("recurrence") or None,
            "recurringEventId": event.get("recurringEventId"),
            "originalStartTime": event.get("originalStartTime"),
            "status": event.get("status", "confirmed"),
            "visibility": event.get("visibility", "default"),
            "transparency": event.get("transparency", "opaque"),
            "attendees": event.get("attendees"),
            "organizer": event.get("organizer"),
            "colorId": event.get("colorId") or calendar_color,
            "reminders": event.get("reminders"),
            "conferenceData": event.get("conferenceData"),
            "htmlLink": event.get("htmlLink"),
            "iCalUID": event.get("iCalUID"),
            "etag": event.get("etag"),
            "createdAt": event.get("created"),
            "updatedAt": event.get("updated"),
        })

    return transformed


def format_sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"
