import asyncio
import logging
import time
from collections import defaultdict

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

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
    SupabaseClientDep,
    verify_account_access_dep,
)
from app.core.exceptions import handle_google_api_error, handle_unexpected_error

settings = get_settings()

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_CALENDARS_PER_SYNC = 20
MAX_CONCURRENT_CALENDAR_FETCHES = 5
SYNC_RATE_LIMIT_SECONDS = 5

_sync_rate_limits: dict[str, float] = defaultdict(float)


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
    calendar_ids: str | None = Query(None, description="Comma-separated calendar IDs"),
):
    user_id = current_user["id"]
    calendar_id_list = get_user_calendar_ids(supabase, user_id, calendar_ids)

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
    calendar_ids: str | None = Query(None, description="Comma-separated calendar IDs"),
):
    user_id = current_user["id"]
    calendar_id_list = get_user_calendar_ids(supabase, user_id, calendar_ids)

    last_sync_at = get_latest_sync_at(supabase, calendar_id_list)
    return {"lastSyncAt": last_sync_at}


@router.post("/accounts/{google_account_id}/refresh-calendars", response_model=CalendarsResponse)
async def refresh_calendars_from_google(google_account_id: str, current_user: CurrentUser, supabase: SupabaseClientDep):
    verify_account_access_dep(google_account_id, current_user, supabase)
    try:
        calendars = await list_calendars(supabase, current_user["id"], google_account_id)
        return {"calendars": calendars}
    except GoogleAPIError as e:
        handle_google_api_error(e, "Refresh calendars")
    except Exception as e:
        handle_unexpected_error(e, "refresh calendars")


@router.get("/sync")
async def sync_calendars(
    current_user: CurrentUser,
    supabase: SupabaseClientDep,
    calendar_ids: str = Query(..., description="Comma-separated calendar IDs"),
):
    user_id = current_user["id"]

    now = time.time()
    last_sync = _sync_rate_limits[user_id]
    if now - last_sync < SYNC_RATE_LIMIT_SECONDS:
        raise HTTPException(status_code=429, detail="Sync rate limit exceeded. Please wait before syncing again.")
    _sync_rate_limits[user_id] = now

    calendar_id_list = get_user_calendar_ids(supabase, user_id, calendar_ids)

    if len(calendar_id_list) > MAX_CALENDARS_PER_SYNC:
        raise HTTPException(
            status_code=400,
            detail=f"Too many calendars requested. Maximum allowed is {MAX_CALENDARS_PER_SYNC}.",
        )

    async def event_generator():
        events_queue = asyncio.Queue()
        total_events = 0
        fetch_tasks: list[asyncio.Task] = []
        fetch_semaphore = asyncio.Semaphore(MAX_CONCURRENT_CALENDAR_FETCHES)

        async def upsert_events_background(events: list[dict], calendar_id: str) -> None:
            if not events:
                return
            try:
                await asyncio.to_thread(upsert_events, supabase, events)
            except Exception:
                logger.exception("Failed to upsert events for calendar %s", calendar_id)
                raise

        async def fetch_calendar_events(calendar_id: str, is_retry: bool = False):
            async with fetch_semaphore:
                await _fetch_calendar_events_impl(calendar_id, is_retry)

        async def _fetch_calendar_events_impl(calendar_id: str, is_retry: bool = False):
            calendar = get_google_calendar(supabase, calendar_id, user_id)
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

            sync_state = get_calendar_sync_state(supabase, calendar_id)
            sync_token = sync_state["sync_token"] if sync_state and not is_retry else None
            upsert_tasks: list[asyncio.Task] = []
            try:
                async for page in get_events(
                    supabase,
                    user_id,
                    calendar["google_account_id"],
                    calendar_id,
                    calendar["google_calendar_id"],
                    sync_token,
                    calendar.get("color"),
                ):
                    if page["type"] == "events":
                        if page["events"]:
                            upsert_tasks.append(
                                asyncio.create_task(upsert_events_background(page["events"], calendar_id))
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
                            await events_queue.put({
                                "type": "error",
                                "calendar_id": calendar_id,
                                "code": "500",
                                "message": "Failed to persist events",
                                "retryable": True,
                            })
                            continue
                        update_calendar_sync_state(supabase, calendar_id, page["token"])
                        await events_queue.put({
                            "type": "sync_token",
                            "calendar_id": calendar_id,
                            "token": page["token"],
                        })
            except GoogleAPIError as e:
                if e.status_code == 410 and not is_retry:
                    logger.info("Sync token expired for calendar %s, clearing and retrying full sync", calendar_id)
                    await asyncio.to_thread(clear_calendar_sync_state, supabase, calendar_id)
                    await _fetch_calendar_events_impl(calendar_id, is_retry=True)
                    return
                await events_queue.put({
                    "type": "error",
                    "calendar_id": calendar_id,
                    "code": str(e.status_code),
                    "message": e.message,
                    "retryable": e.retryable,
                })

            await events_queue.put({"type": "calendar_done", "calendar_id": calendar_id})

        for cid in calendar_id_list:
            fetch_tasks.append(asyncio.create_task(fetch_calendar_events(cid)))

        calendars_done = 0
        try:
            while calendars_done < len(calendar_id_list):
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
