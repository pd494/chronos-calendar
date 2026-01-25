import logging
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Annotated

import httpx
from fastapi import APIRouter, Cookie, HTTPException, Query, Request, Response
from supabase_auth.errors import AuthApiError
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import get_settings
from app.core.db_utils import Row, first_row
from app.core.dependencies import _extract_bearer_token
from app.core.encryption import Encryption
from app.core.supabase import SupabaseClient

limiter = Limiter(key_func=get_remote_address)

OAUTH_STATE_COOKIE_NAME = "chronos_oauth_state"
OAUTH_STATE_MAX_AGE = 600


def get_google_identity(user):
    return next((i for i in (user.identities or []) if i.provider == "google"), None)


class SetSessionRequest(BaseModel):
    access_token: str


class StoreGoogleTokensRequest(BaseModel):
    provider_token: str
    access_token: str | None = None
    provider_refresh_token: str | None = None


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
        path="/",
    )


def set_refresh_cookie(response: Response, refresh_token: str):
    response.set_cookie(
        key=settings.REFRESH_COOKIE_NAME,
        value=refresh_token,
        max_age=settings.SESSION_MAX_AGE,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        domain=settings.COOKIE_DOMAIN,
        path="/",
    )


def get_user_data(supabase, user_id: str, user_email: str | None = None, metadata: dict | None = None) -> Row:
    user_row = supabase.table("users").select("*").eq("id", user_id).maybe_single().execute()
    row = first_row(user_row.data) if user_row else None
    if row:
        return row

    user_data: Row = {
        "id": user_id,
        "email": user_email or "",
        "name": (metadata or {}).get("name"),
        "avatar_url": (metadata or {}).get("avatar_url"),
    }
    insert_result = supabase.table("users").upsert(user_data).execute()
    inserted = first_row(insert_result.data) if insert_result else None
    if inserted:
        return inserted
    return user_data


def get_expires_at() -> int:
    return int(time.time() * 1000) + (60 * 60 * 1000)


def store_google_account(
    supabase,
    user_id: str,
    google_id: str,
    email: str,
    name: str | None,
    provider_token: str,
    provider_refresh_token: str | None,
):
    account_data = {
        "user_id": user_id,
        "google_id": google_id,
        "email": email,
        "name": name,
        "needs_reauth": False,
    }

    result = (
        supabase.table("google_accounts")
        .upsert(account_data, on_conflict="user_id,google_id")
        .execute()
    )

    row = first_row(result.data)
    if not row:
        raise ValueError("Failed to upsert google account")
    account_id = row["id"]
    expires_at = datetime.now(timezone.utc) + timedelta(hours=1)

    token_data = {
        "google_account_id": account_id,
        "access_token": Encryption.encrypt(provider_token, user_id),
        "refresh_token": Encryption.encrypt(provider_refresh_token or "", user_id),
        "expires_at": expires_at.isoformat(),
    }

    supabase.table("google_account_tokens").upsert(
        token_data, on_conflict="google_account_id"
    ).execute()

    logger.info("Stored Google account %s for user %s", email, user_id)
    return account_id


@router.get("/google/login")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def initiate_google_login(request: Request, response: Response):
    supabase = SupabaseClient.get_client()
    oauth_state = secrets.token_urlsafe(32)

    data = supabase.auth.sign_in_with_oauth(
        {
            "provider": "google",
            "options": {
                "redirect_to": f"{settings.FRONTEND_URL}/auth/callback",
                "scopes": "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events",
            },
        }
    )

    response.set_cookie(
        key=OAUTH_STATE_COOKIE_NAME,
        value=oauth_state,
        max_age=OAUTH_STATE_MAX_AGE,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        domain=settings.COOKIE_DOMAIN,
        path="/",
    )
    logger.info("Set OAuth state cookie: %s (domain=%s, secure=%s, samesite=%s)",
                oauth_state[:10], settings.COOKIE_DOMAIN, settings.COOKIE_SECURE, settings.COOKIE_SAMESITE)

    redirect_url = str(data.url)
    if "?" in redirect_url:
        redirect_url += f"&chronos_state={oauth_state}"
    else:
        redirect_url += f"?chronos_state={oauth_state}"

    return {"redirectUrl": redirect_url}


