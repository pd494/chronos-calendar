import logging
from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request, status
from gotrue.errors import AuthApiError
from postgrest.exceptions import APIError as PostgrestAPIError
from supabase import Client

from app.config import get_settings
from app.core.supabase import SupabaseClient

Row = dict[str, Any]


def first_row(data: Any) -> Row | None:
    if isinstance(data, list) and len(data) > 0:
        return data[0]
    return None

logger = logging.getLogger(__name__)

settings = get_settings()


async def get_current_user(request: Request) -> Row:
    access_token = request.cookies.get(settings.SESSION_COOKIE_NAME) or _extract_bearer_token(request)
    request_id = getattr(request.state, "request_id", None)

    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )

    try:
        supabase = SupabaseClient.get_client()
        user_response = supabase.auth.get_user(access_token)

        if not user_response or not user_response.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid session"
            )

        user = user_response.user
        user_row = (
            supabase.table("users")
            .select("*")
            .eq("id", user.id)
            .maybe_single()
            .execute()
        )

        if user_row:
            existing_user = first_row(user_row.data)
            if existing_user:
                return existing_user

        user_data: Row = {
            "id": user.id,
            "email": user.email or "",
            "name": user.user_metadata.get("name") if user.user_metadata else None,
            "avatar_url": user.user_metadata.get("avatar_url") if user.user_metadata else None,
        }
        insert_result = supabase.table("users").upsert(user_data).execute()
        inserted = first_row(insert_result.data)
        if inserted:
            return inserted
        return user_data

    except HTTPException:
        raise
    except AuthApiError as e:
        logger.error(
            "Supabase auth error: %s (code=%s, request_id=%s)",
            e.message,
            e.code,
            request_id,
            exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed"
        )
    except PostgrestAPIError as e:
        logger.error(
            "Database error during auth: %s (request_id=%s)",
            str(e),
            request_id,
            exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed"
        )
    except Exception as e:
        logger.exception("Unexpected auth error (request_id=%s): %s", request_id, e)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed"
        )


def get_supabase_dep():
    return SupabaseClient.get_client()


def _extract_bearer_token(request: Request) -> str | None:
    auth_header = request.headers.get("authorization")
    if not auth_header:
        return None
    parts = auth_header.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


CurrentUser = Annotated[dict, Depends(get_current_user)]
SupabaseClientDep = Annotated[Client, Depends(get_supabase_dep)]
