import asyncio
import logging
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from enum import Enum
from urllib.parse import quote

import httpx
from supabase import Client

from app.calendar.constants import GoogleCalendarConfig
from app.calendar.helpers import GoogleAPIError
from app.config import get_settings
from app.models.event import Event, EventPatch

logger = logging.getLogger(__name__)
settings = get_settings()

MAX_CACHED_ACCOUNTS = 100
CACHE_CLEANUP_THRESHOLD = 150

_account_semaphores: OrderedDict[str, asyncio.Semaphore] = OrderedDict()
_refresh_locks: OrderedDict[str, asyncio.Lock] = OrderedDict()
_dict_lock: asyncio.Lock = asyncio.Lock()


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
        check_active=lambda sem: sem._value < GoogleCalendarConfig.MAX_CONCURRENT_PER_ACCOUNT,
    )


async def get_refresh_lock(google_account_id: str) -> asyncio.Lock:
    return await _get_cached(
        _refresh_locks, google_account_id,
        lambda: asyncio.Lock(),
        check_active=lambda lock: lock.locked(),
    )


def get_tokens(supabase: Client, user_id: str, google_account_id: str) -> dict[str, str]:
    row = (
        supabase
        .table("google_account_tokens")
        .select("access_token, refresh_token, expires_at, google_accounts!inner(user_id)")
        .eq("google_account_id", google_account_id)
        .eq("google_accounts.user_id", user_id)
        .maybe_single()
        .execute()
        .data
    )
    if row is not None:
        return {
            "access_token": str(row["access_token"]),
            "refresh_token": row["refresh_token"],
            "expires_at": str(row["expires_at"]),
        }
    raise ValueError("Google account tokens not found")


class APIBaseURL(Enum):
    CALENDAR = "https://www.googleapis.com/calendar/v3"
    PEOPLE = "https://people.googleapis.com/v1"
    CLOUD_IDENTITY = "https://cloudidentity.googleapis.com/v1"
    OAUTH = "https://oauth2.googleapis.com"


