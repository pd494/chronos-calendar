import asyncio
import json
import logging
import random
from collections import OrderedDict
from datetime import datetime, timezone

import httpx
from cryptography.fernet import InvalidToken
from supabase import Client

from app.calendar.constants import GoogleCalendarConfig
from app.core.encryption import Encryption

logger = logging.getLogger(__name__)

ENCRYPTED_FIELDS = ("summary", "description", "location")
MAX_CACHED_ACCOUNTS = 100
CACHE_CLEANUP_THRESHOLD = 150

_account_semaphores: OrderedDict[str, asyncio.Semaphore] = OrderedDict()
_refresh_locks: OrderedDict[str, asyncio.Lock] = OrderedDict()
_dict_lock: asyncio.Lock = asyncio.Lock()


class GoogleAPIError(Exception):
    def __init__(self, status_code: int, message: str, retryable: bool = False):
        self.status_code = status_code
        self.message = message
        self.retryable = retryable
        super().__init__(f"Google API Error {status_code}: {message}")


def extract_error_reason(response: httpx.Response) -> str:
    try:
        return response.json().get("error", {}).get("errors", [{}])[0].get("reason", "")
    except (ValueError, KeyError, IndexError):
        return ""


def token_needs_refresh(expires_at: datetime) -> bool:
    return expires_at < datetime.now(timezone.utc) + GoogleCalendarConfig.TOKEN_REFRESH_BUFFER


def _is_semaphore_active(sem: asyncio.Semaphore) -> bool:
    return getattr(sem, "_value", 0) < GoogleCalendarConfig.MAX_CONCURRENT_PER_ACCOUNT


def _cleanup_cache(cache: OrderedDict, max_size: int, check_active=None):
    to_remove = []
    for key, obj in cache.items():
        if len(cache) - len(to_remove) <= max_size:
            break
        if check_active and check_active(obj):
            continue
        to_remove.append(key)
    for key in to_remove:
        del cache[key]


async def _get_cached(cache: OrderedDict, key: str, factory, check_active=None):
    async with _dict_lock:
        if key in cache:
            cache.move_to_end(key)
            return cache[key]
        if len(cache) >= CACHE_CLEANUP_THRESHOLD:
            _cleanup_cache(cache, MAX_CACHED_ACCOUNTS, check_active=check_active)
        obj = factory()
        cache[key] = obj
        return obj


async def get_account_semaphore(google_account_id: str) -> asyncio.Semaphore:
    return await _get_cached(
        _account_semaphores, google_account_id,
        lambda: asyncio.Semaphore(GoogleCalendarConfig.MAX_CONCURRENT_PER_ACCOUNT),
        check_active=_is_semaphore_active,
    )


async def get_refresh_lock(google_account_id: str) -> asyncio.Lock:
    return await _get_cached(
        _refresh_locks, google_account_id,
        lambda: asyncio.Lock(),
        check_active=lambda lock: lock.locked(),
    )


async def with_retry(coro_func, google_account_id: str):
    semaphore = await get_account_semaphore(google_account_id)
    last_error = GoogleAPIError(500, "No retries configured")

    async with semaphore:
        for attempt in range(GoogleCalendarConfig.MAX_RETRIES):
            try:
                return await coro_func()
            except GoogleAPIError as e:
                if not e.retryable:
                    raise
                last_error = e
            except httpx.TimeoutException:
                last_error = GoogleAPIError(504, "Request timed out", retryable=True)
            except httpx.NetworkError:
                last_error = GoogleAPIError(503, "Network error", retryable=True)

            delay = GoogleCalendarConfig.BASE_DELAY_SECONDS * (2 ** attempt) * random.uniform(0.5, 1.5)
            logger.warning(
                "Retry attempt=%d/%d account=%s error=%s delay=%.1fs",
                attempt + 1, GoogleCalendarConfig.MAX_RETRIES,
                google_account_id, last_error.message, delay,
            )
            await asyncio.sleep(delay)

        raise last_error


def parse_expires_at(expires_at_str: str) -> datetime:
    return datetime.fromisoformat(expires_at_str.replace("Z", "+00:00"))


