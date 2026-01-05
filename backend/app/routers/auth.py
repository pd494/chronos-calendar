import logging
from fastapi import APIRouter, Response, HTTPException, Cookie, Query
from typing import Annotated
from app.core.supabase import get_supabase_client
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
        except:
            pass

    response.delete_cookie(
        key=settings.SESSION_COOKIE_NAME,
        domain=settings.COOKIE_DOMAIN
    )

    return {"message": "Logged out"}
