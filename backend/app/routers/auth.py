import logging
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
from app.core.encryption import Encryption
from app.core.supabase import get_supabase_client
from app.core.users import get_or_create_user

limiter = Limiter(key_func=get_remote_address)

# Token expiry timing (returned to frontend as expires_at):
# - ACCESS_TOKEN_EXPIRY_MS (1 hour): Matches Supabase access token lifetime. Frontend should
#   call /auth/refresh before this expires to get a new access token.
# - COOKIE_MAX_AGE (30 days, in config.py): How long cookies persist in the browser. This is
#   intentionally longer than the access token to support the refresh flow - the refresh token
#   cookie needs to outlive the access token so /auth/refresh can exchange it for new tokens.
ACCESS_TOKEN_EXPIRY_MS = 60 * 60 * 1000


def get_google_identity(user):
    return next((i for i in (user.identities or []) if i.provider == "google"), None)


class SetSessionRequest(BaseModel):
    access_token: str


class StoreGoogleTokensRequest(BaseModel):
    provider_token: str
    provider_refresh_token: str | None = None


logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()


def set_auth_cookie(response: Response, key: str, value: str):
    response.set_cookie(
        key=key,
        value=value,
        max_age=settings.COOKIE_MAX_AGE,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        domain=settings.COOKIE_DOMAIN,
        path="/",
    )


def get_expires_at() -> int:
    return int(time.time() * 1000) + ACCESS_TOKEN_EXPIRY_MS


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

    if not result.data:
        raise ValueError("Failed to upsert google account")
    account_id = result.data[0]["id"]
    # Google OAuth access tokens expire in ~1 hour by design (not configurable)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=1)

    token_data = {
        "google_account_id": account_id,
        "access_token": Encryption.encrypt(provider_token, user_id),
        "refresh_token": Encryption.encrypt(provider_refresh_token, user_id) if provider_refresh_token else None,
        "expires_at": expires_at.isoformat(),
    }

    token_result = (
        supabase.table("google_account_tokens")
        .upsert(token_data, on_conflict="google_account_id")
        .execute()
    )

    if not token_result.data:
        raise ValueError("Failed to upsert google account tokens")

    logger.info("Stored Google account %s for user %s", email, user_id)
    return account_id


@router.get("/google/login")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def initiate_google_login(request: Request):
    # Supabase handles CSRF protection via PKCE (Proof Key for Code Exchange),
    # so no additional state cookie is needed.
    supabase = get_supabase_client()

    data = supabase.auth.sign_in_with_oauth(
        {
            "provider": "google",
            "options": {
                "redirect_to": f"{settings.FRONTEND_URL}/auth/callback",
                "scopes": "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events",
            },
        }
    )

    return {"redirectUrl": str(data.url)}


@router.post("/callback")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def handle_callback(
    request: Request,
    response: Response,
    code: str = Query(...),
):
    # Supabase handles CSRF protection via PKCE (Proof Key for Code Exchange)
    # during the exchange_code_for_session call below.
    try:
        auth_client = get_supabase_client()
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

        db = get_supabase_client()
        (
            db.table("users")
            .upsert(user_data)
            .execute()
        )

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
                logger.warning("Failed to store Google account (user can link later): %s", e)

        set_auth_cookie(response, settings.SESSION_COOKIE_NAME, session.access_token)
        if session.refresh_token:
            set_auth_cookie(response, settings.REFRESH_COOKIE_NAME, session.refresh_token)

        logger.info("Set session cookies for user %s (has_refresh=%s)", user.id, bool(session.refresh_token))
        return {"user": user_data, "expires_at": get_expires_at()}

    except AuthApiError as e:
        logger.warning("Auth API error during callback: %s", e)
        raise HTTPException(status_code=400, detail="Authentication failed")
    except HTTPException:
        raise
    except httpx.HTTPError as e:
        logger.warning("HTTP error during callback: %s", e)
        raise HTTPException(status_code=502, detail="External service error")


