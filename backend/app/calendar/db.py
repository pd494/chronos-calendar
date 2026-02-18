import logging
from datetime import datetime, timezone

from supabase import Client

from app.core.db_utils import Row, all_rows, first_row
from app.core.encryption import Encryption

logger = logging.getLogger(__name__)


def update_google_account_tokens(
    supabase: Client,
    google_account_id: str,
    access_token: str,
    expires_at: str,
    refresh_token: str | None = None,
):
    data: dict[str, str] = {"access_token": access_token, "expires_at": expires_at}
    if refresh_token is not None:
        data["refresh_token"] = refresh_token
    (
        supabase
        .table("google_account_tokens")
        .update(data)
        .eq("google_account_id", google_account_id)
        .execute()
    )


def save_webhook_registration(
    supabase: Client,
    calendar_id: str,
    channel_id: str,
    resource_id: str,
    expires_at: datetime,
    token: str,
):
    (
        supabase
        .table("calendar_sync_state")
        .upsert(
            {
                "google_calendar_id": calendar_id,
                "webhook_channel_id": channel_id,
                "webhook_resource_id": resource_id,
                "webhook_expires_at": expires_at.isoformat(),
                "webhook_channel_token": token,
            },
            on_conflict="google_calendar_id",
        )
        .execute()
    )


def get_sync_state_by_channel_id(supabase: Client, channel_id: str) -> Row | None:
    result = (
        supabase
        .table("calendar_sync_state")
        .select(
            "google_calendar_id, webhook_channel_token,"
            " google_calendars!inner(google_account_id, google_calendar_id,"
            " google_accounts!inner(user_id))"
        )
        .eq("webhook_channel_id", channel_id)
        .limit(1)
        .execute()
    )
    return first_row(result.data)


def mark_needs_reauth(supabase: Client, google_account_id: str):
    (
        supabase
        .table("google_accounts")
        .update({"needs_reauth": True})
        .eq("id", google_account_id)
        .execute()
    )


def get_decrypted_tokens(supabase: Client, user_id: str, google_account_id: str) -> dict[str, str | None]:
    result = (
        supabase
        .table("google_account_tokens")
        .select("access_token, refresh_token, expires_at, google_accounts!inner(user_id)")
        .eq("google_account_id", google_account_id)
        .eq("google_accounts.user_id", user_id)
        .single()
        .execute()
    )
    row: Row = result.data  # type: ignore[assignment]
    return {
        "access_token": Encryption.decrypt(str(row["access_token"]), user_id),
        "refresh_token": Encryption.decrypt(str(row["refresh_token"]), user_id) if row.get("refresh_token") else None,
        "expires_at": str(row["expires_at"]),
    }


def update_calendar_sync_state(
    supabase: Client,
    calendar_id: str,
    sync_token: str,
    page_token: str | None = None,
    pages_fetched: int | None = None,
    items_upserted: int | None = None,
    sync_duration_ms: int | None = None,
    full_sync_complete: bool | None = None,
):
    data: dict[str, str | int | bool | None] = {
        "google_calendar_id": calendar_id,
        "sync_token": sync_token,
        "next_page_token": page_token,
        "last_sync_at": datetime.now(timezone.utc).isoformat(),
    }
    optional = {
        "pages_fetched": pages_fetched,
        "items_upserted": items_upserted,
        "sync_duration_ms": sync_duration_ms,
        "full_sync_complete": full_sync_complete,
    }
    data.update({k: v for k, v in optional.items() if v is not None})

    (
        supabase
        .table("calendar_sync_state")
        .upsert(data, on_conflict="google_calendar_id")
        .execute()
    )


def get_calendar_sync_state(supabase: Client, calendar_id: str) -> Row | None:
    result = (
        supabase
        .table("calendar_sync_state")
        .select("sync_token, next_page_token, last_sync_at, pages_fetched, items_upserted, sync_duration_ms, webhook_channel_id, webhook_expires_at")
        .eq("google_calendar_id", calendar_id)
        .limit(1)
        .execute()
    )
    return first_row(result.data)


def clear_calendar_sync_state(supabase: Client, calendar_id: str):
    (
        supabase
        .table("calendar_sync_state")
        .update({"sync_token": None, "next_page_token": None})
        .eq("google_calendar_id", calendar_id)
        .execute()
    )


def get_google_calendar(supabase: Client, calendar_id: str, user_id: str | None = None) -> Row | None:
    query = (
        supabase
        .table("google_calendars")
        .select("*, google_accounts!inner(user_id)")
        .eq("id", calendar_id)
    )
    if user_id:
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
        .select("id, email, name, needs_reauth, created_at")
        .eq("user_id", user_id)
        .execute()
    )
    return all_rows(result.data)


def get_all_calendars_for_user(supabase: Client, user_id: str) -> list[Row]:
    result = (
        supabase
        .table("google_calendars")
        .select("*, google_accounts!inner(user_id)")
        .eq("google_accounts.user_id", user_id)
        .execute()
    )
    return all_rows(result.data)


def upsert_events(supabase: Client, events: list[dict], batch_size: int = 500) -> int:
    if not events:
        return 0

    total = 0
    for i in range(0, len(events), batch_size):
        batch = events[i:i + batch_size]
        (
            supabase
            .table("events")
            .upsert(batch, on_conflict="google_calendar_id,google_event_id,source")
            .execute()
        )
        total += len(batch)
        calendar_ids = {event.get("google_calendar_id") for event in batch if event.get("google_calendar_id")}
        logger.info(
            "Upserted events batch size=%d batch=%d total=%d calendars=%d",
            len(batch),
            (i // batch_size) + 1,
            total,
            len(calendar_ids),
        )

    return total


def get_user_calendar_ids(supabase: Client, user_id: str, calendar_ids_param: str | None = None) -> list[str]:
    calendars = get_all_calendars_for_user(supabase, user_id)
    all_ids = [cal["id"] for cal in calendars]

    if not calendar_ids_param:
        return all_ids

    requested = set(calendar_ids_param.split(","))
    return [cid for cid in all_ids if cid in requested]


def get_latest_sync_at(supabase: Client, calendar_ids: list[str]) -> str | None:
    if not calendar_ids:
        return None

    result = (
        supabase
        .table("calendar_sync_state")
        .select("last_sync_at")
        .in_("google_calendar_id", calendar_ids)
        .not_.is_("last_sync_at", "null")
        .order("last_sync_at", desc=True)
        .limit(1)
        .execute()
    )

    row = first_row(result.data)
    return str(row["last_sync_at"]) if row else None


def query_events(supabase: Client, calendar_ids: list[str]) -> tuple[list[Row], list[Row], list[Row]]:
    events_result = (
        supabase
        .table("events")
        .select("*")
        .in_("google_calendar_id", calendar_ids)
        .eq("source", "google")
        .is_("recurrence", "null")
        .neq("status", "cancelled")
        .execute()
    )

    masters_result = (
        supabase
        .table("events")
        .select("*")
        .in_("google_calendar_id", calendar_ids)
        .eq("source", "google")
        .not_.is_("recurrence", "null")
        .is_("recurring_event_id", "null")
        .neq("status", "cancelled")
        .execute()
    )

    exceptions_result = (
        supabase
        .table("events")
        .select("*")
        .in_("google_calendar_id", calendar_ids)
        .eq("source", "google")
        .not_.is_("recurring_event_id", "null")
        .execute()
    )

    return (
        all_rows(events_result.data),
        all_rows(masters_result.data),
        all_rows(exceptions_result.data),
    )
