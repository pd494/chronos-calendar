import asyncio
import logging

import httpx
from supabase import Client

from app.calendar.db import (
    ContactEntry,
    clear_calendar_sync_state,
    get_calendar_sync_state,
    get_google_calendar,
    get_contacts,
    parse_person,
    save_contacts,
    update_calendar_sync_state,
    upsert_events,
)
from app.calendar.gcal import get_events, list_all_contacts
from app.calendar.helpers import (
    GoogleAPIError,
    encrypt_events,
    map_event_to_frontend,
    transform_events,
)
from app.calendar.webhook import refresh_webhook

logger = logging.getLogger(__name__)


async def fetch_directory(
    http: httpx.AsyncClient,
    supabase: Client,
    user_id: str,
    google_account_id: str,
) -> dict[str, ContactEntry]:
    people = await list_all_contacts(http, supabase, user_id, google_account_id)
    contacts: dict[str, ContactEntry] = {}
    for person in people:
        parsed = parse_person(person)
        if parsed and parsed[0] not in contacts:
            contacts[parsed[0]] = ContactEntry(parsed[1] or parsed[0].split("@")[0], parsed[2])
    await asyncio.to_thread(save_contacts, supabase, google_account_id, contacts)
    return contacts


def apply_display_names(events: list[dict], directory: dict[str, ContactEntry]) -> None:
    for event in events:
        for attendee in event.get("attendees") or []:
            if not attendee.get("displayName"):
                email = attendee.get("email", "").lower()
                entry = directory.get(email)
                if entry:
                    attendee["displayName"] = entry.display_name

        organizer = event.get("organizer")
        if organizer and not organizer.get("displayName"):
            email = organizer.get("email", "").lower()
            entry = directory.get(email)
            if entry:
                organizer["displayName"] = entry.display_name


async def add_events(supabase: Client, events: list[dict], user_id: str) -> None:
    if not events:
        return
    encrypted = await asyncio.to_thread(encrypt_events, events, user_id)
    await asyncio.to_thread(upsert_events, supabase, encrypted)


async def _sync_calendar(
    http: httpx.AsyncClient,
    supabase: Client,
    user_id: str,
    calendar_id: str,
    events_queue: asyncio.Queue | None = None,
) -> None:
    calendar = await asyncio.to_thread(get_google_calendar, supabase, calendar_id, user_id)
    if calendar is None:
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
        raise ValueError(f"Calendar not found: {calendar_id}")

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

    directory = await asyncio.to_thread(get_contacts, supabase, calendar["google_account_id"])
    if not directory:
        directory = await fetch_directory(http, supabase, user_id, calendar["google_account_id"])
    bulk_fetched = bool(directory)

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
                calendar["google_calendar_id"],
                sync_token=sync_token if not page_token else None,
                page_token=page_token,
            ):
                current_page_token = page.get("next_page_token")
                transformed = await asyncio.to_thread(
                    transform_events,
                    page["items"],
                    calendar_id,
                    calendar["google_account_id"],
                    calendar.get("color"),
                )
                if transformed and not bulk_fetched:
                    has_unknown = any(
                        (a.get("email", "").lower() not in directory and not a.get("displayName"))
                        for e in transformed
                        for a in (e.get("attendees") or []) + ([e["organizer"]] if e.get("organizer") else [])
                    )
                    if has_unknown:
                        directory = await fetch_directory(http, supabase, user_id, calendar["google_account_id"])
                        bulk_fetched = True
                if transformed:
                    apply_display_names(transformed, directory)
                    upsert_tasks.append(
                        asyncio.create_task(add_events(supabase, transformed, user_id))
                    )
                if events_queue:
                    frontend_events = [map_event_to_frontend(e) for e in transformed]
                    await events_queue.put({
                        "type": "events",
                        "calendar_id": calendar_id,
                        "events": frontend_events,
                    })
                if not current_page_token and page.get("next_sync_token"):
                    if upsert_tasks:
                        await asyncio.gather(*upsert_tasks)
                    await asyncio.to_thread(update_calendar_sync_state, supabase, calendar_id, page["next_sync_token"])
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
                    sync_token, page_token=current_page_token,
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

    await refresh_webhook(http, supabase, user_id, calendar_id, calendar)

    if events_queue:
        await events_queue.put({"type": "calendar_done", "calendar_id": calendar_id})



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
