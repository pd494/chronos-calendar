import html
import json
import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from supabase_auth.errors import AuthApiError
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import get_settings
from app.core.csrf import create_csrf_token
from app.core.dependencies import CurrentUser, RefreshTokenCookie, SessionTokenCookie
from app.core.encryption import Encryption
from app.core.sessions import (
    delete_cookie,
    get_expires_at,
    set_cookie,
)
from app.core.supabase import get_supabase_client
from app.core.dependencies import get_user
from app.core.security import request_guard

limiter = Limiter(key_func=get_remote_address)


def get_google_identity(user):
    identities = user.identities
    if identities is None:
        raise HTTPException(status_code=400, detail="Missing Google identities")
    return next((i for i in identities if i.provider == "google"), None)


logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()


class OAuthCallbackRequest(BaseModel):
    code: str


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

    if result.data:
        account_id = result.data[0]["id"]
        expires_at = datetime.now(timezone.utc) + timedelta(hours=1)

        token_data = {
            "google_account_id": account_id,
            "access_token": Encryption.encrypt(provider_token, user_id),
            "expires_at": expires_at.isoformat(),
        }
        if provider_refresh_token:
            token_data["refresh_token"] = Encryption.encrypt(provider_refresh_token, user_id)

        token_result = (
            supabase.table("google_account_tokens")
            .upsert(token_data, on_conflict="google_account_id")
            .execute()
        )

        if token_result.data:
            logger.info("Stored Google account %s for user %s", email, user_id)
            return account_id
        raise ValueError("Failed to upsert google account tokens")
    raise ValueError("Failed to upsert google account")


@router.get("/google/login")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def initiate_google_login(
    request: Request, redirectTo: str | None = Query(default=None)
):
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
                "scopes": "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/contacts.other.readonly https://www.googleapis.com/auth/directory.readonly https://www.googleapis.com/auth/cloud-identity.groups.readonly",
                "query_params": {"access_type": "offline", "prompt": "select_account"},
            },
        }
    )

    return {"redirectUrl": str(data.url)}


def _exchange_code(code: str):
    auth_client = get_supabase_client()
    auth_response = auth_client.auth.exchange_code_for_session({"auth_code": code})
    session = auth_response.session
    user = auth_response.user
    if session and user:
        user_data = get_user(auth_client, user.id)

        provider_token = session.provider_token
        google_identity = get_google_identity(user) if provider_token else None

        if provider_token:
            if google_identity is None:
                raise HTTPException(status_code=400, detail="Missing Google identity")
            identity_data = google_identity.identity_data
            if not isinstance(identity_data, dict):
                raise HTTPException(status_code=400, detail="Missing Google identity data")
            email = identity_data.get("email")
            if not isinstance(email, str) or email == "":
                raise HTTPException(status_code=400, detail="Missing Google email")
            store_google_account(
                auth_client,
                user.id,
                google_identity.id,
                email,
                identity_data.get("full_name") or identity_data.get("name"),
                provider_token,
                session.provider_refresh_token,
            )

        return session, user, user_data
    if session:
        raise HTTPException(status_code=400, detail="Failed to get user")
    raise HTTPException(status_code=400, detail="Failed to create session")


@router.post("/web/callback", dependencies=[Depends(request_guard.authorize)])
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def handle_callback(
    request: Request,
    response: Response,
    body: OAuthCallbackRequest,
):
    try:
        session, user, user_data = _exchange_code(body.code)
        if user_data:
            logger.info(
                "Set session cookies for user %s (has_refresh=%s)",
                user.id,
                bool(session.refresh_token),
            )
            set_cookie(
                response=response,
                key=settings.SESSION_COOKIE_NAME,
                value=session.access_token,
                max_age=settings.COOKIE_MAX_AGE,
                httponly=True,
            )
            if session.refresh_token:
                set_cookie(
                    response=response,
                    key=settings.REFRESH_COOKIE_NAME,
                    value=session.refresh_token,
                    max_age=settings.COOKIE_MAX_AGE,
                    httponly=True,
                )
            csrf_ttl_seconds = settings.CSRF_TOKEN_TTL_SECONDS
            csrf_token = create_csrf_token(
                secret=settings.CSRF_SECRET_KEY,
                ttl_seconds=csrf_ttl_seconds,
            )
            set_cookie(
                response=response,
                key=settings.CSRF_COOKIE_NAME,
                value=csrf_token,
                max_age=csrf_ttl_seconds,
                httponly=False,
            )
            return {"user": user_data, "expires_at": get_expires_at()}
        raise HTTPException(status_code=401, detail="User not found")

    except AuthApiError as e:
        logger.warning("Auth API error during callback: %s", e)
        raise HTTPException(status_code=400, detail="Authentication failed")
    except httpx.HTTPError as e:
        logger.warning("HTTP error during callback: %s", e)
        raise HTTPException(status_code=502, detail="External service error")


