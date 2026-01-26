import logging
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from supabase_auth.errors import AuthApiError
from app.config import get_settings
from app.core.supabase import get_supabase_client
from app.core.users import get_or_create_user

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


async def get_current_user(request: Request) -> dict:
    access_token = request.cookies.get(settings.SESSION_COOKIE_NAME) or _extract_bearer_token(request)

    if not access_token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        supabase = get_supabase_client()
        user_response = supabase.auth.get_user(access_token)

        if not user_response.user:
            raise HTTPException(status_code=401, detail="Invalid session")

        user = user_response.user
        return get_or_create_user(
            supabase,
            user.id,
            user.email,
            user.user_metadata,
        )

    except AuthApiError as e:
        logger.warning("Auth error: %s (code=%s)", e.message, e.code)
        raise HTTPException(status_code=401, detail="Authentication failed")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error during authentication: %s", e)
        raise HTTPException(status_code=500, detail="Authentication service error")


CurrentUser = Annotated[dict, Depends(get_current_user)]
