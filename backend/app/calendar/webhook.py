import asyncio
import logging

from app.calendar.constants import WEBHOOK_DEBOUNCE_SECONDS
from app.calendar.sync import sync_events
from app.core.dependencies import get_http_client
from app.core.supabase import get_supabase_client

logger = logging.getLogger(__name__)

_pending_syncs: dict[str, asyncio.Task] = {}


def handle_webhook_notification(calendar_id: str, user_id: str, google_account_id: str):
    if calendar_id in _pending_syncs:
        _pending_syncs[calendar_id].cancel()

    async def _delayed_sync():
        await asyncio.sleep(WEBHOOK_DEBOUNCE_SECONDS)
        supabase = get_supabase_client()
        try:
            http = await get_http_client()
            await sync_events(http, supabase, user_id, calendar_id)
        except Exception:
            logger.exception("Background sync failed for calendar %s", calendar_id)

    task = asyncio.create_task(_delayed_sync())
    _pending_syncs[calendar_id] = task
    task.add_done_callback(lambda t: _pending_syncs.pop(calendar_id, None) if _pending_syncs.get(calendar_id) is t else None)
