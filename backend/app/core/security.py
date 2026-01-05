import logging
from fastapi import Request, HTTPException, status, Depends
from typing import Annotated
from app.core.supabase import get_supabase_client
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

def _extract_bearer_token(request: Request) -> str | None:
    auth_header = request.headers.get("authorization")
    if not auth_header:
        return None
    parts = auth_header.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None

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

CurrentUser = Annotated[dict, Depends(get_current_user)]
