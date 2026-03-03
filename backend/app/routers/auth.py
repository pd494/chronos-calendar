import html
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Annotated
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from uuid import UUID

import httpx
from fastapi import APIRouter, Cookie, HTTPException, Query, Request, Response
from pydantic import BaseModel
from fastapi.responses import HTMLResponse
from postgrest.exceptions import APIError
from supabase_auth.errors import AuthApiError
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import get_settings
from app.core.dependencies import CurrentUser
from app.core.encryption import Encryption
from app.core.supabase import get_supabase_client
from app.core.dependencies import get_user

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


logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()


class OAuthCallbackRequest(BaseModel):
    code: str


class RefreshRequest(BaseModel):
    refresh_token: str | None = None


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


def delete_auth_cookie(response: Response, key: str):
    response.delete_cookie(
        key=key,
        domain=settings.COOKIE_DOMAIN,
        path="/",
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
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
async def initiate_google_login(request: Request, redirectTo: str | None = Query(default=None)):
    # Supabase handles CSRF protection via PKCE (Proof Key for Code Exchange),
    # so no additional state cookie is needed.
    supabase = get_supabase_client()

    redirect_url = f"{settings.FRONTEND_URL.rstrip('/')}/auth/web/callback"
    if redirectTo:
        if redirectTo not in settings.oauth_redirect_urls:
            raise HTTPException(status_code=400, detail="Invalid redirect URL")
        redirect_url = redirectTo

    data = supabase.auth.sign_in_with_oauth(
        {
            "provider": "google",
            "options": {
                "redirect_to": redirect_url,
                "scopes": "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events",
                "query_params": {"access_type": "offline", "prompt": "consent"},
            },
        }
    )

    return {"redirectUrl": str(data.url)}


def _exchange_code(code: str):
    auth_client = get_supabase_client()
    auth_response = auth_client.auth.exchange_code_for_session({"auth_code": code})  # type: ignore[typeddict-item]

    if not auth_response.session:
        raise HTTPException(status_code=400, detail="Failed to create session")

    session = auth_response.session
    user = auth_response.user
    if not user:
        raise HTTPException(status_code=400, detail="Failed to get user")

    user_data = get_user(auth_client, user.id)

    provider_token = getattr(session, "provider_token", None)
    google_identity = get_google_identity(user) if provider_token else None

    if provider_token and google_identity:
        identity_data = google_identity.identity_data or {}
        try:
            store_google_account(
                auth_client,
                user.id,
                google_identity.id,
                identity_data.get("email") or user.email or "",
                identity_data.get("full_name") or identity_data.get("name"),
                provider_token,
                getattr(session, "provider_refresh_token", None),
            )
        except (APIError, ValueError) as e:
            logger.warning("Failed to store Google account (user can link later): %s", e)

    return session, user, user_data


@router.post("/web/callback")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def handle_callback(
    request: Request,
    response: Response,
    body: OAuthCallbackRequest,
):
    try:
        session, user, user_data = _exchange_code(body.code)

        set_auth_cookie(response, settings.SESSION_COOKIE_NAME, session.access_token)
        if session.refresh_token:
            set_auth_cookie(response, settings.REFRESH_COOKIE_NAME, session.refresh_token)

        logger.info("Set session cookies for user %s (has_refresh=%s)", user.id, bool(session.refresh_token))
        return {"user": user_data, "expires_at": get_expires_at()}

    except AuthApiError as e:
        logger.warning("Auth API error during callback: %s", e)
        raise HTTPException(status_code=400, detail="Authentication failed")
    except httpx.HTTPError as e:
        logger.warning("HTTP error during callback: %s", e)
        raise HTTPException(status_code=502, detail="External service error")


@router.post("/desktop/callback")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def handle_desktop_callback(request: Request, body: OAuthCallbackRequest):
    try:
        session, user, user_data = _exchange_code(body.code)

        logger.info("Desktop token exchange for user %s", user.id)
        return {
            "user": user_data,
            "expires_at": get_expires_at(),
            "access_token": session.access_token,
            "refresh_token": session.refresh_token,
        }

    except AuthApiError as e:
        logger.warning("Auth API error during desktop callback: %s", e)
        raise HTTPException(status_code=400, detail="Authentication failed")
    except httpx.HTTPError as e:
        logger.warning("HTTP error during desktop callback: %s", e)
        raise HTTPException(status_code=502, detail="External service error")
    

@router.get("/session")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def get_session(request: Request, current_user: CurrentUser):
    return {"user": current_user, "expires_at": get_expires_at()}


@router.post("/refresh")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def refresh_token(
    request: Request,
    response: Response,
    body: RefreshRequest = RefreshRequest(),
    cookie_refresh_token: Annotated[str | None, Cookie(alias=settings.REFRESH_COOKIE_NAME)] = None,
):
    token = body.refresh_token or cookie_refresh_token
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    is_desktop = body.refresh_token is not None

    try:
        supabase = get_supabase_client()
        refresh_response = supabase.auth.refresh_session(token)

        if not refresh_response.session:
            raise HTTPException(status_code=401, detail="Failed to refresh")

        if not refresh_response.user:
            raise HTTPException(status_code=401, detail="Failed to get user")

        user_data = get_user(supabase, refresh_response.user.id)

        if is_desktop:
            return {
                "user": user_data,
                "expires_at": get_expires_at(),
                "access_token": refresh_response.session.access_token,
                "refresh_token": refresh_response.session.refresh_token,
            }

        set_auth_cookie(response, settings.SESSION_COOKIE_NAME, refresh_response.session.access_token)
        if refresh_response.session.refresh_token:
            set_auth_cookie(response, settings.REFRESH_COOKIE_NAME, refresh_response.session.refresh_token)

        return {"user": user_data, "expires_at": get_expires_at()}

    except AuthApiError:
        raise HTTPException(status_code=401, detail="Refresh failed")


@router.post("/logout")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def logout(request: Request, response: Response):
    # Server-side session invalidation (supabase.auth.sign_out()) is intentionally not called.
    # The Supabase client is a singleton shared across requests, and calling set_session/sign_out
    # causes race conditions with concurrent requests. Cookie deletion is sufficient for
    # client-side logout, and tokens expire naturally (1 hour for access, refresh on rotation).
    delete_auth_cookie(response, settings.SESSION_COOKIE_NAME)
    delete_auth_cookie(response, settings.REFRESH_COOKIE_NAME)

    return {"message": "Logged out"}


@router.get("/desktop/callback", include_in_schema=False)
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def desktop_callback(
    request: Request,
    code: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
):
    base = settings.DESKTOP_REDIRECT_URL
    parsed = urlparse(base)
    query = dict(parse_qsl(parsed.query))
    if code:
        query["code"] = code
    if error:
        query["error"] = error
    if error_description:
        query["error_description"] = error_description
    target_url = urlunparse(parsed._replace(query=urlencode(query)))

    title = "Redirecting to Chronos"
    status_message = "You're signed in. Redirecting you back to Chronos..."
    if error or not code:
        title = "Sign-in failed"
        status_message = error_description or error or "Authentication failed."

    safe_message = html.escape(status_message)
    safe_title = html.escape(title)
    retry_url = f"{settings.FRONTEND_URL.rstrip('/')}/login"

    target_js = json.dumps(target_url).replace("</", r"<\/")

    html_body = f"""
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{safe_title}</title>
    <style>
      body {{
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background: #0b0b0c;
        color: #f5f5f7;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        margin: 0;
      }}
      .card {{
        background: #151517;
        border: 1px solid #2a2a2f;
        border-radius: 16px;
        padding: 28px;
        width: min(460px, 92vw);
        text-align: center;
        box-shadow: 0 20px 40px rgba(0,0,0,0.35);
      }}
      h1 {{ font-size: 20px; margin: 0 0 8px; }}
      p {{ color: #c9c9ce; margin: 0 0 18px; line-height: 1.5; }}
      .actions {{ display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }}
      a, button {{
        background: #ffffff;
        color: #111114;
        border: none;
        border-radius: 10px;
        padding: 10px 14px;
        cursor: pointer;
        text-decoration: none;
        font-weight: 600;
      }}
      .secondary {{
        background: transparent;
        color: #f5f5f7;
        border: 1px solid #3a3a42;
      }}
    </style>
  </head>
  <body>
    <div class="card">
      <h1>{safe_title}</h1>
      <p>{safe_message}</p>
      <div class="actions">
        <a href="{html.escape(target_url)}">Open Chronos</a>
        <a class="secondary" href="{html.escape(retry_url)}">Try again</a>
      </div>
    </div>
    <script>
      if (!{str(bool(error or not code)).lower()}) {{
        window.location.href = {target_js};
      }}
    </script>
  </body>
</html>
"""
    return HTMLResponse(html_body)


@router.delete("/google/accounts/{google_account_id}")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def delete_google_account(
    request: Request,
    google_account_id: UUID,
    current_user: CurrentUser,
):
    user_id = current_user["id"]
    supabase = get_supabase_client()

    account_result = (
        supabase.table("google_accounts")
        .select("id, user_id, google_account_tokens(access_token)")
        .eq("id", str(google_account_id))
        .maybe_single()
        .execute()
    )

    if not account_result.data:
        raise HTTPException(status_code=404, detail="Google account not found")

    if account_result.data["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    tokens = account_result.data.get("google_account_tokens")
    if tokens and tokens.get("access_token"):
        try:
            access_token = Encryption.decrypt(tokens["access_token"], user_id)
            async with httpx.AsyncClient() as client:
                await client.post(
                    "https://oauth2.googleapis.com/revoke", data={"token": access_token}
                )
        except (ValueError, httpx.HTTPError) as e:
            logger.warning("Failed to revoke Google token: %s", e)

    delete_result = (
        supabase.table("google_accounts")
        .delete()
        .eq("id", str(google_account_id))
        .execute()
    )

    if not delete_result.data:
        raise HTTPException(status_code=500, detail="Failed to delete account")

    logger.info("Deleted Google account %s for user %s", google_account_id, user_id)
    return {"success": True, "message": "Google account disconnected"}