class GoogleAPIClient:
    def __init__(self, supabase: Client, http: httpx.AsyncClient, user_id: str, google_account_id: str):
        self.supabase = supabase
        self.http = http
        self.user_id = user_id
        self.google_account_id = google_account_id

    async def _request(self, method: str, base_url: APIBaseURL, endpoint: str, params: dict | None = None, json: dict | None = None):
        semaphore = await get_account_semaphore(self.google_account_id)
        had_401 = False
        last_error: GoogleAPIError | None = None
        async with semaphore:
            for attempt in range(GoogleCalendarConfig.MAX_RETRIES):
                token = await self._get_valid_access_token()
                headers = {"Authorization": f"Bearer {token}"}

                try:
                    response = await self.http.request(method, base_url.value + endpoint, params=params, json=json, headers=headers)
                except httpx.TimeoutException:
                    last_error = GoogleAPIError(504, "Request timed out")
                    await asyncio.sleep(2 ** attempt)
                    continue
                except httpx.NetworkError:
                    last_error = GoogleAPIError(503, "Network error")
                    await asyncio.sleep(2 ** attempt)
                    continue

                status = response.status_code

                if 200 <= status < 300:
                    return {} if status == 204 else response.json()

                if status == 401:
                    if had_401:
                        self._clear_refresh_token()
                        raise GoogleAPIError(401, "Token expired or revoked")
                    tokens = get_tokens(self.supabase, self.user_id, self.google_account_id)
                    await self._refresh_access_token(tokens["refresh_token"])
                    had_401 = True
                    continue

                if status == 403:
                    errors = response.json().get("error", {}).get("errors", [])
                    reason = errors[0].get("reason") if errors else None
                    if reason in GoogleCalendarConfig.QUOTA_ERROR_REASONS:
                        last_error = GoogleAPIError(403, f"Quota exceeded: {reason}")
                        await asyncio.sleep(2 ** attempt)
                        continue
                    raise GoogleAPIError(403, f"Access forbidden: {reason}" if reason else "Access forbidden")

                if status == 410:
                    raise GoogleAPIError(410, "Sync token expired")

                if status == 429:
                    last_error = GoogleAPIError(429, "Rate limited")
                    await asyncio.sleep(2 ** attempt)
                    continue

                if status >= 500:
                    last_error = GoogleAPIError(status, "Google server error")
                    await asyncio.sleep(2 ** attempt)
                    continue

                raise GoogleAPIError(status, response.text[:200])

            assert last_error is not None
            raise last_error

    async def fetch_calendars(self):
        return await self._request("GET", APIBaseURL.CALENDAR, "/users/me/calendarList")

    async def create_event(self, calendar_id: str, event: Event):
        encoded = quote(calendar_id, safe="")
        return await self._request("POST", APIBaseURL.CALENDAR, f"/calendars/{encoded}/events", json=event.model_dump(exclude_none=True, exclude={"color", "calendarId", "completed"}))

    async def fetch_events(self, calendar_id: str, page_token: str | None = None, sync_token: str | None = None):
        encoded = quote(calendar_id, safe="")
        params = {
            "singleEvents": "false",
            "showDeleted": "true",
            "maxResults": 1000,
        }
        while True:
            if page_token:
                params["pageToken"] = page_token
            elif sync_token:
                params["syncToken"] = sync_token

            response = await self._request("GET", APIBaseURL.CALENDAR, f"/calendars/{encoded}/events", params=params)
            page_token = response.get("nextPageToken")

            yield {
                "items": response.get("items", []),
                "next_page_token": page_token,
                "next_sync_token": response.get("nextSyncToken") if not page_token else None
            }

            if not page_token:
                break

    async def edit_event(self, calendar_id: str, event_id: str, event: EventPatch):
        body = event.model_dump(exclude_none=True, exclude={"color", "calendarId", "completed"})
        for field in ("start", "end"):
            if field in body:
                if "dateTime" in body[field]:
                    body[field]["date"] = None
                elif "date" in body[field]:
                    body[field]["dateTime"] = None
        encoded = quote(calendar_id, safe="")
        return await self._request("PATCH", APIBaseURL.CALENDAR, f"/calendars/{encoded}/events/{quote(event_id, safe='')}", json=body)

    async def delete_event(self, calendar_id: str, event_id: str):
        encoded_calendar_id = quote(calendar_id, safe="")
        await self._request("DELETE", APIBaseURL.CALENDAR, f"/calendars/{encoded_calendar_id}/events/{quote(event_id, safe='')}")

    async def fetch_contacts(self):
        contacts = []
        async def get_saved_contacts():
            params = {
                "resourceName": "people/me",
                "personFields": "names,emailAddresses,photos",
                "pageSize": "1000",
            }
            while True:
                response = await self._request("GET", APIBaseURL.PEOPLE, "/people/me/connections", params=params)
                contacts.extend(response.get("connections", []))
                page_token = response.get("nextPageToken")
                if not page_token:
                    break
                params["pageToken"] = page_token

        async def get_other_contacts():
            params = {
                "readMask": "names,emailAddresses,photos",
                "pageSize": "1000",
            }
            while True:
                response = await self._request("GET", APIBaseURL.PEOPLE, "/otherContacts", params=params)
                contacts.extend(response.get("otherContacts", []))
                page_token = response.get("nextPageToken")
                if not page_token:
                    break
                params["pageToken"] = page_token

        await asyncio.gather(get_saved_contacts(), get_other_contacts())
        return contacts

    async def search_workspace(self, query: str):
        params = {
            "query": query,
            "readMask": "names,emailAddresses,photos",
            "sources": "DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE",
            "pageSize": "500",
        }
        response = await self._request("GET", APIBaseURL.PEOPLE, "/people:searchDirectoryPeople", params=params)
        return response.get("people", [])

    async def list_group_members(self, group_email: str):
        response = await self._request("GET", APIBaseURL.CLOUD_IDENTITY, "/groups:lookup", params={"groupKey.id": group_email})
        group_name = response["name"]

        members = []
        page_token = None
        while True:
            params = {"pageSize": "200"}
            if page_token:
                params["pageToken"] = page_token
            response = await self._request("GET", APIBaseURL.CLOUD_IDENTITY, f"/{group_name}/memberships", params=params)
            for membership in response["memberships"]:
                key = membership["preferredMemberKey"]
                roles = membership["roles"]
                members.append({
                    "email": key["id"],
                    "role": roles[0]["name"] if roles else "MEMBER",
                    "type": membership["type"],
                })
            page_token = response.get("nextPageToken")
            if not page_token:
                break

        return members

    async def create_watch_channel(self, calendar_external_id: str, webhook_url: str, channel_id: str, channel_token: str):
        encoded = quote(calendar_external_id, safe="")
        response = await self._request(
            "POST",
            APIBaseURL.CALENDAR,
            f"/calendars/{encoded}/events/watch",
            json={
                "id": channel_id,
                "type": "web_hook",
                "address": webhook_url,
                "token": channel_token,
            },
        )
        expiration_ms = int(response["expiration"])
        return {
            "resource_id": response["resourceId"],
            "expires_at": datetime.fromtimestamp(expiration_ms / 1000, tz=timezone.utc),
        }

    def _clear_refresh_token(self):
        self.supabase.table("google_account_tokens").update({"refresh_token": None}).eq("google_account_id", self.google_account_id).execute()

    async def _get_valid_access_token(self):
        tokens = get_tokens(self.supabase, self.user_id, self.google_account_id)
        expires_at = datetime.fromisoformat(tokens["expires_at"].replace("Z", "+00:00"))

        if expires_at >= datetime.now(timezone.utc) + GoogleCalendarConfig.TOKEN_REFRESH_BUFFER:
            return tokens["access_token"]

        lock = await get_refresh_lock(self.google_account_id)
        async with lock:
            tokens = get_tokens(self.supabase, self.user_id, self.google_account_id)
            expires_at = datetime.fromisoformat(tokens["expires_at"].replace("Z", "+00:00"))
            if expires_at < datetime.now(timezone.utc) + GoogleCalendarConfig.TOKEN_REFRESH_BUFFER:
                if not tokens["refresh_token"]:
                    self._clear_refresh_token()
                    raise GoogleAPIError(401, "Missing refresh token")
                return await self._refresh_access_token(tokens["refresh_token"])
            return tokens["access_token"]

    async def _refresh_access_token(self, refresh_token: str):
        data = {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
        response = await self.http.post(APIBaseURL.OAUTH.value + "/token", data=data)

        if response.status_code != 200:
            self._clear_refresh_token()
            raise GoogleAPIError(401, "Failed to refresh token")

        token_data = response.json()
        access_token = token_data["access_token"]
        new_refresh_token = token_data.get("refresh_token")
        expires_in = token_data.get("expires_in", 3600)
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
        
        self.supabase.table("google_account_tokens").update({
            "access_token": access_token,
            "expires_at": expires_at.isoformat(),
            **({"refresh_token": new_refresh_token} if new_refresh_token else {}),
        }).eq("google_account_id", self.google_account_id).execute()

        return access_token


async def proxy_photo(http: httpx.AsyncClient, url: str) -> tuple[bytes, str]:
    response = await http.get(url, follow_redirects=False)
    if response.status_code != 200:
        raise GoogleAPIError(response.status_code, "Photo fetch failed")
    return response.content, response.headers.get("content-type", "image/jpeg")
