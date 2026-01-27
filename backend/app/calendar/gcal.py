import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncGenerator
from urllib.parse import quote

import httpx
from supabase import Client

from app.calendar.constants import GoogleCalendarConfig
from app.calendar.db import (
    get_decrypted_tokens,
    get_google_account,
    mark_needs_reauth,
    update_google_account_tokens,
)
from app.calendar.helpers import (
    GoogleAPIError,
    extract_error_reason,
    get_refresh_lock,
    parse_expires_at,
    proximity_sort_events,
    token_needs_refresh,
    transform_events,
    with_retry,
)
from app.config import get_settings
from app.core.encryption import Encryption

logger = logging.getLogger(__name__)
settings = get_settings()


def handle_google_response(supabase: Client, response: httpx.Response, google_account_id: str):
    if response.status_code == 200:
        return response.json()

    status = response.status_code

    if status == 401:
        mark_needs_reauth(supabase, google_account_id)
        raise GoogleAPIError(401, "Token revoked, needs reauth")

    if status == 403:
        error_reason = extract_error_reason(response)
        if error_reason in GoogleCalendarConfig.QUOTA_ERROR_REASONS:
            raise GoogleAPIError(403, f"Quota exceeded: {error_reason}", retryable=True)
        raise GoogleAPIError(403, "Access forbidden")

    if status == 429:
        raise GoogleAPIError(429, "Rate limited", retryable=True)

    if status == 410:
        raise GoogleAPIError(410, "Sync token expired")

    if status >= 500:
        raise GoogleAPIError(status, "Google server error", retryable=True)

    raise GoogleAPIError(status, "Request failed")


async def get_valid_access_token(http: httpx.AsyncClient, supabase: Client, user_id: str, google_account_id: str) -> str:
    tokens = get_decrypted_tokens(supabase, user_id, google_account_id)
    expires_at = parse_expires_at(tokens["expires_at"])

    if not token_needs_refresh(expires_at):
        return tokens["access_token"]

    lock = await get_refresh_lock(google_account_id)
    async with lock:
        tokens = get_decrypted_tokens(supabase, user_id, google_account_id)
        expires_at = parse_expires_at(tokens["expires_at"])
        if token_needs_refresh(expires_at):
            return await refresh_access_token(http, supabase, user_id, google_account_id, tokens["refresh_token"])
        return tokens["access_token"]


async def refresh_access_token(http: httpx.AsyncClient, supabase: Client, user_id: str, google_account_id: str, refresh_token: str) -> str:
    response = await http.post(
        GoogleCalendarConfig.OAUTH_TOKEN_URL,
        data={
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
    )

    if response.status_code != 200:
        mark_needs_reauth(supabase, google_account_id)
        raise GoogleAPIError(401, "Failed to refresh token")

    token_data = response.json()
    access_token = token_data["access_token"]
    expires_in = token_data.get("expires_in", 3600)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

    update_google_account_tokens(
        supabase,
        google_account_id,
        Encryption.encrypt(access_token, user_id),
        expires_at.isoformat(),
    )

    return access_token


async def list_calendars(http: httpx.AsyncClient, supabase: Client, user_id: str, google_account_id: str) -> list[dict]:
    access_token = await get_valid_access_token(http, supabase, user_id, google_account_id)

    async def _fetch():
        response = await http.get(
            f"{GoogleCalendarConfig.API_BASE_URL}/users/me/calendarList",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        return handle_google_response(supabase, response, google_account_id)

    async def _request():
        nonlocal access_token
        try:
            return await _fetch()
        except GoogleAPIError as e:
            if e.status_code == 401:
                access_token = await get_valid_access_token(http, supabase, user_id, google_account_id)
                return await _fetch()
            raise

    response = await with_retry(_request, google_account_id)
    items = response.get("items", [])

    account = get_google_account(supabase, google_account_id)

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
        supabase
        .table("google_calendars")
        .upsert(calendars_to_upsert, on_conflict="google_account_id,google_calendar_id")
        .execute()
    )

    rows: list[dict[str, Any]] = result.data or []
    account = account or {}
    return [
        {
            "id": row["id"],
            "google_calendar_id": row["google_calendar_id"],
            "name": row["name"],
            "color": row["color"],
            "is_primary": row["is_primary"],
            "google_account_id": google_account_id,
            "account_email": account.get("email", ""),
            "account_name": account.get("name", ""),
            "needs_reauth": account.get("needs_reauth", False),
        }
        for row in rows
    ]


async def get_events(
    http: httpx.AsyncClient,
    supabase: Client,
    user_id: str,
    google_account_id: str,
    google_calendar_id: str,
    google_calendar_external_id: str,
    sync_token: str | None = None,
    calendar_color: str | None = None,
) -> AsyncGenerator[dict, None]:
    access_token = await get_valid_access_token(http, supabase, user_id, google_account_id)
    encoded_calendar_id = quote(google_calendar_external_id, safe="")
    page_token = None

    while True:
        params: dict[str, str | int] = {"singleEvents": "false", "showDeleted": "true", "maxResults": 250}
        if page_token:
            params["pageToken"] = page_token
        if sync_token:
            params["syncToken"] = sync_token

        async def _fetch_page(token: str) -> dict[str, Any]:
            response = await http.get(
                f"{GoogleCalendarConfig.API_BASE_URL}/calendars/{encoded_calendar_id}/events",
                headers={"Authorization": f"Bearer {token}"},
                params=params,
            )
            return handle_google_response(supabase, response, google_account_id)

        async def _request() -> dict[str, Any]:
            nonlocal access_token
            try:
                return await _fetch_page(access_token)
            except GoogleAPIError as e:
                if e.status_code == 401:
                    access_token = await get_valid_access_token(http, supabase, user_id, google_account_id)
                    return await _fetch_page(access_token)
                raise

        response: dict[str, Any] = await with_retry(_request, google_account_id)
        items = response.get("items", [])
        transformed = await asyncio.to_thread(
            transform_events,
            items,
            google_calendar_id,
            google_account_id,
            user_id,
            calendar_color,
        )
        sorted_events = proximity_sort_events(transformed)
        yield {"type": "events", "events": sorted_events}

        page_token = response.get("nextPageToken")
        if not page_token:
            yield {"type": "sync_token", "token": response.get("nextSyncToken")}
            return
