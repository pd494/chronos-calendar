import asyncio
import hmac
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote

from cachetools import TTLCache
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from app.calendar.gcal import create_event, patch_event, delete_event, search_workspace, list_group_members, proxy_photo
from app.models.event import Event, EventPatch
from app.calendar.db import (
    get_contacts,
    parse_person,
    encrypt_and_upsert,
    get_all_calendars_for_user,
    get_google_account,
    get_google_accounts_for_user,
    get_latest_sync_at,
    get_sync_state_by_channel_id,
    get_user_calendar_ids,
    query_events,
    complete_event,
    get_completed_events,
    upsert_calendars,
)
from app.calendar.webhook import handle_webhook_notification
from app.calendar.gcal import list_calendars
from app.calendar.helpers import GoogleAPIError, decrypt_event, format_sse, map_event_to_frontend, parse_calendar_ids, transform_events
from app.core.encryption import Encryption
from app.calendar.sync import sync_events
from app.config import get_settings
from app.core.dependencies import (
    CurrentUser,
    HttpClient,
    SupabaseClientDep,
    VerifiedAccount,
    VerifiedCalendar,
)
from app.core.security import request_guard
from app.core.exceptions import handle_google_api_error
from app.core.supabase import get_supabase_client
from app.models.event import EventCompletion

settings = get_settings()

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_CALENDARS_PER_SYNC = 20
MAX_CONCURRENT_CALENDAR_FETCHES = 5
MAX_SYNC_DURATION_SECONDS = 300
SYNC_RATE_LIMIT_SECONDS = 5

_sync_rate_limits: TTLCache = TTLCache(maxsize=1024, ttl=SYNC_RATE_LIMIT_SECONDS)


class EventsResponse(BaseModel):
    events: list[dict]
    masters: list[dict]
    exceptions: list[dict]
    completions: list[dict]


class AccountsResponse(BaseModel):
    accounts: list[dict]


class CalendarsResponse(BaseModel):
    calendars: list[dict]


class SyncStatusResponse(BaseModel):
    lastSyncAt: str | None


@router.get("/events", response_model=EventsResponse)
async def list_events(
    current_user: CurrentUser,
    supabase: SupabaseClientDep,
    calendar_ids: str | None = Query(None),
):
    user_id = current_user["id"]
    validated = parse_calendar_ids(calendar_ids, MAX_CALENDARS_PER_SYNC)
    calendar_id_list = get_user_calendar_ids(supabase, user_id, ",".join(validated) if validated else None)

    if calendar_id_list:
        events_raw, masters_raw, exceptions_raw = query_events(supabase, calendar_id_list)
        total_raw = len(events_raw) + len(masters_raw) + len(exceptions_raw)

        completions = get_completed_events(supabase, calendar_id_list)

        if total_raw == 0:
            logger.info("  hydrate: 0 events in Supabase (will need full sync)")
            return {"events": [], "masters": [], "exceptions": [], "completions": completions}

        logger.info("  hydrate: %d events from Supabase, decrypting...", total_raw)

        key = Encryption.derive_key(user_id)
        max_workers = min(8, (os.cpu_count() or 4))
        loop = asyncio.get_running_loop()
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            events_task = loop.run_in_executor(pool, lambda: [decrypt_event(e, user_id, key=key) for e in events_raw])
            masters_task = loop.run_in_executor(pool, lambda: [decrypt_event(m, user_id, key=key) for m in masters_raw])
            exceptions_task = loop.run_in_executor(pool, lambda: [decrypt_event(e, user_id, key=key) for e in exceptions_raw])
            events, masters, exceptions = await asyncio.gather(events_task, masters_task, exceptions_task)

        return {
            "events": events,
            "masters": masters,
            "exceptions": exceptions,
            "completions": completions,
        }
    return {"events": [], "masters": [], "exceptions": [], "completions": []}


@router.get("/accounts", response_model=AccountsResponse)
async def list_google_accounts(
    current_user: CurrentUser,
    supabase: SupabaseClientDep,
):
    accounts = get_google_accounts_for_user(supabase, current_user["id"])
    return {"accounts": accounts}


