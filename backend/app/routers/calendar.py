import asyncio
import hmac
import logging
import uuid
from urllib.parse import quote

from cachetools import TTLCache
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from supabase import Client

from app.calendar.google_client import GoogleAPIClient, proxy_photo
from app.calendar.helpers import (
    GoogleAPIError,
    format_sse,
    get_google_account,
    get_google_accounts_for_user,
    transform_events,
)
from app.calendar.sync import Sync
from app.models.event import Event, EventPatch
from app.config import get_settings
from app.core.dependencies import (
    CurrentUser,
    HttpClient,
    SupabaseClientDep,
    VerifiedAccount,
    VerifiedCalendar,
    get_http_client,
)
from app.core.db_utils import all_rows, first_row

from app.core.security import request_guard
from app.core.exceptions import handle_google_api_error
from app.core.supabase import get_supabase_client, create_supabase_client
from app.models.event import EventCompletion

settings = get_settings()

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_CALENDARS_PER_SYNC = 20
MAX_CONCURRENT_CALENDAR_FETCHES = 5
MAX_SYNC_DURATION_SECONDS = 300
SYNC_RATE_LIMIT_SECONDS = 5
WEBHOOK_DEBOUNCE_SECONDS = 10
LOCAL_MUTATION_WEBHOOK_TTL_SECONDS = 15
_sync_rate_limits: TTLCache = TTLCache(maxsize=1024, ttl=SYNC_RATE_LIMIT_SECONDS)
_webhook_debounce: TTLCache = TTLCache(maxsize=1024, ttl=WEBHOOK_DEBOUNCE_SECONDS)
_local_mutation_webhook_suppression: TTLCache = TTLCache(maxsize=1024, ttl=LOCAL_MUTATION_WEBHOOK_TTL_SECONDS)
_webhook_sync_semaphore = asyncio.Semaphore(1)


def get_completed_events(supabase: Client, calendar_ids: list[str]) -> list[dict]:
    result = (
        supabase
        .table("completed_events")
        .select("*")
        .in_("google_calendar_id", calendar_ids)
        .execute()
    )
    return all_rows(result.data)


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


def resolve_calendar_ids(supabase: Client, user_id: str, calendar_ids: str | None = None) -> list[str]:
    all_ids = [
        cal["id"] for cal in
        supabase.table("google_calendars")
        .select("id, google_accounts!inner(user_id)")
        .eq("google_accounts.user_id", user_id)
        .execute()
        .data or []
    ]
    if not calendar_ids:
        return all_ids
    requested = {raw.strip() for raw in calendar_ids.split(",")}
    return [cid for cid in all_ids if cid in requested]


def query_events(supabase: Client, calendar_ids: list[str]) -> tuple[list[dict], list[dict], list[dict]]:
    events_result = (
        supabase.table("events")
        .select("*")
        .in_("googleCalendarId", calendar_ids)
        .eq("source", "google")
        .is_("recurrence", "null")
        .is_("recurringEventId", "null")
        .neq("status", "cancelled")
        .execute()
    )
    masters_result = (
        supabase.table("events")
        .select("*")
        .in_("googleCalendarId", calendar_ids)
        .eq("source", "google")
        .not_.is_("recurrence", "null")
        .is_("recurringEventId", "null")
        .neq("status", "cancelled")
        .execute()
    )
    exceptions_result = (
        supabase.table("events")
        .select("*")
        .in_("googleCalendarId", calendar_ids)
        .eq("source", "google")
        .not_.is_("recurringEventId", "null")
        .execute()
    )
    return (
        all_rows(events_result.data),
        all_rows(masters_result.data),
        all_rows(exceptions_result.data),
    )


def suppress_webhooks_for_calendar(calendar_id: str) -> None:
    _local_mutation_webhook_suppression[calendar_id] = True


@router.get("/events")
async def list_events(
    current_user: CurrentUser,
    supabase: SupabaseClientDep,
    calendar_ids: str | None = Query(None),
):
    user_id = current_user["id"]
    calendar_id_list = resolve_calendar_ids(supabase, user_id, calendar_ids)

    if calendar_id_list:
        events_raw, masters_raw, exceptions_raw = query_events(supabase, calendar_id_list)
        completions = get_completed_events(supabase, calendar_id_list)

        return {
            "events": events_raw,
            "masters": masters_raw,
            "exceptions": exceptions_raw,
            "completions": completions,
        }
    return {"events": [], "masters": [], "exceptions": [], "completions": []}