@router.get("/session")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def get_session(request: Request, current_user: CurrentUser):
    return {"user": current_user, "expires_at": get_expires_at()}


@router.get("/csrf")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def get_csrf(request: Request, response: Response):
    csrf_ttl_seconds = settings.CSRF_TOKEN_TTL_SECONDS
    csrf_token = create_csrf_token(
        secret=settings.CSRF_SECRET_KEY,
        ttl_seconds=csrf_ttl_seconds,
    )
    set_cookie(
        response=response,
        key=settings.CSRF_COOKIE_NAME,
        value=csrf_token,
        max_age=csrf_ttl_seconds,
        httponly=False,
    )
    return {"ok": True}


@router.post("/refresh", dependencies=[Depends(request_guard.authorize)])
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def refresh_token(
    request: Request,
    response: Response,
    refresh_token: RefreshTokenCookie = None,
):
    if refresh_token:
        try:
            supabase = get_supabase_client()
            refresh_response = supabase.auth.refresh_session(refresh_token)
        except AuthApiError:
            raise HTTPException(status_code=401, detail="Refresh failed")

        session = refresh_response.session
        if session:
            user = refresh_response.user
            if user:
                user_data = get_user(supabase, user.id)
                if user_data:
                    set_cookie(
                        response=response,
                        key=settings.SESSION_COOKIE_NAME,
                        value=session.access_token,
                        max_age=settings.COOKIE_MAX_AGE,
                        httponly=True,
                    )
                    if session.refresh_token:
                        set_cookie(
                            response=response,
                            key=settings.REFRESH_COOKIE_NAME,
                            value=session.refresh_token,
                            max_age=settings.COOKIE_MAX_AGE,
                            httponly=True,
                        )
                    csrf_ttl_seconds = settings.CSRF_TOKEN_TTL_SECONDS
                    csrf_token = create_csrf_token(
                        secret=settings.CSRF_SECRET_KEY,
                        ttl_seconds=csrf_ttl_seconds,
                    )
                    set_cookie(
                        response=response,
                        key=settings.CSRF_COOKIE_NAME,
                        value=csrf_token,
                        max_age=csrf_ttl_seconds,
                        httponly=False,
                    )
                    return {"user": user_data, "expires_at": get_expires_at()}
                raise HTTPException(status_code=401, detail="User not found")
            raise HTTPException(status_code=401, detail="Failed to get user")
        raise HTTPException(status_code=401, detail="Failed to refresh")
    raise HTTPException(status_code=401, detail="Refresh failed")


@router.post("/logout", dependencies=[Depends(request_guard.authorize)])
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def logout(
    request: Request,
    response: Response,
    access_token: SessionTokenCookie = None,
    refresh_token: RefreshTokenCookie = None,
):
    supabase = get_supabase_client()
    try:
        if access_token and refresh_token:
            supabase.auth.set_session(access_token, refresh_token)
        if access_token or refresh_token:
            supabase.auth.sign_out({"scope": "global"})
    except AuthApiError as e:
        logger.debug("Logout remote sign out skipped: %s", e)

    delete_cookie(response, key=settings.SESSION_COOKIE_NAME)
    delete_cookie(response, key=settings.REFRESH_COOKIE_NAME)
    delete_cookie(response, key=settings.CSRF_COOKIE_NAME)
    return {"message": "Logged out"}


@router.get("/desktop/callback", include_in_schema=False)
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def desktop_callback(
    request: Request,
    code: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
):
    csp_nonce = str(request.state.csp_nonce)
    nonce_attr = f' nonce="{html.escape(csp_nonce)}"' if csp_nonce else ""

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
    <style{nonce_attr}>
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
    <script{nonce_attr}>
      if (!{str(bool(error or not code)).lower()}) {{
        window.location.href = {target_js};
      }}
    </script>
  </body>
</html>
"""
    return HTMLResponse(html_body)


@router.delete(
    "/google/accounts/{google_account_id}",
    dependencies=[Depends(request_guard.authorize)],
)
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
    account = account_result.data

    if account and account["user_id"] == user_id:
        tokens = account.get("google_account_tokens")
        if tokens and tokens.get("access_token"):
            access_token = Encryption.decrypt(tokens["access_token"], user_id)
            async with httpx.AsyncClient() as client:
                await client.post(
                    "https://oauth2.googleapis.com/revoke", data={"token": access_token}
                )

        delete_result = (
            supabase.table("google_accounts")
            .delete()
            .eq("id", str(google_account_id))
            .execute()
        )

        if delete_result.data:
            logger.info("Deleted Google account %s for user %s", google_account_id, user_id)
            return {"success": True, "message": "Google account disconnected"}

        raise HTTPException(status_code=500, detail="Failed to delete account")

    if account:
        raise HTTPException(status_code=403, detail="Access denied")

    raise HTTPException(status_code=404, detail="Google account not found")