@router.get("/calendars", response_model=CalendarsResponse)
async def list_google_calendars(
    current_user: CurrentUser,
    supabase: SupabaseClientDep,
):
    calendars = get_all_calendars_for_user(supabase, current_user["id"])
    return {"calendars": calendars}


@router.get("/sync-status", response_model=SyncStatusResponse)
async def get_sync_status(
    current_user: CurrentUser,
    supabase: SupabaseClientDep,
    calendar_ids: str | None = Query(None),
):
    user_id = current_user["id"]
    validated = parse_calendar_ids(calendar_ids, MAX_CALENDARS_PER_SYNC)
    calendar_id_list = get_user_calendar_ids(supabase, user_id, ",".join(validated) if validated else None)

    last_sync_at = get_latest_sync_at(supabase, calendar_id_list)
    return {"lastSyncAt": last_sync_at}

@router.post("/complete-event", dependencies=[Depends(request_guard.authorize)])
async def event_completion(
    body: EventCompletion,
    current_user: CurrentUser,
    supabase: SupabaseClientDep,
):
    complete_event(supabase, user_id=current_user["id"], **body.model_dump())
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
        response = await create_event(http, supabase, current_user["id"], verified_calendar["google_account_id"], verified_calendar["google_calendar_id"], event_body)
        transformed = transform_events([response], verified_calendar["id"], verified_calendar["google_account_id"], verified_calendar.get("color"))
        encrypt_and_upsert(supabase, current_user["id"], transformed)
        return map_event_to_frontend(transformed[0])
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
        response = await patch_event(http, supabase, current_user["id"], verified_calendar["google_account_id"], verified_calendar["google_calendar_id"], event_id, event_body)
        transformed = transform_events([response], verified_calendar["id"], verified_calendar["google_account_id"], verified_calendar.get("color"))
        encrypt_and_upsert(supabase, current_user["id"], transformed)
        return map_event_to_frontend(transformed[0])
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
        await delete_event(http, supabase, current_user["id"], verified_calendar["google_account_id"], verified_calendar["google_calendar_id"], event_id)
        supabase.table("events").delete().eq("google_calendar_id", verified_calendar["id"]).eq("google_event_id", event_id).execute()
        return Response(status_code=204)
    except GoogleAPIError as e:
        handle_google_api_error(e)

@router.post("/accounts/{google_account_id}/refresh-calendars", response_model=CalendarsResponse, dependencies=[Depends(request_guard.authorize)])
async def refresh_calendars_from_google(
    google_account_id: str,
    current_user: CurrentUser,
    supabase: SupabaseClientDep,
    http: HttpClient,
    _account: VerifiedAccount,
):
    try:
        items = await list_calendars(http, supabase, current_user["id"], google_account_id)
        if not items:
            return {"calendars": []}

        rows = upsert_calendars(supabase, google_account_id, items)
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
                "needs_reauth": account["needs_reauth"],
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

    directory = await asyncio.to_thread(get_contacts, supabase, account_id)
    contacts = [
        {
            "email": email,
            "displayName": entry.display_name,
            "photoUrl": f"/calendar/contacts/photo?url={quote(entry.photo_url, safe='')}" if entry.photo_url else None,
        }
        for email, entry in directory.items()
    ]
    return {"contacts": contacts}


@router.get("/contacts/workspace", dependencies=[Depends(request_guard.authorize)])
async def workspace_search(
    q: str = Query("", max_length=100),
    current_user: CurrentUser = None,
    supabase: SupabaseClientDep = None,
    http: HttpClient = None,
):
    if len(q) < 2:
        return {"contacts": []}
    user_id = current_user["id"]
    accounts = get_google_accounts_for_user(supabase, user_id)
    if not accounts:
        return {"contacts": []}
    account_id = accounts[0]["id"]

    try:
        people = await search_workspace(http, supabase, user_id, account_id, q)
    except GoogleAPIError as e:
        handle_google_api_error(e)
        return {"contacts": []}

    seen = set()
    contacts = []
    for person in people:
        parsed = parse_person(person)
        if not parsed or parsed[0] in seen:
            continue
        seen.add(parsed[0])
        photo_url = f"/calendar/contacts/photo?url={quote(parsed[2], safe='')}" if parsed[2] else None
        contacts.append({"email": parsed[0], "displayName": parsed[1], "photoUrl": photo_url})
    return {"contacts": contacts}


