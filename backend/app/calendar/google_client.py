import logging
from datetime import datetime, timezone, timedelta
from urllib.parse import quote
import asyncio
import random

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)
from app.core.supabase import get_supabase_client
from app.core.encryption import encrypt
from app.calendar.helpers import (
    get_google_account_tokens,
    update_google_account_tokens,
    mark_needs_reauth,
    get_decrypted_tokens,
    get_google_account,
)

settings = get_settings()
BUFFER = timedelta(minutes=5)
GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3"
MAX_RETRIES = 5
BASE_DELAY = 1.0
MAX_CONCURRENT_PER_ACCOUNT = 3
REQUEST_TIMEOUT = httpx.Timeout(30.0, connect=10.0)

_account_semaphores: dict[str, asyncio.Semaphore] = {}
_refresh_locks: dict[str, asyncio.Lock] = {}
_http_client: httpx.AsyncClient | None = None


async def get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=REQUEST_TIMEOUT,
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
            headers={"Accept-Encoding": "gzip"}
        )
    return _http_client


async def close_http_client():
    global _http_client
    if _http_client is not None and not _http_client.is_closed:
        await _http_client.aclose()
        _http_client = None


class GoogleAPIError(Exception):
    def __init__(self, status_code: int, message: str, retryable: bool = False):
        self.status_code = status_code
        self.message = message
        self.retryable = retryable
        super().__init__(f"Google API Error {status_code}: {message}")


def handle_google_response(response: httpx.Response, google_account_id: str):
    if response.status_code == 200:
        return response.json()

    if response.status_code == 401:
        mark_needs_reauth(google_account_id)
        raise GoogleAPIError(401, "Token revoked, needs reauth")

    if response.status_code == 403:
        try:
            error_body = response.json()
            error_reason = error_body.get("error", {}).get("errors", [{}])[0].get("reason", "")
            if error_reason in ("userRateLimitExceeded", "rateLimitExceeded", "quotaExceeded"):
                raise GoogleAPIError(403, f"Quota exceeded: {error_reason}", retryable=True)
        except (ValueError, KeyError):
            pass
        raise GoogleAPIError(403, "Access forbidden")

    if response.status_code == 429:
        raise GoogleAPIError(429, "Rate limited", retryable=True)

    if response.status_code == 410:
        raise GoogleAPIError(410, "Sync token expired")

    if response.status_code >= 500:
        raise GoogleAPIError(response.status_code, "Google server error", retryable=True)

    raise GoogleAPIError(response.status_code, response.text)


def get_account_semaphore(google_account_id: str) -> asyncio.Semaphore:
    if google_account_id not in _account_semaphores:
        _account_semaphores[google_account_id] = asyncio.Semaphore(MAX_CONCURRENT_PER_ACCOUNT)
    return _account_semaphores[google_account_id]


def get_refresh_lock(google_account_id: str) -> asyncio.Lock:
    if google_account_id not in _refresh_locks:
        _refresh_locks[google_account_id] = asyncio.Lock()
    return _refresh_locks[google_account_id]


async def with_retry(coro_func, google_account_id: str):
    semaphore = get_account_semaphore(google_account_id)
    last_error = None
    async with semaphore:
        for attempt in range(MAX_RETRIES):
            try:
                return await coro_func()
            except GoogleAPIError as e:
                if not e.retryable:
                    raise
                last_error = e
            except httpx.TimeoutException as e:
                last_error = GoogleAPIError(504, f"Request timed out: {e}", retryable=True)
            except httpx.NetworkError as e:
                last_error = GoogleAPIError(503, f"Network error: {e}", retryable=True)

            delay = BASE_DELAY * (2 ** attempt) + random.uniform(-0.5, 0.5)
            await asyncio.sleep(delay)
        raise last_error


async def get_valid_access_token(user_id: str, google_account_id: str):
    tokens = get_decrypted_tokens(user_id, google_account_id)
    expires_at = datetime.fromisoformat(tokens["expires_at"].replace("Z", "+00:00"))

    if expires_at < datetime.now(timezone.utc) + BUFFER:
        lock = get_refresh_lock(google_account_id)
        async with lock:
            tokens = get_decrypted_tokens(user_id, google_account_id)
            expires_at = datetime.fromisoformat(tokens["expires_at"].replace("Z", "+00:00"))
            if expires_at < datetime.now(timezone.utc) + BUFFER:
                return await refresh_access_token(user_id, google_account_id, tokens["refresh_token"])
            return tokens["access_token"]

    return tokens["access_token"]


