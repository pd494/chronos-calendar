import asyncio
from typing import Annotated

import httpx
from fastapi import Cookie, Depends, HTTPException, Path
from supabase import Client
from supabase_auth.errors import AuthApiError

from app.calendar.constants import GoogleCalendarConfig
from app.calendar.helpers import get_google_account, get_google_calendar
from app.config import get_settings
from app.core.supabase import get_supabase_client

settings = get_settings()
SessionTokenCookie = Annotated[
    str | None, Cookie(alias=settings.SESSION_COOKIE_NAME)
]
RefreshTokenCookie = Annotated[
    str | None, Cookie(alias=settings.REFRESH_COOKIE_NAME)
]

_http_client: httpx.AsyncClient | None = None
_http_client_lock: asyncio.Lock = asyncio.Lock()


async def get_http_client() -> httpx.AsyncClient:
    global _http_client
    async with _http_client_lock:
        if _http_client is None or _http_client.is_closed:
            _http_client = httpx.AsyncClient(
                timeout=GoogleCalendarConfig.REQUEST_TIMEOUT,
                limits=httpx.Limits(max_connections=200, max_keepalive_connections=50),
                headers={"Accept-Encoding": "gzip"}
            )
        return _http_client


async def close_http_client():
    global _http_client
    async with _http_client_lock:
        if _http_client is not None and not _http_client.is_closed:
            await _http_client.aclose()
            _http_client = None


def get_user(supabase, user_id: str) -> dict | None:
    result = (
        supabase.table("users")
        .select("id, email, name, avatar_url")
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    return result.data


async def get_current_user(
    access_token: SessionTokenCookie = None,
) -> dict:
    if access_token:
        try:
            supabase = get_supabase_client()
            user_response = supabase.auth.get_user(access_token)

            if user_response and user_response.user:
                user = get_user(supabase, user_response.user.id)
                if user:
                    return user
                raise HTTPException(status_code=401, detail="User not found")
            raise HTTPException(status_code=401, detail="Invalid session")
        except AuthApiError:
            raise HTTPException(status_code=401, detail="Authentication failed")
    raise HTTPException(status_code=401, detail="Not authenticated")


def verify_account_access(
    google_account_id: str = Path(...),
    current_user: dict = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client),
) -> dict:
    google_account = get_google_account(supabase, google_account_id)
    if google_account:
        if google_account["user_id"] == current_user["id"]:
            return google_account
        raise HTTPException(status_code=403, detail="Access denied")
    raise HTTPException(status_code=404, detail="Google account not found")


def verify_calendar_access(
    calendar_id: str = Path(...),
    current_user: dict = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client),
) -> dict:
    calendar = get_google_calendar(supabase, calendar_id, user_id=current_user["id"])
    if not calendar:
        raise HTTPException(status_code=404, detail="Calendar not found")
    return calendar


CurrentUser = Annotated[dict, Depends(get_current_user)]
HttpClient = Annotated[httpx.AsyncClient, Depends(get_http_client)]
SupabaseClientDep = Annotated[Client, Depends(get_supabase_client)]
VerifiedAccount = Annotated[dict, Depends(verify_account_access)]
VerifiedCalendar = Annotated[dict, Depends(verify_calendar_access)]
