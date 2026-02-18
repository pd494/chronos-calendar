import asyncio
import logging
import os
from concurrent.futures import ThreadPoolExecutor

from cachetools import TTLCache
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.calendar.db import (
    get_all_calendars_for_user,
    get_google_accounts_for_user,
    get_latest_sync_at,
    get_sync_state_by_channel_id,
    get_user_calendar_ids,
    query_events,
)
from app.calendar.webhook import handle_webhook_notification
from app.calendar.gcal import list_calendars
from app.calendar.helpers import GoogleAPIError, decrypt_event, format_sse, parse_calendar_ids
from app.core.encryption import Encryption
from app.calendar.sync import sync_events
from app.config import get_settings
from app.core.dependencies import (
    CurrentUser,
    HttpClient,
    SupabaseClientDep,
    VerifiedAccount,
)
from app.core.exceptions import handle_google_api_error, handle_unexpected_error
from app.core.supabase import get_supabase_client

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

    if not calendar_id_list:
        return {"events": [], "masters": [], "exceptions": []}

    events_raw, masters_raw, exceptions_raw = query_events(supabase, calendar_id_list)
    total_raw = len(events_raw) + len(masters_raw) + len(exceptions_raw)

    if total_raw == 0:
        logger.info("  hydrate: 0 events in Supabase (will need full sync)")
        return {"events": [], "masters": [], "exceptions": []}

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
    }


@router.get("/accounts", response_model=AccountsResponse)
async def list_google_accounts(current_user: CurrentUser, supabase: SupabaseClientDep):
    accounts = get_google_accounts_for_user(supabase, current_user["id"])
    return {"accounts": accounts}


@router.get("/calendars", response_model=CalendarsResponse)
async def list_google_calendars(current_user: CurrentUser, supabase: SupabaseClientDep):
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


@router.post("/accounts/{google_account_id}/refresh-calendars", response_model=CalendarsResponse)
async def refresh_calendars_from_google(
    google_account_id: str,
    current_user: CurrentUser,
    supabase: SupabaseClientDep,
    http: HttpClient,
    _account: VerifiedAccount,
):
    try:
        calendars = await list_calendars(http, supabase, current_user["id"], google_account_id)
        return {"calendars": calendars}
    except GoogleAPIError as e:
        handle_google_api_error(e, "Refresh calendars")
    except Exception as e:
        handle_unexpected_error(e, "refresh calendars")


@router.get("/sync")
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
    if validated is None:
        raise HTTPException(status_code=400, detail="calendar_ids is required")

    calendar_id_list = get_user_calendar_ids(supabase, user_id, ",".join(validated) if validated else None)

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
        except asyncio.CancelledError:
            raise
        finally:
            for task in fetch_tasks:
                if not task.done():
                    task.cancel()

        yield format_sse("complete", {
            "total_events": total_events,
            "calendars_synced": calendars_done,
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
    if actual_token != expected_token:
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