async def refresh_access_token(user_id: str, google_account_id: str, refresh_token: str):
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        response = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token"
            }
        )

    if response.status_code != 200:
        mark_needs_reauth(google_account_id)
        raise GoogleAPIError(401, f"Failed to refresh token: {response.text}")

    token_data = response.json()
    new_access_token = token_data["access_token"]
    expires_in = token_data.get("expires_in", 3600)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

    update_google_account_tokens(
        google_account_id,
        encrypt(new_access_token, user_id),
        expires_at.isoformat()
    )

    return new_access_token


async def list_calendars(user_id: str, google_account_id: str) -> list[dict]:
    access_token = await get_valid_access_token(user_id, google_account_id)

    async def _request():
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            response = await client.get(
                f"{GOOGLE_CALENDAR_API}/users/me/calendarList",
                headers={"Authorization": f"Bearer {access_token}"}
            )
        return handle_google_response(response, google_account_id)

    response = await with_retry(_request, google_account_id)
    items = response.get("items", [])

    client = get_supabase_client()
    account = get_google_account(google_account_id)

    calendars_to_upsert = [
        {
            "google_account_id": google_account_id,
            "google_calendar_id": cal["id"],
            "name": cal.get("summary", ""),
            "color": cal.get("backgroundColor"),
            "is_primary": cal.get("primary", False),
            "access_role": cal.get("accessRole", "reader"),
        }
        for cal in items
    ]

    result = (
        client
        .table("google_calendars")
        .upsert(calendars_to_upsert, on_conflict="google_account_id,google_calendar_id")
        .execute()
    )

    stored = [
        {
            "id": row["id"],
            "google_calendar_id": row["google_calendar_id"],
            "name": row["name"],
            "color": row["color"],
            "is_primary": row["is_primary"],
            "google_account_id": google_account_id,
            "account_email": account["email"] if account else "",
            "account_name": account["name"] if account else "",
            "needs_reauth": account["needs_reauth"] if account else False,
        }
        for row in (result.data or [])
    ]

    return stored


async def fetch_events(
    user_id: str,
    google_account_id: str,
    calendar_id: str,
    time_min: str = None,
    time_max: str = None,
    page_token: str = None,
    sync_token: str = None,
    max_results: int = 500,
    fields: str = None,
):
    access_token = await get_valid_access_token(user_id, google_account_id)
    params = {
        "singleEvents": "false",
        "showDeleted": "true",
        "maxResults": max_results,
    }
    if time_min:
        params["timeMin"] = time_min
    if time_max:
        params["timeMax"] = time_max
    if page_token:
        params["pageToken"] = page_token
    if sync_token:
        params["syncToken"] = sync_token
    if fields:
        params["fields"] = fields

    encoded_calendar_id = quote(calendar_id, safe='')
    client = await get_http_client()

    async def _request():
        logger.debug(f"fetch_events: making request to Google API for {encoded_calendar_id}")
        response = await client.get(
            f"{GOOGLE_CALENDAR_API}/calendars/{encoded_calendar_id}/events",
            headers={"Authorization": f"Bearer {access_token}"},
            params=params
        )
        logger.debug(f"fetch_events: got response status={response.status_code}")
        return handle_google_response(response, google_account_id)

    result = await with_retry(_request, google_account_id)
    logger.debug(f"fetch_events: returning {len(result.get('items', []))} items")
    return result


async def fetch_events_for_year(
    user_id: str,
    google_account_id: str,
    calendar_id: str,
    year: int,
):
    
    is_already_synced = get_synced
    """Fetch all events for a year with 1-month boundary overlap."""
    time_min = f"{year - 1}-12-01T00:00:00Z"
    time_max = f"{year + 1}-02-01T00:00:00Z"
    fields = "nextPageToken,items(id,status,summary,start,end,recurrence,recurringEventId,originalStartTime,updated,description,location)"

    all_events = []
    page_token = None

    while True:
        result = await fetch_events(
            user_id=user_id,
            google_account_id=google_account_id,
            calendar_id=calendar_id,
            time_min=time_min,
            time_max=time_max,
            page_token=page_token,
            max_results=500,
            fields=fields,
        )
        all_events.extend(result.get("items", []))
        page_token = result.get("nextPageToken")
        if not page_token:
            break

    return {"events": all_events, "complete": True}