@router.post("/callback")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def handle_callback(
    request: Request,
    response: Response,
    code: str = Query(...),
    chronos_state: str | None = Query(None),
    chronos_oauth_state: Annotated[str | None, Cookie()] = None,
):
    if settings.ENVIRONMENT == "production":
        if not chronos_state:
            logger.warning("OAuth callback missing chronos_state query parameter")
            raise HTTPException(status_code=400, detail="Missing OAuth state parameter")
        if not chronos_oauth_state:
            logger.warning("OAuth callback missing chronos_oauth_state cookie")
            raise HTTPException(status_code=400, detail="Missing OAuth state cookie")
        if not secrets.compare_digest(chronos_state, chronos_oauth_state):
            logger.warning("OAuth state mismatch: query=%s cookie=%s", chronos_state[:10], chronos_oauth_state[:10])
            raise HTTPException(status_code=400, detail="Invalid OAuth state")
    else:
        logger.info("Skipping OAuth state validation in development (state_param=%s, state_cookie=%s)",
                   bool(chronos_state), bool(chronos_oauth_state))

    if chronos_oauth_state:
        response.delete_cookie(
            key=OAUTH_STATE_COOKIE_NAME, domain=settings.COOKIE_DOMAIN, path="/"
        )

    try:
        auth_client = SupabaseClient.get_client()
        auth_response = auth_client.auth.exchange_code_for_session({"auth_code": code})  # type: ignore[typeddict-item]

        if not auth_response.session:
            raise HTTPException(status_code=400, detail="Failed to create session")

        session = auth_response.session
        user = auth_response.user
        if not user:
            raise HTTPException(status_code=400, detail="Failed to get user")

        user_data = {
            "id": user.id,
            "email": user.email,
            "name": user.user_metadata.get("name"),
            "avatar_url": user.user_metadata.get("avatar_url"),
        }

        db = SupabaseClient.get_auth_client()
        db.table("users").upsert(user_data).execute()

        provider_token = getattr(session, "provider_token", None)
        google_identity = get_google_identity(user) if provider_token else None

        if provider_token and google_identity:
            identity_data = google_identity.identity_data or {}
            try:
                store_google_account(
                    db,
                    user.id,
                    google_identity.id,
                    identity_data.get("email") or user.email or "",
                    identity_data.get("full_name") or identity_data.get("name"),
                    provider_token,
                    getattr(session, "provider_refresh_token", None),
                )
            except Exception as e:
                logger.warning(
                    "Failed to store Google account, cleaning up user: %s", e
                )
                db.table("users").delete().eq("id", user.id).execute()
                raise HTTPException(
                    status_code=500, detail="Failed to store Google account"
                )

        set_session_cookie(response, session.access_token)
        if session.refresh_token:
            set_refresh_cookie(response, session.refresh_token)

        logger.info("Set session cookies for user %s (has_refresh=%s)", user.id, bool(session.refresh_token))
        return {"user": user_data, "expires_at": get_expires_at()}

    except HTTPException:
        raise
    except AuthApiError as e:
        logger.warning("Auth API error during callback: %s", e)
        raise HTTPException(status_code=400, detail="Authentication failed")
    except httpx.HTTPError as e:
        logger.warning("HTTP error during callback: %s", e)
        raise HTTPException(status_code=502, detail="External service error")
    except Exception as e:
        logger.exception("Unexpected callback error: %s", e)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/session")
async def get_session(request: Request, chronos_session: Annotated[str | None, Cookie()] = None):
    logger.info("Session check - Cookie header: %s, chronos_session: %s",
                request.headers.get("cookie", "None")[:50], bool(chronos_session))
    if not chronos_session:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        supabase = SupabaseClient.get_client()
        user_response = supabase.auth.get_user(chronos_session)
        user = user_response.user if user_response else None

        if not user:
            raise HTTPException(status_code=401, detail="Invalid session")

        user_data = get_user_data(
            supabase,
            user.id,
            user.email,
            user.user_metadata,
        )

        return {"user": user_data, "expires_at": get_expires_at()}

    except HTTPException:
        raise
    except AuthApiError:
        raise HTTPException(status_code=401, detail="Session validation failed")


@router.post("/refresh")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def refresh_token(
    request: Request,
    response: Response,
    chronos_refresh: Annotated[str | None, Cookie()] = None,
):
    if not chronos_refresh:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        supabase = SupabaseClient.get_client()
        refresh_response = supabase.auth.refresh_session(chronos_refresh)

        if not refresh_response.session:
            raise HTTPException(status_code=401, detail="Failed to refresh")

        user = refresh_response.user
        if not user:
            raise HTTPException(status_code=401, detail="Failed to refresh user")

        set_session_cookie(response, refresh_response.session.access_token)
        if refresh_response.session.refresh_token:
            set_refresh_cookie(response, refresh_response.session.refresh_token)

        user_data = get_user_data(supabase, user.id)

        return {"user": user_data, "expires_at": get_expires_at()}

    except HTTPException:
        raise
    except AuthApiError:
        raise HTTPException(status_code=401, detail="Refresh failed")


@router.post("/set-session")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def set_session(request: Request, body: SetSessionRequest, response: Response):
    try:
        supabase = SupabaseClient.get_client()
        user_response = supabase.auth.get_user(body.access_token)
        user = user_response.user if user_response else None

        if not user:
            raise HTTPException(status_code=401, detail="Invalid token")

        set_session_cookie(response, body.access_token)
        return {"success": True}

    except Exception as e:
        logger.warning("Set session error: %s", e)
        raise HTTPException(status_code=401, detail="Invalid token")