@router.get("/contacts/group-members", dependencies=[Depends(request_guard.authorize)])
async def get_group_members(
    group_email: str = Query(..., max_length=200),
    current_user: CurrentUser = None,
    supabase: SupabaseClientDep = None,
    http: HttpClient = None,
):
    user_id = current_user["id"]
    accounts = get_google_accounts_for_user(supabase, user_id)
    if not accounts:
        return {"members": []}
    account_id = accounts[0]["id"]

    try:
        raw_members = await list_group_members(http, supabase, user_id, account_id, group_email)
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
    url: str = Query(...),
    http: HttpClient = None,
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


@router.get("/sync", dependencies=[Depends(request_guard.authorize)])
async def sync_calendars(
    current_user: CurrentUser,
    supabase: SupabaseClientDep,
    http: HttpClient,
    calendar_ids: str = Query(...),
):
    user_id = current_user["id"]

    if user_id in _sync_rate_limits:
        raise HTTPException(status_code=429, detail="Sync rate limit exceeded. Please wait before syncing again.")
    _sync_rate_limits[user_id] = True

    validated = parse_calendar_ids(calendar_ids, MAX_CALENDARS_PER_SYNC)
    if validated is not None:
        calendar_id_list = get_user_calendar_ids(supabase, user_id, ",".join(validated) if validated else None)
    else:
        raise HTTPException(status_code=400, detail="calendar_ids is required")

    async def event_generator():
        events_queue: asyncio.Queue = asyncio.Queue()
        total_events = 0
        fetch_tasks: list[asyncio.Task] = []
        fetch_semaphore = asyncio.Semaphore(MAX_CONCURRENT_CALENDAR_FETCHES)
        sync_start = asyncio.get_running_loop().time()

        for cid in calendar_id_list:
            fetch_tasks.append(asyncio.create_task(
                sync_events(http, supabase, user_id, cid, events_queue, fetch_semaphore)
            ))

        calendars_done = 0
        try:
            while calendars_done < len(calendar_id_list):
                if asyncio.get_running_loop().time() - sync_start > MAX_SYNC_DURATION_SECONDS:
                    yield format_sse("sync_error", {"code": "408", "message": "Sync timed out"})
                    break

                try:
                    item = await asyncio.wait_for(events_queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                if item["type"] == "calendar_done":
                    calendars_done += 1
                elif item["type"] == "events":
                    total_events += len(item["events"])
                    yield format_sse("events", item)
                elif item["type"] == "sync_token":
                    yield format_sse("sync_token", item)
                elif item["type"] == "error":
                    yield format_sse("sync_error", item)
        finally:
            for task in fetch_tasks:
                if not task.done():
                    task.cancel()

        last_sync_at = await asyncio.to_thread(get_latest_sync_at, supabase, calendar_id_list)

        yield format_sse("complete", {
            "total_events": total_events,
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
    sync_state = await asyncio.to_thread(get_sync_state_by_channel_id, supabase, channel_id)
    if not sync_state:
        return {}

    expected_token = sync_state.get("webhook_channel_token")
    actual_token = request.headers.get("X-Goog-Channel-Token")
    if not actual_token or not expected_token or not hmac.compare_digest(actual_token, expected_token):
        logger.warning("Webhook token mismatch for channel %s", channel_id)
        raise HTTPException(status_code=401, detail="Invalid token")

    resource_state = request.headers.get("X-Goog-Resource-State")
    logger.info("Webhook received: channel=%s state=%s", channel_id, resource_state)

    if resource_state == "sync":
        return {}

    calendar_id = sync_state["google_calendar_id"]
    user_id = sync_state["google_calendars"]["google_accounts"]["user_id"]
    handle_webhook_notification(calendar_id, user_id)
    return {}
