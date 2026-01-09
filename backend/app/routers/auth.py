import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Response, HTTPException, Cookie, Query
from typing import Annotated
import httpx
from app.core.supabase import get_supabase_client
from app.core.encryption import encrypt, decrypt
from app.config import get_settings
import time

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()

def set_session_cookie(response: Response, access_token: str):
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=access_token,
        max_age=settings.SESSION_MAX_AGE,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        domain=settings.COOKIE_DOMAIN,
        path="/"
    )

def get_user_data(supabase, user_id: str) -> dict:
    user_data = (
        supabase.table("users")
        .select("*")
        .eq("id", user_id)
        .single()
        .execute()
    )
    return user_data.data

def get_expires_at() -> int:
    return int(time.time() * 1000) + (60 * 60 * 1000)

def store_google_account(
    supabase,
    user_id: str,
    google_id: str,
    email: str,
    name: str | None,
    provider_token: str,
    provider_refresh_token: str | None
):
    account_data = {
        "user_id": user_id,
        "google_id": google_id,
        "email": email,
        "name": name,
        "needs_reauth": False
    }

    result = supabase.table("google_accounts").upsert(
        account_data,
        on_conflict="user_id,google_id"
    ).execute()

    account_id = result.data[0]["id"]
    expires_at = datetime.now(timezone.utc) + timedelta(hours=1)

    token_data = {
        "google_account_id": account_id,
        "access_token": encrypt(provider_token, user_id),
        "refresh_token": encrypt(provider_refresh_token or "", user_id),
        "expires_at": expires_at.isoformat()
    }

    supabase.table("google_account_tokens").upsert(
        token_data,
        on_conflict="google_account_id"
    ).execute()

    logger.info(f"Stored Google account {email} for user {user_id}")
    return account_id

@router.get("/google/login")
async def initiate_google_login():
    supabase = get_supabase_client()

    data = supabase.auth.sign_in_with_oauth({
        "provider": "google",
        "options": {
            "redirect_to": f"{settings.FRONTEND_URL}/auth/callback",
            "scopes": "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events"
        }
    })

    return {"redirectUrl": data.url}

@router.post("/callback")
async def handle_callback(code: str = Query(...), response: Response = None):
    try:
        supabase = get_supabase_client()

        auth_response = supabase.auth.exchange_code_for_session({"auth_code": code})

        if not auth_response.session:
            raise HTTPException(status_code=400, detail="Failed to create session")

        session = auth_response.session
        user = auth_response.user

        user_data = {
            "id": user.id,
            "email": user.email,
            "name": user.user_metadata.get("name"),
            "avatar_url": user.user_metadata.get("avatar_url"),
        }

        supabase.table("users").upsert(user_data).execute()

        provider_token = getattr(session, 'provider_token', None)
        if provider_token:
            try:
                google_identity = next(
                    (i for i in (user.identities or []) if i.provider == 'google'),
                    None
                )
                if google_identity:
                    identity_data = google_identity.identity_data or {}
                    store_google_account(
                        supabase,
                        user.id,
                        google_identity.id,
                        identity_data.get('email', user.email),
                        identity_data.get('full_name') or identity_data.get('name'),
                        provider_token,
                        getattr(session, 'provider_refresh_token', None)
                    )
            except Exception as e:
                logger.warning(f"Failed to store Google account: {e}")

        set_session_cookie(response, session.access_token)

        return {
            "user": user_data,
            "expires_at": get_expires_at()
        }

    except Exception as e:
        logger.warning(f"Callback error: {e}")
        raise HTTPException(status_code=400, detail="Failed to complete authentication")

@router.get("/session")
async def get_session(chronos_session: Annotated[str | None, Cookie()] = None):
    if not chronos_session:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        supabase = get_supabase_client()
        user_response = supabase.auth.get_user(chronos_session)

        if not user_response.user:
            raise HTTPException(status_code=401, detail="Invalid session")

        user_data = get_user_data(supabase, user_response.user.id)

        return {
            "user": user_data,
            "expires_at": get_expires_at()
        }

    except Exception:
        raise HTTPException(status_code=401, detail="Session validation failed")

@router.post("/refresh")
async def refresh_token(
    chronos_session: Annotated[str | None, Cookie()] = None,
    response: Response = None
):
    if not chronos_session:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        supabase = get_supabase_client()
        refresh_response = supabase.auth.refresh_session()

        if not refresh_response.session:
            raise HTTPException(status_code=401, detail="Failed to refresh")

        set_session_cookie(response, refresh_response.session.access_token)

        user_data = get_user_data(supabase, refresh_response.user.id)

        return {
            "user": user_data,
            "expires_at": get_expires_at()
        }

    except Exception:
        raise HTTPException(status_code=401, detail="Refresh failed")

