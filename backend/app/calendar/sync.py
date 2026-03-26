import asyncio
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from supabase import Client

from app.calendar.constants import WEBHOOK_CHANNEL_BUFFER_HOURS
from app.calendar.google_client import GoogleAPIClient
from app.calendar.helpers import (
    GoogleAPIError,
    get_google_calendar,
    transform_events,
)
from app.config import get_settings

logger = logging.getLogger(__name__)


class Sync:
    def __init__(self, supabase: Client, http: httpx.AsyncClient, user_id: str, cal_id: str, events_queue: asyncio.Queue | None = None):
        self.supabase = supabase
        self.http = http
        self.user_id = user_id
        self.cal_id = cal_id
        self.events_queue = events_queue

    async def run(self):
        try:
            calendar = await asyncio.to_thread(get_google_calendar, self.supabase, self.cal_id, self.user_id)
            if not calendar:
                await self._emit({"type": "error", "calendar_id": self.cal_id, "code": "404", "message": "Calendar not found", "retryable": False})
                return

            self.calendar = calendar
            self.google_client = GoogleAPIClient(self.supabase, self.http, self.user_id, calendar["google_account_id"])

            sync_state, self.contacts = await asyncio.gather(
                asyncio.to_thread(self._get_sync_state),
                self._sync_contacts(),
            )
            sync_token = sync_state["sync_token"] if sync_state else None
            page_token = sync_state["next_page_token"] if sync_state else None

            await self._sync_calendar(sync_token, page_token)
            await self._refresh_webhook()
        except Exception as e:
            logger.exception("Sync failed for calendar %s", self.cal_id)
            await self._emit({"type": "error", "calendar_id": self.cal_id, "code": "500", "message": str(e), "retryable": False})
        finally:
            await self._emit({"type": "calendar_done", "calendar_id": self.cal_id})

    async def _sync_contacts(self):
        people = await self.google_client.fetch_contacts()
        contacts = {}

        for person in people:
            emails = person.get("emailAddresses")
            names = person.get("names")
            photos = person.get("photos")
            if not emails or not names:
                continue
            email = emails[0]["value"].lower()
            if email in contacts:
                continue
            photo_url = next((p["url"] for p in photos if not p.get("default")), None) if photos else None

            contacts[email] = {
                "display_name": names[0].get("displayName"),
                "photo_url": photo_url,
            }

        account_id = self.calendar["google_account_id"]
        rows = [
            {"google_account_id": account_id, "email": email, **entry}
            for email, entry in contacts.items()
        ]

        for i in range(0, len(rows), 500):
            batch = rows[i:i+500]
            await asyncio.to_thread(
                lambda b: self.supabase.table("contact_directory").upsert(b, on_conflict="google_account_id,email").execute(),
                batch,
            )

        return contacts

    async def _sync_calendar(self, sync_token: str | None, page_token: str | None):
        calendar_id = self.calendar["id"]
        is_retry = False

        while True:
            current_page_token = None
            upsert_tasks = []
            try:
                async for page in self.google_client.fetch_events(
                    self.calendar["google_calendar_id"],
                    page_token=page_token,
                    sync_token=sync_token if not page_token else None,
                ):
                    current_page_token = page.get("next_page_token")
                    transformed = transform_events(
                        page["items"], calendar_id,
                        self.calendar["google_account_id"], self.calendar.get("color"),
                    )
                    self._apply_display_names(transformed)
                    if transformed:
                        upsert_tasks.append(asyncio.create_task(self._save_events(transformed)))
                    await self._emit({"type": "events", "calendar_id": calendar_id, "events": transformed})

                    if not current_page_token and page.get("next_sync_token"):
                        if upsert_tasks:
                            await asyncio.gather(*upsert_tasks)
                        self._save_sync_state(calendar_id, page["next_sync_token"])
                        await self._emit({"type": "sync_token", "calendar_id": calendar_id})

            except GoogleAPIError as e:
                for task in upsert_tasks:
                    if not task.done():
                        task.cancel()
                if upsert_tasks:
                    await asyncio.gather(*upsert_tasks, return_exceptions=True)

                if e.status_code == 410 and not is_retry:
                    self._clear_sync_state(calendar_id)
                    sync_token = None
                    page_token = None
                    is_retry = True
                    continue
                if page_token and not is_retry:
                    page_token = None
                    is_retry = True
                    continue
                if current_page_token and sync_token:
                    self._save_sync_state(calendar_id, sync_token, current_page_token)
                await self._emit({
                    "type": "error", "calendar_id": calendar_id,
                    "code": str(e.status_code), "message": e.message, "retryable": e.retryable,
                })
            break

    def _apply_display_names(self, events: list[dict]):
        for event in events:
            for attendee in event.get("attendees") or []:
                if not attendee.get("displayName") and attendee.get("email"):
                    entry = self.contacts.get(attendee["email"].lower())
                    if entry:
                        attendee["displayName"] = entry["display_name"]
            organizer = event.get("organizer")
            if organizer and not organizer.get("displayName") and organizer.get("email"):
                entry = self.contacts.get(organizer["email"].lower())
                if entry:
                    organizer["displayName"] = entry["display_name"]

    async def _refresh_webhook(self):
        settings = get_settings()
        if not settings.WEBHOOK_BASE_URL:
            return

        calendar_id = self.calendar["id"]
        sync_state = await asyncio.to_thread(self._get_sync_state)

        expires_at = sync_state.get("webhook_expires_at") if sync_state else None
        if expires_at:
            parsed = datetime.fromisoformat(str(expires_at))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            if parsed > datetime.now(timezone.utc) + timedelta(hours=WEBHOOK_CHANNEL_BUFFER_HOURS):
                return

        try:
            channel_id = str(uuid.uuid4())
            channel_token = secrets.token_urlsafe(32)
            webhook_url = f"{settings.WEBHOOK_BASE_URL}/calendar/webhook"

            result = await self.google_client.create_watch_channel(
                self.calendar["google_calendar_id"],
                webhook_url,
                channel_id,
                channel_token,
            )

            self.supabase.table("calendar_sync_state").upsert({
                    "google_calendar_id": calendar_id,
                    "webhook_channel_id": channel_id,
                    "webhook_resource_id": result["resource_id"],
                    "webhook_expires_at": result["expires_at"].isoformat(),
                    "webhook_channel_token": channel_token,
                }, on_conflict="google_calendar_id",
            ).execute()

        except GoogleAPIError as e:
            logger.warning("Webhook registration failed for calendar %s: %s", calendar_id, e.message)

    def _clear_sync_state(self, calendar_id: str):
        self.supabase.table("calendar_sync_state").update({"sync_token": None, "next_page_token": None}).eq("google_calendar_id", calendar_id).execute()

    def _get_sync_state(self) -> dict | None:
        result = self.supabase.table("calendar_sync_state").select("sync_token, next_page_token, webhook_expires_at").eq("google_calendar_id", self.calendar["id"]).limit(1).execute()
        return result.data[0] if result.data else None

    def _save_sync_state(self, calendar_id: str, sync_token: str | None, page_token: str | None = None):
        self.supabase.table("calendar_sync_state").upsert({
            "google_calendar_id": calendar_id,
            "sync_token": sync_token,
            "next_page_token": page_token,
            "last_sync_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="google_calendar_id").execute()

    async def _save_events(self, events: list[dict]):
        for i in range(0, len(events), 500):
            batch = events[i:i + 500]
            await asyncio.to_thread(
                lambda b: self.supabase.table("events")
                .upsert(b, on_conflict="googleCalendarId,googleEventId,source")
                .execute(),
                batch,
            )

    async def _emit(self, data: dict) -> None:
        if self.events_queue:
            await self.events_queue.put(data)