@router.get("/session")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def get_session(request: Request, chronos_session: Annotated[str | None, Cookie()] = None):
    if not chronos_session:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        supabase = get_supabase_client()
        user_response = supabase.auth.get_user(chronos_session)

        if not user_response.user:
            raise HTTPException(status_code=401, detail="Invalid session")

        user_data = get_or_create_user(
            supabase,
            user_response.user.id,
            user_response.user.email,
            user_response.user.user_metadata,
        )

        return {"user": user_data, "expires_at": get_expires_at()}

    except AuthApiError:
        raise HTTPException(status_code=401, detail="Session validation failed")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error during session validation: %s", e)
        raise HTTPException(status_code=500, detail="Session validation error")


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
        supabase = get_supabase_client()
        refresh_response = supabase.auth.refresh_session(chronos_refresh)

        if not refresh_response.session:
            raise HTTPException(status_code=401, detail="Failed to refresh")

        if not refresh_response.user:
            raise HTTPException(status_code=401, detail="Failed to get user")

        set_auth_cookie(response, settings.SESSION_COOKIE_NAME, refresh_response.session.access_token)
        if refresh_response.session.refresh_token:
            set_auth_cookie(response, settings.REFRESH_COOKIE_NAME, refresh_response.session.refresh_token)

        user_data = get_or_create_user(supabase, refresh_response.user.id)

        return {"user": user_data, "expires_at": get_expires_at()}

    except AuthApiError:
        raise HTTPException(status_code=401, detail="Refresh failed")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error during token refresh: %s", e)
        raise HTTPException(status_code=500, detail="Token refresh error")


@router.post("/set-session")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def set_session(request: Request, body: SetSessionRequest, response: Response):
    try:
        supabase = get_supabase_client()
        user_response = supabase.auth.get_user(body.access_token)

        if not user_response.user:
            raise HTTPException(status_code=401, detail="Invalid token")

        set_auth_cookie(response, settings.SESSION_COOKIE_NAME, body.access_token)
        return {"success": True}

    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Set session error: %s", e)
        raise HTTPException(status_code=401, detail="Invalid token")


@router.post("/logout")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def logout(request: Request, response: Response):
    # Server-side session invalidation (supabase.auth.sign_out()) is intentionally not called.
    # The Supabase client is a singleton shared across requests, and calling set_session/sign_out
    # causes race conditions with concurrent requests. Cookie deletion is sufficient for
    # client-side logout, and tokens expire naturally (1 hour for access, refresh on rotation).
    response.delete_cookie(
        key=settings.SESSION_COOKIE_NAME, domain=settings.COOKIE_DOMAIN, path="/"
    )
    response.delete_cookie(
        key=settings.REFRESH_COOKIE_NAME, domain=settings.COOKIE_DOMAIN, path="/"
    )

    return {"message": "Logged out"}


@router.post("/google/store-tokens")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def store_google_tokens_endpoint(
    request: Request,
    body: StoreGoogleTokensRequest,
    chronos_session: Annotated[str | None, Cookie()] = None,
):
    if not chronos_session:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        supabase = get_supabase_client()
        user_response = supabase.auth.get_user(chronos_session)

        if not user_response.user:
            raise HTTPException(status_code=401, detail="Invalid session")

        user = user_response.user
        google_identity = get_google_identity(user)

        if not google_identity:
            raise HTTPException(status_code=400, detail="No Google identity found")

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

    except AuthApiError:
        raise HTTPException(status_code=401, detail="Authentication failed")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error storing Google tokens: %s", e)
        raise HTTPException(status_code=500, detail="Failed to store tokens")


@router.delete("/google/accounts/{google_account_id}")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def delete_google_account(
    request: Request,
    google_account_id: str,
    chronos_session: Annotated[str | None, Cookie()] = None,
):
    if not chronos_session:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        supabase = get_supabase_client()
        user_response = supabase.auth.get_user(chronos_session)

        if not user_response.user:
            raise HTTPException(status_code=401, detail="Invalid session")

        user = user_response.user
        account_result = (
            supabase.table("google_accounts")
            .select("id, user_id")
            .eq("id", google_account_id)
            .maybe_single()
            .execute()
        )

        if not account_result.data:
            raise HTTPException(status_code=404, detail="Google account not found")

        if account_result.data["user_id"] != user.id:
            raise HTTPException(status_code=403, detail="Access denied")

        tokens_result = (
            supabase.table("google_account_tokens")
            .select("access_token")
            .eq("google_account_id", google_account_id)
            .maybe_single()
            .execute()
        )

        if tokens_result.data and tokens_result.data.get("access_token"):
            try:
                access_token = Encryption.decrypt(str(tokens_result.data["access_token"]), user.id)
                async with httpx.AsyncClient() as client:
                    await client.post(
                        "https://oauth2.googleapis.com/revoke", data={"token": access_token}
                    )
            except Exception as e:
                logger.warning("Failed to revoke Google token: %s", e)

        supabase.rpc(
            "delete_google_account_cascade",
            {"p_google_account_id": google_account_id, "p_user_id": user.id}
        ).execute()

        logger.info("Deleted Google account %s for user %s", google_account_id, user.id)
        return {"success": True, "message": "Google account disconnected"}

    except AuthApiError:
        raise HTTPException(status_code=401, detail="Authentication failed")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error deleting Google account: %s", e)
        raise HTTPException(status_code=500, detail="Failed to delete account")