@router.get("/accounts")
async def list_google_accounts(
    current_user: CurrentUser,
    supabase: SupabaseClientDep,
):
    accounts = get_google_accounts_for_user(supabase, current_user["id"])
    return {"accounts": accounts}


@router.get("/calendars")
async def list_google_calendars(
    current_user: CurrentUser,
    supabase: SupabaseClientDep,
):
    calendars = (
        supabase.table("google_calendars")
        .select("*, google_accounts!inner(user_id)")
        .eq("google_accounts.user_id", current_user["id"])
        .execute()
        .data or []
    )
    return {"calendars": calendars}


@router.get("/sync-status")
async def get_sync_status(
    current_user: CurrentUser,
    supabase: SupabaseClientDep,
    calendar_ids: str | None = Query(None),
):
    user_id = current_user["id"]
    calendar_id_list = resolve_calendar_ids(supabase, user_id, calendar_ids)

    last_sync_at = get_latest_sync_at(supabase, calendar_id_list)
    return {"lastSyncAt": last_sync_at}


@router.post("/complete-event", dependencies=[Depends(request_guard.authorize)])
async def event_completion(
    body: EventCompletion,
    current_user: CurrentUser,
    supabase: SupabaseClientDep,
):
    if body.completed:
        supabase.table("completed_events").upsert(
            {
                "user_id": current_user["id"],
                "google_calendar_id": body.google_calendar_id,
                "master_event_id": body.master_event_id,
                "instance_start": body.instance_start,
            },
            on_conflict="google_calendar_id, master_event_id, instance_start",
        ).execute()
    else:
        supabase.table("completed_events").delete().eq(
            "google_calendar_id", body.google_calendar_id
        ).eq("master_event_id", body.master_event_id).eq(
            "instance_start", body.instance_start
        ).execute()
    return {"completed": body.completed}


@router.post("/{calendar_id}/events", dependencies=[Depends(request_guard.authorize)])
async def event_creation(
    current_user: CurrentUser,
    supabase: SupabaseClientDep,
    verified_calendar: VerifiedCalendar,
    http: HttpClient,
    event_body: Event
):
    try:
        suppress_webhooks_for_calendar(verified_calendar["id"])
        client = GoogleAPIClient(supabase, http, current_user["id"], verified_calendar["google_account_id"])
        response = await client.create_event(verified_calendar["google_calendar_id"], event_body)
        transformed = transform_events([response], verified_calendar["id"], verified_calendar["google_account_id"], verified_calendar.get("color"))
        supabase.table("events").upsert(transformed, on_conflict="googleCalendarId,googleEventId,source").execute()
        return transformed[0]
    except GoogleAPIError as e:
        handle_google_api_error(e)

@router.patch("/{calendar_id}/events/{event_id}", dependencies=[Depends(request_guard.authorize)])
async def event_update(
    calendar_id: str,
    event_id: str,
    current_user: CurrentUser,
    supabase: SupabaseClientDep,
    verified_calendar: VerifiedCalendar,
    http: HttpClient,
    event_body: EventPatch
):
    try:
        suppress_webhooks_for_calendar(verified_calendar["id"])
        client = GoogleAPIClient(supabase, http, current_user["id"], verified_calendar["google_account_id"])
        response = await client.edit_event(verified_calendar["google_calendar_id"], event_id, event_body)
        transformed = transform_events([response], verified_calendar["id"], verified_calendar["google_account_id"], verified_calendar.get("color"))
        supabase.table("events").upsert(transformed, on_conflict="googleCalendarId,googleEventId,source").execute()
        return transformed[0]
    except GoogleAPIError as e:
        handle_google_api_error(e)

@router.delete("/{calendar_id}/events/{event_id}", status_code=204, dependencies=[Depends(request_guard.authorize)])
async def event_delete(
    calendar_id: str,
    event_id: str,
    current_user: CurrentUser,
    supabase: SupabaseClientDep,
    verified_calendar: VerifiedCalendar,
    http: HttpClient,
):
    try:
        suppress_webhooks_for_calendar(verified_calendar["id"])
        client = GoogleAPIClient(supabase, http, current_user["id"], verified_calendar["google_account_id"])
        await client.delete_event(verified_calendar["google_calendar_id"], event_id)
        supabase.table("events").delete().eq("googleCalendarId", verified_calendar["id"]).eq("googleEventId", event_id).execute()
        return Response(status_code=204)
    except GoogleAPIError as e:
        handle_google_api_error(e)

