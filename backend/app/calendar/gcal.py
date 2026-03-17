import logging
from datetime import datetime, timedelta, timezone
from typing import AsyncGenerator
from urllib.parse import quote

import httpx
from supabase import Client

from app.calendar.constants import GoogleCalendarConfig
from app.calendar.db import (
    get_decrypted_tokens,
    mark_needs_reauth,
    update_google_account_tokens,
)
from app.calendar.helpers import (
    GoogleAPIError,
    extract_error_reason,
    get_refresh_lock,
    parse_expires_at,
    token_needs_refresh,
    with_retry,
)
from app.config import get_settings
from app.core.encryption import Encryption
from app.models.event import Event

logger = logging.getLogger(__name__)
settings = get_settings()


def handle_google_response(response: httpx.Response):
    """Parse Google API response, raising GoogleAPIError on non-2xx status.

    response: raw httpx response from a Google API call.
    """
    status = response.status_code
    if 200 <= status < 300:
        if status == 204:
            return {}
        return response.json()

    if status == 401:
        raise GoogleAPIError(401, "Token expired or revoked")

    if status == 403:
        error_reason = extract_error_reason(response)
        if error_reason in GoogleCalendarConfig.QUOTA_ERROR_REASONS:
            raise GoogleAPIError(403, f"Quota exceeded: {error_reason}", retryable=True)
        raise GoogleAPIError(403, f"Access forbidden: {error_reason}" if error_reason else "Access forbidden")

    if status == 429:
        raise GoogleAPIError(429, "Rate limited", retryable=True)

    if status == 410:
        raise GoogleAPIError(410, "Sync token expired")

    if status >= 500:
        raise GoogleAPIError(status, "Google server error", retryable=True)

    try:
        payload = response.json()
        error_obj = payload.get("error", {})
        error_message = error_obj.get("message", "")
        error_errors = error_obj.get("errors", [])
        logger.error(
            "Google API error: status=%s message=%s errors=%s",
            status, error_message, error_errors,
        )
        error_detail = error_message or extract_error_reason(response)
    except Exception:
        error_detail = response.text[:500]
        logger.error("Google API error: status=%s raw=%s", status, error_detail)
    raise GoogleAPIError(status, f"Request failed: {error_detail}")


async def get_valid_access_token(http: httpx.AsyncClient, supabase: Client, user_id: str, google_account_id: str) -> str:
    """Return a valid access token, refreshing if expired.

    http: async HTTP client for making refresh requests.
    supabase: DB client for reading/writing tokens.
    user_id: owner of the Google account (for decryption).
    google_account_id: which Google account's tokens to use.
    """
    tokens = get_decrypted_tokens(supabase, user_id, google_account_id)
    expires_at = parse_expires_at(tokens["expires_at"])

    if not token_needs_refresh(expires_at):
        return tokens["access_token"]

    lock = await get_refresh_lock(google_account_id)
    async with lock:
        tokens = get_decrypted_tokens(supabase, user_id, google_account_id)
        expires_at = parse_expires_at(tokens["expires_at"])
        if token_needs_refresh(expires_at):
            if not tokens["refresh_token"]:
                mark_needs_reauth(supabase, google_account_id)
                raise GoogleAPIError(401, "Missing refresh token")
            return await refresh_access_token(http, supabase, user_id, google_account_id, tokens["refresh_token"])
        return tokens["access_token"]



async def refresh_access_token(http: httpx.AsyncClient, supabase: Client, user_id: str, google_account_id: str, refresh_token: str) -> str:
    """Exchange a refresh token for a new access token and persist it.

    http: async HTTP client for the OAuth token request.
    supabase: DB client for persisting the new tokens.
    user_id: owner of the Google account (for encryption).
    google_account_id: which account to update.
    refresh_token: the decrypted OAuth refresh token.
    """
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
    new_refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in", 3600)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

    update_google_account_tokens(
        supabase,
        google_account_id,
        Encryption.encrypt(access_token, user_id),
        expires_at.isoformat(),
        refresh_token=Encryption.encrypt(new_refresh_token, user_id) if new_refresh_token else None,
    )

    return access_token


async def _authed_request(
    fetch_fn,
    http: httpx.AsyncClient,
    supabase: Client,
    user_id: str,
    google_account_id: str,
):
    """Call fetch_fn with a valid token, retrying once on 401.

    fetch_fn: async callable(token) that makes the actual API request.
    http: async HTTP client (passed to token refresh if needed).
    supabase: DB client (passed to token refresh if needed).
    user_id: owner of the Google account.
    google_account_id: which account's token to use.
    """
    token = await get_valid_access_token(http, supabase, user_id, google_account_id)
    try:
        return await fetch_fn(token)
    except GoogleAPIError as e:
        if e.status_code != 401:
            raise
        token = await get_valid_access_token(http, supabase, user_id, google_account_id)
        return await fetch_fn(token)


async def list_calendars(http: httpx.AsyncClient, supabase: Client, user_id: str, google_account_id: str) -> list[dict]:
    """Fetch all calendars from Google. Returns raw Google API items.

    http: async HTTP client for the Google API call.
    supabase: DB client for token management.
    user_id: owner of the Google account.
    google_account_id: which Google account to list calendars for.
    """
    async def _fetch(token: str):
        response = await http.get(
            f"{GoogleCalendarConfig.API_BASE_URL}/users/me/calendarList",
            headers={"Authorization": f"Bearer {token}"},
        )
        return handle_google_response(response)

    response = await with_retry(
        lambda: _authed_request(_fetch, http, supabase, user_id, google_account_id),
        google_account_id,
    )
    return response.get("items", [])