@router.post("/set-session")
async def set_session(body: dict, response: Response):
    access_token = body.get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail="Missing access_token")

    try:
        supabase = get_supabase_client()
        user_response = supabase.auth.get_user(access_token)

        if not user_response.user:
            raise HTTPException(status_code=401, detail="Invalid token")

        set_session_cookie(response, access_token)
        return {"success": True}

    except Exception as e:
        logger.warning(f"Set session error: {e}")
        raise HTTPException(status_code=401, detail="Invalid token")

@router.post("/logout")
async def logout(
    chronos_session: Annotated[str | None, Cookie()] = None,
    response: Response = None
):
    if chronos_session:
        try:
            supabase = get_supabase_client()
            supabase.auth.sign_out()
        except Exception as e:
            logger.debug(f"Sign out cleanup failed (non-critical): {e}")

    response.delete_cookie(
        key=settings.SESSION_COOKIE_NAME,
        domain=settings.COOKIE_DOMAIN
    )

    return {"message": "Logged out"}

@router.post("/google/store-tokens")
async def store_google_tokens_endpoint(
    body: dict,
    chronos_session: Annotated[str | None, Cookie()] = None
):
    access_token = body.get("access_token") or chronos_session
    if not access_token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    provider_token = body.get("provider_token")
    if not provider_token:
        raise HTTPException(status_code=400, detail="Missing provider_token")

    supabase = get_supabase_client()
    user_response = supabase.auth.get_user(access_token)

    if not user_response.user:
        raise HTTPException(status_code=401, detail="Invalid session")

    user = user_response.user
    google_identity = next(
        (i for i in (user.identities or []) if i.provider == 'google'),
        None
    )

    if not google_identity:
        raise HTTPException(status_code=400, detail="No Google identity found")

    identity_data = google_identity.identity_data or {}
    account_id = store_google_account(
        supabase,
        user.id,
        google_identity.id,
        identity_data.get('email', user.email),
        identity_data.get('full_name') or identity_data.get('name'),
        provider_token,
        body.get("provider_refresh_token")
    )

    return {"success": True, "account_id": account_id}


@router.delete("/google/accounts/{google_account_id}")
async def delete_google_account(
    google_account_id: str,
    chronos_session: Annotated[str | None, Cookie()] = None
):
    if not chronos_session:
        raise HTTPException(status_code=401, detail="Not authenticated")

    supabase = get_supabase_client()
    user_response = supabase.auth.get_user(chronos_session)

    if not user_response.user:
        raise HTTPException(status_code=401, detail="Invalid session")

    account = (
        supabase.table("google_accounts")
        .select("id, user_id")
        .eq("id", google_account_id)
        .maybe_single()
        .execute()
    )

    if not account.data:
        raise HTTPException(status_code=404, detail="Google account not found")

    if account.data["user_id"] != user_response.user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    user_id = user_response.user.id

    tokens = (
        supabase.table("google_account_tokens")
        .select("access_token")
        .eq("google_account_id", google_account_id)
        .maybe_single()
        .execute()
    )

    if tokens.data and tokens.data.get("access_token"):
        try:
            access_token = decrypt(tokens.data["access_token"], user_id)
            async with httpx.AsyncClient() as client:
                await client.post(
                    f"https://oauth2.googleapis.com/revoke?token={access_token}"
                )
        except Exception as e:
            logger.warning(f"Failed to revoke Google token: {e}")

    calendars = (
        supabase.table("google_calendars")
        .select("id")
        .eq("google_account_id", google_account_id)
        .execute()
    )
    calendar_ids = [c["id"] for c in calendars.data]

    if calendar_ids:
        supabase.table("calendar_sync_state").delete().in_("google_calendar_id", calendar_ids).execute()
        supabase.table("calendar_fetched_ranges").delete().in_("google_calendar_id", calendar_ids).execute()

    supabase.table("events").delete().eq("google_account_id", google_account_id).execute()
    supabase.table("google_calendars").delete().eq("google_account_id", google_account_id).execute()
    supabase.table("google_account_tokens").delete().eq("google_account_id", google_account_id).execute()
    supabase.table("google_accounts").delete().eq("id", google_account_id).execute()

    logger.info(f"Deleted Google account {google_account_id} for user {user_response.user.id}")

    return {"success": True, "message": "Google account disconnected"}
