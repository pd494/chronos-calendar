import hashlib
import time
from datetime import datetime
from typing import Literal

from fastapi import Response
from supabase import Client

from app.config import get_settings

# Supabase access token lifetime in milliseconds.
ACCESS_TOKEN_EXPIRY_MS = 60 * 60 * 1000


def _cookie_settings_kwargs() -> dict[str, str | bool | None]:
    settings = get_settings()
    return {
        "secure": settings.COOKIE_SECURE,
        "samesite": settings.COOKIE_SAMESITE,
        "domain": settings.COOKIE_DOMAIN,
        "path": "/",
    }


def set_cookie(
    response: Response,
    *,
    key: str,
    value: str,
    max_age: int,
    httponly: bool,
) -> None:
    response.set_cookie(
        key=key,
        value=value,
        max_age=max_age,
        httponly=httponly,
        **_cookie_settings_kwargs(),
    )


def delete_cookie(response: Response, *, key: str) -> None:
    response.delete_cookie(key=key, **_cookie_settings_kwargs())

def get_expires_at() -> int:
    return int(time.time() * 1000) + ACCESS_TOKEN_EXPIRY_MS


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def revoke_token(
    supabase: Client,
    token: str,
    token_type: Literal["access", "refresh"],
    user_id: str,
    expires_at: datetime | None = None,
) -> None:
    token_hash = hash_token(token)
    supabase.table("revoked_sessions").upsert(
        {
            "token_hash": token_hash,
            "token_type": token_type,
            "user_id": user_id,
            "expires_at": expires_at.isoformat() if expires_at else None,
        },
        on_conflict="token_hash",
    ).execute()


def is_token_revoked(supabase: Client, token: str) -> bool:
    token_hash = hash_token(token)
    result = (
        supabase.table("revoked_sessions")
        .select("id")
        .eq("token_hash", token_hash)
        .limit(1)
        .execute()
    )
    return bool(result.data)