@router.post("/accounts/{google_account_id}/refresh-calendars", dependencies=[Depends(request_guard.authorize)])
async def refresh_calendars_from_google(
    google_account_id: str,
    current_user: CurrentUser,
    supabase: SupabaseClientDep,
    http: HttpClient,
    _account: VerifiedAccount,
):
    try:
        client = GoogleAPIClient(supabase, http, current_user["id"], google_account_id)
        response = await client.fetch_calendars()
        items = response.get("items", [])
        if not items:
            return {"calendars": []}

        rows = supabase.table("google_calendars").upsert([
            {
                "google_account_id": google_account_id,
                "google_calendar_id": cal["id"],
                "name": cal.get("summary", ""),
                "color": cal.get("backgroundColor"),
                "is_primary": cal.get("primary", False),
                "access_role": cal.get("accessRole", "reader"),
            }
            for cal in items
        ], on_conflict="google_account_id,google_calendar_id").execute().data
        account = get_google_account(supabase, google_account_id)
        if account is None:
            raise ValueError("Google account not found")

        calendars = [
            {
                "id": row["id"],
                "google_calendar_id": row["google_calendar_id"],
                "name": row["name"],
                "color": row["color"],
                "is_primary": row["is_primary"],
                "google_account_id": google_account_id,
                "account_email": account["email"],
                "account_name": account["name"],
            }
            for row in rows
        ]
        return {"calendars": calendars}
    except GoogleAPIError as e:
        handle_google_api_error(e)
    except Exception:
        logger.exception("Failed to refresh calendars for account %s", google_account_id)
        raise HTTPException(status_code=500, detail="An internal error occurred")


@router.get("/contacts/directory", dependencies=[Depends(request_guard.authorize)])
async def contact_directory(
    current_user: CurrentUser,
    supabase: SupabaseClientDep,
):
    user_id = current_user["id"]
    accounts = get_google_accounts_for_user(supabase, user_id)
    if not accounts:
        return {"contacts": []}
    account_id = accounts[0]["id"]
    result = (
        supabase.table("contact_directory")
        .select("email, display_name, photo_url")
        .eq("google_account_id", account_id)
        .execute()
    )
    rows = all_rows(result.data)
    contacts = [
        {
            "email": row["email"],
            "displayName": row["display_name"],
            "photoUrl": (
                f"/calendar/contacts/photo?url={quote(row['photo_url'], safe='')}"
                if row.get("photo_url")
                else None
            ),
        }
        for row in rows
    ]
    return {"contacts": contacts}


@router.get("/contacts/workspace", dependencies=[Depends(request_guard.authorize)])
async def workspace_search(
    current_user: CurrentUser,
    supabase: SupabaseClientDep,
    http: HttpClient,
    q: str = Query("", max_length=100),
):
    if len(q) < 2:
        return {"contacts": []}
    user_id = current_user["id"]
    accounts = get_google_accounts_for_user(supabase, user_id)
    if not accounts:
        return {"contacts": []}
    account_id = accounts[0]["id"]

    try:
        client = GoogleAPIClient(supabase, http, user_id, account_id)
        people = await client.search_workspace(q)
    except GoogleAPIError as e:
        handle_google_api_error(e)
        return {"contacts": []}

    seen = set()
    contacts = []
    for person in people:
        addrs = person.get("emailAddresses") or []
        if not addrs or not (val := addrs[0].get("value")):
            continue
        email = val.lower()
        if email in seen:
            continue
        seen.add(email)
        names = person.get("names") or []
        display_name = names[0]["displayName"] if names else None
        photos = person.get("photos") or []
        raw = photos[0]["url"] if photos else None
        photo_url = f"/calendar/contacts/photo?url={quote(raw, safe='')}" if raw else None
        contacts.append({"email": email, "displayName": display_name, "photoUrl": photo_url})
    return {"contacts": contacts}


