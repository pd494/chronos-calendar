import asyncio
import logging

from app.calendar.constants import WEBHOOK_DEBOUNCE_SECONDS
from app.calendar.sync import sync_events
from app.core.dependencies import get_http_client
from app.core.supabase import get_supabase_client

logger = logging.getLogger(__name__)

_pending_syncs: dict[str, asyncio.Task] = {}
_syncing: dict[str, bool] = {}
_queued_sync: dict[str, tuple[str, str]] = {}


def handle_webhook_notification(calendar_id: str, user_id: str):
    if _syncing.get(calendar_id):
        _queued_sync[calendar_id] = (calendar_id, user_id)
        return

    existing = _pending_syncs.get(calendar_id)
    if existing:
        existing.cancel()

    async def _delayed_sync():
        try:
            await asyncio.sleep(WEBHOOK_DEBOUNCE_SECONDS)
        except asyncio.CancelledError:
            return

        _syncing[calendar_id] = True
        try:
            supabase = get_supabase_client()
            http = await get_http_client()
            await sync_events(http, supabase, user_id, calendar_id)
        except Exception:
            logger.exception("Background sync failed for calendar %s", calendar_id)
        finally:
            _syncing.pop(calendar_id, None)
            queued = _queued_sync.pop(calendar_id, None)
            if queued:
                handle_webhook_notification(*queued)

    task = asyncio.create_task(_delayed_sync())
    _pending_syncs[calendar_id] = task

    def _cleanup(t: asyncio.Task):
        if _pending_syncs.get(calendar_id) is t:
            _pending_syncs.pop(calendar_id, None)

    task.add_done_callback(_cleanup)
