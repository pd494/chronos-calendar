import hashlib
import time
from datetime import datetime
from typing import Literal

from fastapi import Response
from supabase import Client

from app.config import get_settings

settings = get_settings()

# Supabase access token lifetime in milliseconds.
ACCESS_TOKEN_EXPIRY_MS = 60 * 60 * 1000


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


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def revoke_token(
    supabase: Client,
    token: str,
    token_type: Literal["access", "refresh"],
    user_id: str | None = None,
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
