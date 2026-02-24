import asyncio
import logging
from typing import Annotated

import httpx
from fastapi import Depends, HTTPException, Path, Request
from supabase import Client
from supabase_auth.errors import AuthApiError
from postgrest.exceptions import APIError
from app.calendar.constants import GoogleCalendarConfig
from app.calendar.db import get_google_account
from app.config import get_settings
from app.core.sessions import is_token_revoked
from app.core.supabase import get_supabase_client

logger = logging.getLogger(__name__)

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
    try:
        result = (
            supabase.table("users")
            .select("id, email, name, avatar_url")
            .eq("id", user_id)
            .single()
            .execute()
        )
        return result.data
    except APIError as e:
        logger.debug("User lookup failed for %s: %s", user_id, e)
        return None


async def get_current_user(request: Request) -> dict:
    settings = get_settings()

    access_token = request.cookies.get(settings.SESSION_COOKIE_NAME)
    if not access_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        supabase = get_supabase_client()
        if is_token_revoked(supabase, access_token):
            raise HTTPException(status_code=401, detail="Session revoked")

        user_response = supabase.auth.get_user(access_token)

        if not user_response.user:
            raise HTTPException(status_code=401, detail="Invalid session")

        user = get_user(supabase, user_response.user.id)
        if not user:
            raise HTTPException(status_code=401, detail="User not found")

        return user

    except AuthApiError as e:
        logger.warning("Auth error: %s (code=%s)", e.message, e.code)
        raise HTTPException(status_code=401, detail="Authentication failed")


def verify_account_access(
    google_account_id: str = Path(...),
    current_user: dict = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client),
) -> dict:
    google_account = get_google_account(supabase, google_account_id)

    if not google_account:
        raise HTTPException(status_code=404, detail="Google account not found")
    if google_account["user_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    if google_account.get("needs_reauth"):
        raise HTTPException(status_code=401, detail="Google account needs reconnection")

    return google_account


CurrentUser = Annotated[dict, Depends(get_current_user)]
HttpClient = Annotated[httpx.AsyncClient, Depends(get_http_client)]
SupabaseClientDep = Annotated[Client, Depends(get_supabase_client)]
VerifiedAccount = Annotated[dict, Depends(verify_account_access)]
