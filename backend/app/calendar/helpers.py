import asyncio
import json
import logging
import random
from collections import OrderedDict
from datetime import datetime, timezone

import httpx
from cryptography.fernet import InvalidToken

from app.calendar.constants import GoogleCalendarConfig
from app.core.encryption import Encryption

logger = logging.getLogger(__name__)

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


async def get_account_semaphore(google_account_id: str) -> asyncio.Semaphore:
    async with _dict_lock:
        if google_account_id in _account_semaphores:
            _account_semaphores.move_to_end(google_account_id)
            return _account_semaphores[google_account_id]

        if len(_account_semaphores) >= CACHE_CLEANUP_THRESHOLD:
            _cleanup_cache(_account_semaphores, MAX_CACHED_ACCOUNTS, check_active=_is_semaphore_active)

        semaphore = asyncio.Semaphore(GoogleCalendarConfig.MAX_CONCURRENT_PER_ACCOUNT)
        _account_semaphores[google_account_id] = semaphore
        return semaphore


async def get_refresh_lock(google_account_id: str) -> asyncio.Lock:
    async with _dict_lock:
        if google_account_id in _refresh_locks:
            _refresh_locks.move_to_end(google_account_id)
            return _refresh_locks[google_account_id]

        if len(_refresh_locks) >= CACHE_CLEANUP_THRESHOLD:
            _cleanup_cache(_refresh_locks, MAX_CACHED_ACCOUNTS, check_active=lambda lock: lock.locked())

        lock = asyncio.Lock()
        _refresh_locks[google_account_id] = lock
        return lock


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


def _get_event_date(event: dict) -> datetime:
    start = event.get("start_datetime", {})
    if "dateTime" in start:
        return datetime.fromisoformat(start["dateTime"].replace("Z", "+00:00"))
    if "date" in start:
        return datetime.strptime(start["date"], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return datetime.max.replace(tzinfo=timezone.utc)


def proximity_sort_events(events: list[dict]) -> list[dict]:
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    def sort_key(event: dict) -> tuple[int, datetime]:
        event_date = _get_event_date(event)
        distance = abs((event_date.replace(hour=0, minute=0, second=0, microsecond=0) - today).days)
        return (distance, event_date)

    return sorted(events, key=sort_key)


def _extract_original_start_time(event: dict) -> str | None:
    original = event.get("originalStartTime", {})
    return original.get("dateTime") or original.get("date")


def _normalize_recurrence(recurrence: list | None) -> list | None:
    return recurrence or None


def transform_events(
    events: list[dict],
    google_calendar_id: str,
    google_account_id: str,
    user_id: str,
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
        recurrence = _normalize_recurrence(event.get("recurrence"))
        color_id = event.get("colorId") or calendar_color

        transformed.append({
            "google_event_id": event["id"],
            "google_calendar_id": google_calendar_id,
            "google_account_id": google_account_id,
            "source": "google",
            "summary": Encryption.encrypt(summary, user_id),
            "description": Encryption.encrypt(description, user_id) if description else None,
            "location": Encryption.encrypt(location, user_id) if location else None,
            "start_datetime": start,
            "end_datetime": end,
            "is_all_day": is_all_day,
            "all_day_date": start.get("date"),
            "recurrence": recurrence,
            "recurring_event_id": event.get("recurringEventId"),
            "original_start_time": _extract_original_start_time(event),
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
        })

    return transformed


def decrypt_event(event: dict, user_id: str, output_format: str = "frontend") -> dict:
    event_id = event.get("google_event_id") or event.get("id")

    def safe_decrypt(value: str | None, field_name: str, fallback=None) -> str | None:
        if not value:
            return fallback
        try:
            return Encryption.decrypt(value, user_id)
        except (InvalidToken, ValueError, UnicodeDecodeError) as e:
            logger.warning("Failed to decrypt %s for event %s: %s", field_name, event_id, e)
            return fallback

    recurrence = _normalize_recurrence(event.get("recurrence"))

    if output_format == "db":
        result = dict(event)
        result["summary"] = safe_decrypt(event.get("summary"), "summary")
        result["description"] = safe_decrypt(event.get("description"), "description")
        result["location"] = safe_decrypt(event.get("location"), "location")
        result["recurrence"] = recurrence
        return result

    result = {
        "id": event.get("google_event_id"),
        "calendarId": event.get("google_calendar_id"),
        "start": event.get("start_datetime") or {},
        "end": event.get("end_datetime") or {},
        "status": event.get("status", "confirmed"),
        "visibility": event.get("visibility", "default"),
        "transparency": event.get("transparency", "opaque"),
        "recurrence": recurrence,
        "recurringEventId": event.get("recurring_event_id"),
        "colorId": event.get("color_id"),
        "created": event.get("created_at"),
        "updated": event.get("updated_at"),
        "summary": safe_decrypt(event.get("summary"), "summary", ""),
        "description": safe_decrypt(event.get("description"), "description"),
        "location": safe_decrypt(event.get("location"), "location"),
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


def format_sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"