@router.get("/contacts/group-members", dependencies=[Depends(request_guard.authorize)])
async def get_group_members(
    current_user: CurrentUser,
    supabase: SupabaseClientDep,
    http: HttpClient,
    group_email: str = Query(..., max_length=200),
):
    user_id = current_user["id"]
    accounts = get_google_accounts_for_user(supabase, user_id)
    if not accounts:
        return {"members": []}
    account_id = accounts[0]["id"]

    try:
        client = GoogleAPIClient(supabase, http, user_id, account_id)
        raw_members = await client.list_group_members(group_email)
    except GoogleAPIError as e:
        handle_google_api_error(e)
        return {"members": []}

    members = [
        {"email": m["email"].lower(), "role": m.get("role", "MEMBER")}
        for m in raw_members
        if m.get("email") and m.get("type") != "GROUP"
    ]
    return {"members": members}


@router.get("/contacts/photo", dependencies=[Depends(request_guard.authorize)])
async def proxy_contact_photo(
    http: HttpClient,
    url: str = Query(...),
):
    if not url.startswith("https://lh3.googleusercontent.com/"):
        raise HTTPException(status_code=400, detail="Invalid photo URL")
    try:
        content, content_type = await proxy_photo(http, url)
    except GoogleAPIError as e:
        raise HTTPException(status_code=e.status_code, detail="Photo fetch failed")
    return Response(
        content=content,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )


class SyncRequest(BaseModel):
    calendar_ids: list[uuid.UUID] = Field(..., max_length=MAX_CALENDARS_PER_SYNC)


@router.post("/sync", dependencies=[Depends(request_guard.authorize)])
async def sync_calendars(
    body: SyncRequest,
    current_user: CurrentUser,
    supabase: SupabaseClientDep,
    http: HttpClient,
):
    user_id = current_user["id"]
    if user_id in _sync_rate_limits:
        raise HTTPException(status_code=429, detail="Sync rate limit exceeded. Please wait before syncing again.")
    _sync_rate_limits[user_id] = True

    calendar_id_list = [str(cid) for cid in body.calendar_ids]

    async def event_generator():
        queue = asyncio.Queue()
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_CALENDAR_FETCHES)
        calendars_done = 0

        async def run_sync(cid):
            async with semaphore:
                await Sync(create_supabase_client(), http, user_id, cid, queue).run()

        tasks = [asyncio.create_task(run_sync(cid)) for cid in calendar_id_list]
        try:
            async with asyncio.timeout(MAX_SYNC_DURATION_SECONDS):
                while calendars_done < len(calendar_id_list):
                    try:
                        item = await asyncio.wait_for(queue.get(), timeout=15)
                    except asyncio.TimeoutError:
                        yield ": keep-alive\n\n"
                        continue
                    if item["type"] == "events":
                        yield format_sse("events", item)
                    elif item["type"] == "calendar_done":
                        calendars_done += 1
                    elif item["type"] == "sync_token":
                        yield format_sse("sync_token", item)
                    elif item["type"] == "error":
                        yield format_sse("sync_error", item)
        except TimeoutError:
            yield format_sse("sync_error", {"code": "408", "message": "Sync timed out"})
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()

        last_sync_at = await asyncio.to_thread(get_latest_sync_at, create_supabase_client(), calendar_id_list)
        yield format_sse("complete", {
            "calendars_synced": calendars_done,
            "last_sync_at": last_sync_at,
        })

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/webhook")
async def receive_webhook(request: Request):
    channel_id = request.headers.get("X-Goog-Channel-Id")
    if not channel_id:
        raise HTTPException(status_code=400, detail="Missing channel ID")

    supabase = get_supabase_client()
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
    sync_state = result.data[0] if result.data else None
    if not sync_state:
        return {}

    expected_token = sync_state.get("webhook_channel_token")
    actual_token = request.headers.get("X-Goog-Channel-Token")
    if not actual_token or not expected_token or not hmac.compare_digest(actual_token, expected_token):
        raise HTTPException(status_code=401, detail="Invalid token")

    resource_state = request.headers.get("X-Goog-Resource-State")

    if resource_state == "sync":
        return {}

    calendar_id = sync_state["google_calendar_id"]
    if calendar_id in _local_mutation_webhook_suppression:
        return {}
    if calendar_id in _webhook_debounce:
        return {}
    _webhook_debounce[calendar_id] = True

    user_id = sync_state["google_calendars"]["google_accounts"]["user_id"]
    http = await get_http_client()

    async def _guarded_sync():
        async with _webhook_sync_semaphore:
            await Sync(create_supabase_client(), http, user_id, calendar_id).run()

    asyncio.create_task(_guarded_sync())
    return {}
