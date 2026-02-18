import asyncio
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from supabase import Client

from app.calendar.constants import WEBHOOK_CHANNEL_BUFFER_HOURS
from app.calendar.db import (
    clear_calendar_sync_state,
    get_calendar_sync_state,
    get_google_calendar,
    save_webhook_registration,
    update_calendar_sync_state,
    upsert_events,
)
from app.calendar.gcal import create_watch_channel, get_events, get_valid_access_token
from app.calendar.helpers import (
    GoogleAPIError,
    encrypt_events,
    map_event_to_frontend,
)
from app.config import get_settings

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


async def _sync_calendar(
    http: httpx.AsyncClient,
    supabase: Client,
    user_id: str,
    calendar_id: str,
    events_queue: asyncio.Queue | None = None,
) -> None:
    calendar = await asyncio.to_thread(get_google_calendar, supabase, calendar_id, user_id)
    if not calendar:
        if events_queue:
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

    cal_name = calendar.get("name", calendar_id[:8])
    if sync_token:
        logger.info("  [%s] incremental sync (has sync token)", cal_name)
    elif page_token:
        logger.info("  [%s] resuming full sync (has page token)", cal_name)
    else:
        logger.info("  [%s] full sync (no sync state)", cal_name)

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
                    if events_queue:
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
                        if events_queue:
                            await events_queue.put({
                                "type": "error",
                                "calendar_id": calendar_id,
                                "code": "500",
                                "message": "Failed to persist some events",
                                "retryable": True,
                            })
                    await asyncio.to_thread(update_calendar_sync_state, supabase, calendar_id, page["token"])
                    if events_queue:
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
            if events_queue:
                await events_queue.put({
                    "type": "error",
                    "calendar_id": calendar_id,
                    "code": str(e.status_code),
                    "message": e.message,
                    "retryable": e.retryable,
                })
        break

    await _ensure_webhook_channel(http, supabase, user_id, calendar_id, calendar)

    if events_queue:
        await events_queue.put({"type": "calendar_done", "calendar_id": calendar_id})


async def _ensure_webhook_channel(
    http: httpx.AsyncClient,
    supabase: Client,
    user_id: str,
    calendar_id: str,
    calendar: dict,
) -> None:

    settings = get_settings()
    if not settings.WEBHOOK_BASE_URL:
        return

    try:
        sync_state = await asyncio.to_thread(get_calendar_sync_state, supabase, calendar_id)
        if sync_state:
            expires_at = sync_state.get("webhook_expires_at")
            if expires_at:
                buffer = datetime.now(timezone.utc) + timedelta(hours=WEBHOOK_CHANNEL_BUFFER_HOURS)
                if datetime.fromisoformat(str(expires_at)) > buffer:
                    return
        channel_id = str(uuid.uuid4())
        channel_token = secrets.token_urlsafe(32)
        webhook_url = f"{settings.WEBHOOK_BASE_URL}/calendar/webhook"

        access_token = await get_valid_access_token(http, supabase, user_id, calendar["google_account_id"])
        result = await create_watch_channel(
            http,
            access_token,
            calendar["google_calendar_id"],
            webhook_url,
            channel_id,
            channel_token,
        )

        await asyncio.to_thread(
            save_webhook_registration,
            supabase,
            calendar_id,
            channel_id,
            result["resource_id"],
            result["expires_at"],
            channel_token,
        )
        logger.info("Registered webhook channel for calendar %s, expires %s", calendar_id, result["expires_at"])
    except GoogleAPIError as e:
        if "pushNotSupportedForRequestedResource" in e.message:
            logger.info("Webhook not supported for calendar %s (read-only/public calendar)", calendar_id)
        else:
            logger.warning("Failed to register webhook channel for calendar %s: %s", calendar_id, e.message)
    except Exception:
        logger.warning("Failed to register webhook channel for calendar %s", calendar_id, exc_info=True)


async def sync_events(
    http: httpx.AsyncClient,
    supabase: Client,
    user_id: str,
    calendar_id: str,
    events_queue: asyncio.Queue | None = None,
    semaphore: asyncio.Semaphore | None = None,
) -> None:
    if semaphore:
        await semaphore.acquire()
    try:
        await _sync_calendar(http, supabase, user_id, calendar_id, events_queue)
    except Exception:
        logger.exception("Sync failed for calendar %s", calendar_id)
        if events_queue:
            await events_queue.put({
                "type": "error",
                "calendar_id": calendar_id,
                "code": "500",
                "message": "Unexpected sync error",
                "retryable": True,
            })
            await events_queue.put({"type": "calendar_done", "calendar_id": calendar_id})
    finally:
        if semaphore:
            semaphore.release()
