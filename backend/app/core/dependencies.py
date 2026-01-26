import logging
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from supabase_auth.errors import AuthApiError

from app.config import get_settings
from app.core.supabase import get_supabase_client
from app.core.users import get_user

logger = logging.getLogger(__name__)


async def get_current_user(request: Request) -> dict:
    settings = get_settings()
    access_token = request.cookies.get(settings.SESSION_COOKIE_NAME)

    if not access_token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        supabase = get_supabase_client()
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


CurrentUser = Annotated[dict, Depends(get_current_user)]
