import asyncio
import logging
import uuid

import httpx
from cachetools import TTLCache
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from supabase import Client

from app.calendar.db import (
    clear_calendar_sync_state,
    get_all_calendars_for_user,
    get_calendar_sync_state,
    get_google_accounts_for_user,
    get_google_calendar,
    get_latest_sync_at,
    get_user_calendar_ids,
    query_events,
    update_calendar_sync_state,
    upsert_events,
)
from app.calendar.gcal import get_events, list_calendars
from app.calendar.helpers import GoogleAPIError, decrypt_event, format_sse
from app.config import get_settings
from app.core.dependencies import (
    CurrentUser,
    HttpClient,
    SupabaseClientDep,
    VerifiedAccount,
)
from app.core.exceptions import handle_google_api_error, handle_unexpected_error

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


def _parse_calendar_ids(calendar_ids: str | None) -> list[str] | None:
    if not calendar_ids:
        return None
    raw_ids = calendar_ids.split(",")
    if len(raw_ids) > MAX_CALENDARS_PER_SYNC:
        raise HTTPException(status_code=400, detail=f"Too many calendars. Maximum is {MAX_CALENDARS_PER_SYNC}.")
    parsed = []
    for raw_id in raw_ids:
        raw_id = raw_id.strip()
        try:
            uuid.UUID(raw_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid calendar ID format")
        parsed.append(raw_id)
    return parsed


def validate_origin(request: Request):
    origin = request.headers.get("origin")
    if not origin:
        raise HTTPException(status_code=403, detail="Origin header required")
    if origin not in settings.cors_origins:
        raise HTTPException(status_code=403, detail="Invalid origin")


async def _upsert_events_batch(supabase: Client, events: list[dict], calendar_id: str) -> None:
    if not events:
        return
    try:
        await asyncio.to_thread(upsert_events, supabase, events)
    except Exception:
        logger.exception("Failed to upsert events for calendar %s", calendar_id)
        raise


async def _fetch_and_sync_calendar(
    http: httpx.AsyncClient,
    supabase: Client,
    user_id: str,
    calendar_id: str,
    events_queue: asyncio.Queue,
) -> None:
    calendar = await asyncio.to_thread(get_google_calendar, supabase, calendar_id, user_id)
    if not calendar:
        await events_queue.put({
            "type": "error",
            "calendar_id": calendar_id,
            "code": "404",
            "message": "Calendar not found",
            "retryable": False,
        })
        await events_queue.put({"type": "calendar_done", "calendar_id": calendar_id})
        return

    sync_state = await asyncio.to_thread(get_calendar_sync_state, supabase, calendar_id)
    sync_token = sync_state["sync_token"] if sync_state else None
    page_token = sync_state["next_page_token"] if sync_state else None

    is_retry = False
    while True:
        current_page_token: str | None = None
        upsert_tasks: list[asyncio.Task] = []
        try:
            async for page in get_events(
                http,
                supabase,
                user_id,
                calendar["google_account_id"],
                calendar_id,
                calendar["google_calendar_id"],
                sync_token=sync_token if not page_token else None,
                calendar_color=calendar.get("color"),
                page_token=page_token,
            ):
                if page["type"] == "events":
                    current_page_token = page.get("next_page_token")
                    if page["events"]:
                        upsert_tasks.append(
                            asyncio.create_task(_upsert_events_batch(supabase, page["events"], calendar_id))
                        )
                    decrypted_events = [decrypt_event(e, user_id) for e in page["events"]]
                    await events_queue.put({
                        "type": "events",
                        "calendar_id": calendar_id,
                        "events": decrypted_events,
                    })
                elif page["type"] == "sync_token":
                    upsert_failed = False
                    if upsert_tasks:
                        results = await asyncio.gather(*upsert_tasks, return_exceptions=True)
                        upsert_failed = any(isinstance(result, Exception) for result in results)
                    if upsert_failed:
                        logger.warning("Partial upsert failure for calendar %s, saving sync token anyway", calendar_id)
                        await events_queue.put({
                            "type": "error",
                            "calendar_id": calendar_id,
                            "code": "500",
                            "message": "Failed to persist some events",
                            "retryable": True,
                        })
                    await asyncio.to_thread(update_calendar_sync_state, supabase, calendar_id, page["token"])
                    await events_queue.put({
                        "type": "sync_token",
                        "calendar_id": calendar_id,
                        "token": page["token"],
                    })
        except GoogleAPIError as e:
            for task in upsert_tasks:
                if not task.done():
                    task.cancel()
            if upsert_tasks:
                await asyncio.gather(*upsert_tasks, return_exceptions=True)

            if e.status_code == 410 and not is_retry:
                logger.info("Sync token expired for calendar %s, clearing and retrying full sync", calendar_id)
                await asyncio.to_thread(clear_calendar_sync_state, supabase, calendar_id)
                sync_token = None
                page_token = None
                is_retry = True
                continue
            if page_token and not is_retry:
                logger.info("Page token resume failed for calendar %s, retrying full sync", calendar_id)
                page_token = None
                is_retry = True
                continue
            if current_page_token:
                await asyncio.to_thread(
                    update_calendar_sync_state, supabase, calendar_id,
                    sync_token or "", page_token=current_page_token,
                )
            await events_queue.put({
                "type": "error",
                "calendar_id": calendar_id,
                "code": str(e.status_code),
                "message": e.message,
                "retryable": e.retryable,
            })
        break

    await events_queue.put({"type": "calendar_done", "calendar_id": calendar_id})


@router.get("/events", response_model=EventsResponse)
async def list_events(
    current_user: CurrentUser,
    supabase: SupabaseClientDep,
    calendar_ids: str | None = Query(None),
):
    user_id = current_user["id"]
    validated = _parse_calendar_ids(calendar_ids)
    calendar_id_list = get_user_calendar_ids(supabase, user_id, ",".join(validated) if validated else None)

    if not calendar_id_list:
        return {"events": [], "masters": [], "exceptions": []}

    events_raw, masters_raw, exceptions_raw = query_events(supabase, calendar_id_list)

    return {
        "events": [decrypt_event(e, user_id) for e in events_raw],
        "masters": [decrypt_event(m, user_id) for m in masters_raw],
        "exceptions": [decrypt_event(e, user_id) for e in exceptions_raw],
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
    validated = _parse_calendar_ids(calendar_ids)
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
    _origin: None = Depends(validate_origin),
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
    _origin: None = Depends(validate_origin),
):
    user_id = current_user["id"]

    if user_id in _sync_rate_limits:
        raise HTTPException(status_code=429, detail="Sync rate limit exceeded. Please wait before syncing again.")
    _sync_rate_limits[user_id] = True

    validated = _parse_calendar_ids(calendar_ids)
    if validated is None:
        raise HTTPException(status_code=400, detail="calendar_ids is required")

    calendar_id_list = get_user_calendar_ids(supabase, user_id, ",".join(validated) if validated else None)

    async def event_generator():
        events_queue: asyncio.Queue = asyncio.Queue()
        total_events = 0
        fetch_tasks: list[asyncio.Task] = []
        fetch_semaphore = asyncio.Semaphore(MAX_CONCURRENT_CALENDAR_FETCHES)
        sync_start = asyncio.get_running_loop().time()

        async def fetch_calendar_events(calendar_id: str):
            async with fetch_semaphore:
                await _fetch_and_sync_calendar(http, supabase, user_id, calendar_id, events_queue)

        for cid in calendar_id_list:
            fetch_tasks.append(asyncio.create_task(fetch_calendar_events(cid)))

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
