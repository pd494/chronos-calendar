import logging
from typing import Annotated

from fastapi import Request, HTTPException, status, Depends

from app.config import get_settings
from app.core.supabase import get_supabase_client
from app.calendar.helpers import get_google_calendar, get_google_account

logger = logging.getLogger(__name__)
settings = get_settings()


async def get_current_user(request: Request):
    access_token = request.cookies.get(settings.SESSION_COOKIE_NAME) or _extract_bearer_token(request)

    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )

    try:
        supabase = get_supabase_client()
        user_response = supabase.auth.get_user(access_token)

        if not user_response.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid session"
            )

        user_data = (
            supabase.table("users")
            .select("*")
            .eq("id", user_response.user.id)
            .single()
            .execute()
        )

        return user_data.data

    except Exception as e:
        logger.warning(f"Auth error: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed"
        )


def get_supabase_dep():
    return get_supabase_client()


def verify_calendar_access_dep(calendar_id: str, current_user: "CurrentUser"):
    calendar = get_google_calendar(calendar_id)
    if not calendar:
        raise HTTPException(status_code=404, detail="Calendar not found")

    google_account = get_google_account(calendar["google_account_id"])
    if not google_account:
        raise HTTPException(status_code=404, detail="Google account not found")

    if google_account["user_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")

    if google_account.get("needs_reauth"):
        raise HTTPException(status_code=401, detail="Google account needs reconnection")

    return calendar, google_account


def verify_account_access_dep(google_account_id: str, current_user: "CurrentUser"):
    google_account = get_google_account(google_account_id)
    if not google_account:
        raise HTTPException(status_code=404, detail="Google account not found")

    if google_account["user_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")

    if google_account.get("needs_reauth"):
        raise HTTPException(status_code=401, detail="Google account needs reconnection")

    return google_account


def _extract_bearer_token(request: Request) -> str | None:
    auth_header = request.headers.get("authorization")
    if not auth_header:
        return None
    parts = auth_header.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


CurrentUser = Annotated[dict, Depends(get_current_user)]
SupabaseClient = Annotated[object, Depends(get_supabase_dep)]