async def create_event(
    http: httpx.AsyncClient,
    supabase: Client,
    user_id: str,
    google_account_id: str,
    google_calendar_id: str,
    event_data: Event,
):
    encoded_calendar_id = quote(google_calendar_id, safe="")
    async def _post(token: str):
        response = await http.post(
            f"{GoogleCalendarConfig.API_BASE_URL}/calendars/{encoded_calendar_id}/events",
            headers={"Authorization": f"Bearer {token}"},
            json=event_data.model_dump(exclude_none=True, exclude={"color", "calendarId", "completed"})
        )
        return handle_google_response(response)
    
    response = await with_retry(
        lambda: _authed_request(_post, http, supabase, user_id, google_account_id),
        google_account_id,
    )
    
    return response


async def patch_event(
    http: httpx.AsyncClient,
    supabase: Client,
    user_id: str,
    google_account_id: str,
    google_calendar_id: str,
    event_id: str,
    event_data: Event,
):
    encoded_calendar_id = quote(google_calendar_id, safe="")
    encoded_event_id = quote(event_id, safe="")
    async def _patch(token: str):
        body = event_data.model_dump(exclude_none=True, exclude={"color", "calendarId", "completed"})
        for field in ("start", "end"):
            if field in body:
                if "dateTime" in body[field]:
                    body[field]["date"] = None
                elif "date" in body[field]:
                    body[field]["dateTime"] = None
        response = await http.patch(
            f"{GoogleCalendarConfig.API_BASE_URL}/calendars/{encoded_calendar_id}/events/{encoded_event_id}",
            headers={"Authorization": f"Bearer {token}"},
            json=body,
        )
        return handle_google_response(response)
    
    response = await with_retry(
        lambda: _authed_request(_patch, http, supabase, user_id, google_account_id),
        google_account_id,
    )
    
    return response


async def delete_event(
    http: httpx.AsyncClient,
    supabase: Client,
    user_id: str,
    google_account_id: str,
    google_calendar_id: str,
    event_id: str,
):
    encoded_calendar_id = quote(google_calendar_id, safe="")
    encoded_event_id = quote(event_id, safe="")
    async def _delete(token: str):
        response = await http.delete(
            f"{GoogleCalendarConfig.API_BASE_URL}/calendars/{encoded_calendar_id}/events/{encoded_event_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        
        return handle_google_response(response)
    
    response = await with_retry(
        lambda: _authed_request(_delete, http, supabase, user_id, google_account_id),
        google_account_id,
    )
    
    return response

async def get_events(
    http: httpx.AsyncClient,
    supabase: Client,
    user_id: str,
    google_account_id: str,
    google_calendar_external_id: str,
    sync_token: str | None = None,
    page_token: str | None = None,
) -> AsyncGenerator[dict, None]:
    """Fetch raw events from Google Calendar, yielding pages.

    http: async HTTP client for Google API calls.
    supabase: DB client for token management.
    user_id: owner of the Google account.
    google_account_id: which Google account to authenticate with.
    google_calendar_external_id: Google's calendar ID (used in the API URL).
    sync_token: incremental sync token from a previous fetch.
    page_token: pagination token for resuming a partial fetch.
    """
    encoded_calendar_id = quote(google_calendar_external_id, safe="")

    while True:
        params: dict[str, str | int] = {"singleEvents": "false", "showDeleted": "true", "maxResults": 2500}
        if page_token:
            params["pageToken"] = page_token
        elif sync_token:
            params["syncToken"] = sync_token

        async def _fetch_page(token: str):
            response = await http.get(
                f"{GoogleCalendarConfig.API_BASE_URL}/calendars/{encoded_calendar_id}/events",
                headers={"Authorization": f"Bearer {token}"},
                params=params,
            )
            return handle_google_response(response)

        response = await with_retry(
            lambda: _authed_request(_fetch_page, http, supabase, user_id, google_account_id),
            google_account_id,
        )
        items = response.get("items", [])
        page_token = response.get("nextPageToken")
        next_sync_token = response.get("nextSyncToken") if not page_token else None
        yield {"items": items, "next_page_token": page_token, "next_sync_token": next_sync_token}
        if not page_token:
            return

async def create_watch_channel(
    http: httpx.AsyncClient,
    access_token: str,
    calendar_external_id: str,
    webhook_url: str,
    channel_id: str,
    channel_token: str,
) -> dict:
    """Register a push notification channel for calendar event changes.

    http: async HTTP client for the Google API call.
    access_token: pre-fetched OAuth token (not auto-refreshed here).
    calendar_external_id: Google's calendar ID to watch.
    webhook_url: URL Google will POST notifications to.
    channel_id: unique ID for this watch channel.
    channel_token: secret token Google includes in notifications for verification.
    """
    encoded_calendar_id = quote(calendar_external_id, safe="")
    response = await http.post(
        f"{GoogleCalendarConfig.API_BASE_URL}/calendars/{encoded_calendar_id}/events/watch",
        headers={"Authorization": f"Bearer {access_token}"},
        json={
            "id": channel_id,
            "type": "web_hook",
            "address": webhook_url,
            "token": channel_token,
        },
    )
    data = handle_google_response(response)
    expiration_ms = int(data["expiration"])
    return {
        "resource_id": data["resourceId"],
        "expires_at": datetime.fromtimestamp(expiration_ms / 1000, tz=timezone.utc),
    }