def transform_events(
    events: list[dict],
    google_calendar_id: str,
    google_account_id: str,
    calendar_color: str | None = None,
) -> list[dict]:
    transformed = []

    for event in events:
        start = event.get("start") or event.get("originalStartTime") or {}
        end = event.get("end") or {}
        is_all_day = "date" in start

        summary = event.get("summary", "(No title)")
        description = event.get("description")
        location = event.get("location")
        recurrence = event.get("recurrence") or None
        color_id = event.get("colorId") or calendar_color

        transformed.append({
            "google_event_id": event["id"],
            "google_calendar_id": google_calendar_id,
            "google_account_id": google_account_id,
            "source": "google",
            "summary": summary,
            "description": description,
            "location": location,
            "start_datetime": start,
            "end_datetime": end,
            "is_all_day": is_all_day,
            "all_day_date": start.get("date"),
            "recurrence": recurrence,
            "recurring_event_id": event.get("recurringEventId"),
            "original_start_time": event.get("originalStartTime", {}).get("dateTime") or event.get("originalStartTime", {}).get("date"),
            "status": event.get("status", "confirmed"),
            "visibility": event.get("visibility", "default"),
            "transparency": event.get("transparency", "opaque"),
            "attendees": event.get("attendees"),
            "organizer": event.get("organizer"),
            "color_id": color_id,
            "reminders": event.get("reminders"),
            "conference_data": event.get("conferenceData"),
            "html_link": event.get("htmlLink"),
            "ical_uid": event.get("iCalUID"),
            "etag": event.get("etag"),
            "embedding_pending": event.get("status") != "cancelled",
            "created_at": event.get("created"),
            "updated_at": event.get("updated"),
        })

    return transformed


def encrypt_events(events: list[dict], user_id: str) -> list[dict]:
    encrypted = []
    for event in events:
        e = dict(event)
        for field in ENCRYPTED_FIELDS:
            value = e.get(field)
            if value is not None:
                e[field] = Encryption.encrypt(value, user_id)
        encrypted.append(e)
    return encrypted


def map_event_to_frontend(event: dict) -> dict:
    result = {
        "id": event.get("google_event_id"),
        "calendarId": event.get("google_calendar_id"),
        "start": event.get("start_datetime") or {},
        "end": event.get("end_datetime") or {},
        "status": event.get("status", "confirmed"),
        "visibility": event.get("visibility", "default"),
        "transparency": event.get("transparency", "opaque"),
        "recurrence": event.get("recurrence") or None,
        "recurringEventId": event.get("recurring_event_id"),
        "colorId": event.get("color_id"),
        "created": event.get("created_at"),
        "updated": event.get("updated_at"),
        "summary": event.get("summary", ""),
        "description": event.get("description"),
        "location": event.get("location"),
        "attendees": event.get("attendees"),
        "organizer": event.get("organizer"),
        "reminders": event.get("reminders"),
        "conferenceData": event.get("conference_data"),
        "htmlLink": event.get("html_link"),
        "iCalUID": event.get("ical_uid"),
    }

    original_start_time = event.get("original_start_time")
    if original_start_time:
        key = "dateTime" if "T" in original_start_time else "date"
        result["originalStartTime"] = {key: original_start_time}

    return result


def decrypt_event(event: dict, user_id: str, output_format: str = "frontend") -> dict:
    event_id = event.get("google_event_id") or event.get("id")

    def decrypt(value: str | None, field: str, fallback=None) -> str | None:
        if not value:
            return fallback
        try:
            return Encryption.decrypt(value, user_id)
        except (InvalidToken, ValueError, UnicodeDecodeError):
            logger.warning("Failed to decrypt %s for event %s", field, event_id)
            return fallback

    if output_format == "db":
        result = dict(event)
        for field in ENCRYPTED_FIELDS:
            result[field] = decrypt(event.get(field), field)
        result["recurrence"] = event.get("recurrence") or None
        return result

    decrypted = dict(event)
    for field in ENCRYPTED_FIELDS:
        fallback = "" if field == "summary" else None
        decrypted[field] = decrypt(event.get(field), field, fallback)
    return map_event_to_frontend(decrypted)


def format_sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"
