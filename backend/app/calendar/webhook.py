import asyncio
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from supabase import Client

from app.calendar.constants import WEBHOOK_CHANNEL_BUFFER_HOURS, WEBHOOK_DEBOUNCE_SECONDS
from app.calendar.db import get_calendar_sync_state, save_webhook_registration
from app.calendar.gcal import create_watch_channel, get_valid_access_token
from app.calendar.helpers import GoogleAPIError
from app.config import get_settings
from app.core.dependencies import get_http_client
from app.core.supabase import get_supabase_client

logger = logging.getLogger(__name__)

_queues: dict[str, asyncio.Queue] = {}


WORKER_IDLE_TIMEOUT = 300


async def _sync_worker(calendar_id: str, queue: asyncio.Queue):
    while True:
        try:
            user_id = await asyncio.wait_for(queue.get(), timeout=WORKER_IDLE_TIMEOUT)
        except asyncio.TimeoutError:
            _queues.pop(calendar_id, None)
            return
        await asyncio.sleep(WEBHOOK_DEBOUNCE_SECONDS)
        while not queue.empty():
            user_id = queue.get_nowait()
        try:
            from app.calendar.sync import sync_events

            supabase = get_supabase_client()
            http = await get_http_client()
            await sync_events(http, supabase, user_id, calendar_id)
        except Exception:
            logger.exception("Webhook sync failed for calendar %s", calendar_id)


def handle_webhook_notification(calendar_id: str, user_id: str):    
    if calendar_id not in _queues:
        queue: asyncio.Queue = asyncio.Queue()
        _queues[calendar_id] = queue
        asyncio.create_task(_sync_worker(calendar_id, queue))
    _queues[calendar_id].put_nowait(user_id)


def _channel_still_valid(sync_state: dict | None) -> bool:
    if not sync_state:
        return False
    expires_at = sync_state.get("webhook_expires_at")
    if not expires_at:
        return False
    parsed = datetime.fromisoformat(str(expires_at))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed > datetime.now(timezone.utc) + timedelta(hours=WEBHOOK_CHANNEL_BUFFER_HOURS)


async def refresh_webhook(
    http: httpx.AsyncClient,
    supabase: Client,
    user_id: str,
    calendar_id: str,
    calendar: dict,
) -> None:
    settings = get_settings()
    if not settings.WEBHOOK_BASE_URL:
        return

    sync_state = await asyncio.to_thread(get_calendar_sync_state, supabase, calendar_id)
    if _channel_still_valid(sync_state):
        return

    try:
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
            result["expires_at"].isoformat(),
            channel_token,
        )
    except GoogleAPIError as e:
        if "pushNotSupportedForRequestedResource" in e.message:
            logger.info("Webhook not supported for calendar %s (read-only/public calendar)", calendar_id)
        else:
            logger.warning("Failed to register webhook channel for calendar %s: %s", calendar_id, e.message)