@router.post("/logout")
async def logout(
    response: Response,
    chronos_session: Annotated[str | None, Cookie()] = None,
):
    if chronos_session:
        try:
            supabase = SupabaseClient.get_client()
            supabase.auth.sign_out()
        except Exception as e:
            logger.debug("Sign out cleanup failed (non-critical): %s", e)

    response.delete_cookie(
        key=settings.SESSION_COOKIE_NAME, domain=settings.COOKIE_DOMAIN, path="/"
    )
    response.delete_cookie(
        key=settings.REFRESH_COOKIE_NAME, domain=settings.COOKIE_DOMAIN, path="/"
    )

    return {"message": "Logged out"}


@router.post("/google/store-tokens")
async def store_google_tokens_endpoint(
    body: StoreGoogleTokensRequest,
    chronos_session: Annotated[str | None, Cookie()] = None,
):
    access_token = body.access_token or chronos_session
    if not access_token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    supabase = SupabaseClient.get_client()
    user_response = supabase.auth.get_user(access_token)
    user = user_response.user if user_response else None

    if not user:
        raise HTTPException(status_code=401, detail="Invalid session")

    google_identity = get_google_identity(user)

    if not google_identity:
        raise HTTPException(status_code=400, detail="No Google identity found")

    get_user_data(supabase, user.id, user.email, user.user_metadata)

    identity_data = google_identity.identity_data or {}
    account_id = store_google_account(
        supabase,
        user.id,
        google_identity.id,
        identity_data.get("email") or user.email or "",
        identity_data.get("full_name") or identity_data.get("name"),
        body.provider_token,
        body.provider_refresh_token,
    )

    return {"success": True, "account_id": account_id}


@router.get("/encryption-key")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def get_encryption_key(request: Request):
    access_token = request.cookies.get(
        settings.SESSION_COOKIE_NAME
    ) or _extract_bearer_token(request)

    if not access_token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        supabase = SupabaseClient.get_client()
        user_response = supabase.auth.get_user(access_token)
        user = user_response.user if user_response else None

        if not user:
            raise HTTPException(status_code=401, detail="Invalid session")

        key_data = Encryption.derive_client_key(user.id)

        return {"key": key_data["key"], "salt": key_data["salt"]}

    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Encryption key error: %s", e)
        raise HTTPException(status_code=500, detail="Failed to generate encryption key")


@router.delete("/google/accounts/{google_account_id}")
async def delete_google_account(
    google_account_id: str, chronos_session: Annotated[str | None, Cookie()] = None
):
    if not chronos_session:
        raise HTTPException(status_code=401, detail="Not authenticated")

    supabase = SupabaseClient.get_client()
    user_response = supabase.auth.get_user(chronos_session)
    user = user_response.user if user_response else None

    if not user:
        raise HTTPException(status_code=401, detail="Invalid session")

    account_result = (
        supabase.table("google_accounts")
        .select("id, user_id")
        .eq("id", google_account_id)
        .maybe_single()
        .execute()
    )
    account = first_row(account_result.data) if account_result else None

    if not account:
        raise HTTPException(status_code=404, detail="Google account not found")

    if account["user_id"] != user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    tokens_result = (
        supabase.table("google_account_tokens")
        .select("access_token")
        .eq("google_account_id", google_account_id)
        .maybe_single()
        .execute()
    )
    tokens = first_row(tokens_result.data) if tokens_result else None

    if tokens and tokens.get("access_token"):
        try:
            access_token = Encryption.decrypt(str(tokens["access_token"]), user.id)
            async with httpx.AsyncClient() as client:
                await client.post(
                    "https://oauth2.googleapis.com/revoke", data={"token": access_token}
                )
        except Exception as e:
            logger.warning("Failed to revoke Google token: %s", e)

    calendars_result = (
        supabase.table("google_calendars")
        .select("id")
        .eq("google_account_id", google_account_id)
        .execute()
    )
    calendars_data = calendars_result.data if calendars_result else []
    calendar_ids = [c["id"] for c in calendars_data if isinstance(c, dict)]

    if calendar_ids:
        supabase.table("calendar_sync_state").delete().in_(
            "google_calendar_id", calendar_ids
        ).execute()
        supabase.table("calendar_fetched_ranges").delete().in_(
            "google_calendar_id", calendar_ids
        ).execute()

    supabase.table("events").delete().eq(
        "google_account_id", google_account_id
    ).execute()
    supabase.table("google_calendars").delete().eq(
        "google_account_id", google_account_id
    ).execute()
    supabase.table("google_account_tokens").delete().eq(
        "google_account_id", google_account_id
    ).execute()
    supabase.table("google_accounts").delete().eq("id", google_account_id).execute()

    logger.info(
        "Deleted Google account %s for user %s",
        google_account_id,
        user.id,
    )

    return {"success": True, "message": "Google account disconnected"}
