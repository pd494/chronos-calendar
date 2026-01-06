from app.core.supabase import get_supabase_client
from app.services.google_calendar_client import fetch_events, GoogleAPIError

def process_events(events: list, calendar_id: str, google_account_id: str) -> dict:
    to_upsert = []
    to_delete = []

    for event in events:
        if event.get("status") == "cancelled":
            to_delete.append(event["id"])
        else:
            to_upsert.append(transform_google_event(event, calendar_id, google_account_id))

    supabase = get_supabase_client()

    if to_upsert:
        (
            supabase
            .table("events")
            .upsert(to_upsert, on_conflict="calendar_id,external_id,source")
            .execute()
        )

    if to_delete:
        (
            supabase
            .table("events")
            .delete()
            .in_("external_id", to_delete)
            .eq("calendar_id", calendar_id)
            .eq("source", "google")
            .execute()
        )

    return {"upserted": len(to_upsert), "deleted": len(to_delete)}

def transform_google_event(event: dict, calendar_id: str, google_account_id: str) -> dict:
    start = event.get("start", {})
    end = event.get("end", {})
    is_all_day = "date" in start

    return {
        "external_id": event["id"],
        "source": "google",
        "calendar_id": calendar_id,
        "google_account_id": google_account_id,
        "title": event.get("summary", ""),
        "description": event.get("description"),
        "location": event.get("location"),
        "start_time": start.get("dateTime"),
        "end_time": end.get("dateTime"),
        "is_all_day": is_all_day,
        "all_day_date": start.get("date"),
        "recurring_event_id": event.get("recurringEventId"),
        "etag": event.get("etag"),
    }

async def range_fetch(user_id: str, google_account_id: str, calendar_id: str, time_min: str, time_max: str):
    all_events = []
    page_token = None
    next_sync_token = None

    while True:
        response = await fetch_events(user_id, google_account_id, calendar_id, time_min, time_max, page_token)
        all_events.extend(response.get("items", []))
        page_token = response.get("nextPageToken")
        if not page_token:
            next_sync_token = response.get("nextSyncToken")
            break

    result = process_events(all_events, calendar_id, google_account_id)

    supabase = get_supabase_client()
    (
        supabase
        .table("calendar_fetched_ranges")
        .insert({
            "google_account_id": google_account_id,
            "calendar_id": calendar_id,
            "time_min": time_min,
            "time_max": time_max
        })
        .execute()
    )

    return {**result, "next_sync_token": next_sync_token}

async def delta_sync(user_id: str, google_account_id: str, calendar_id: str, sync_token: str):
    all_events = []
    page_token = None
    next_sync_token = None

    try:
        while True:
            response = await fetch_events(
                user_id,
                google_account_id,
                calendar_id,
                sync_token=sync_token,
                page_token=page_token
            )
            all_events.extend(response.get("items", []))
            page_token = response.get("nextPageToken")
            if not page_token:
                next_sync_token = response.get("nextSyncToken")
                break
    except GoogleAPIError as e:
        if e.status_code == 410:
            return {"sync_token_expired": True}
        raise

    result = process_events(all_events, calendar_id, google_account_id)
    return {**result, "next_sync_token": next_sync_token}
