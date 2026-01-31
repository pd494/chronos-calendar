import asyncio
import logging

import httpx
from supabase import Client

from app.calendar.db import (
    clear_calendar_sync_state,
    get_calendar_sync_state,
    get_google_calendar,
    update_calendar_sync_state,
    upsert_events,
)
from app.calendar.gcal import get_events
from app.calendar.helpers import (
    GoogleAPIError,
    encrypt_events,
    map_event_to_frontend,
)

logger = logging.getLogger(__name__)


async def add_events(supabase: Client, events: list[dict], user_id: str, calendar_id: str) -> None:
    if not events:
        return
    try:
        encrypted = await asyncio.to_thread(encrypt_events, events, user_id)
        await asyncio.to_thread(upsert_events, supabase, encrypted)
    except Exception:
        logger.exception("Failed to encrypt/upsert events for calendar %s", calendar_id)
        raise


async def sync_events(
    http: httpx.AsyncClient,
    supabase: Client,
    user_id: str,
    calendar_id: str,
    events_queue: asyncio.Queue,
    semaphore: asyncio.Semaphore | None = None,
) -> None:
    if semaphore:
        await semaphore.acquire()
    try:
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
                                asyncio.create_task(add_events(supabase, page["events"], user_id, calendar_id))
                            )
                        frontend_events = [map_event_to_frontend(e) for e in page["events"]]
                        await events_queue.put({
                            "type": "events",
                            "calendar_id": calendar_id,
                            "events": frontend_events,
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
    finally:
        if semaphore:
            semaphore.release()
