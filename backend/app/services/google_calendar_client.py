from datetime import datetime, timezone, timedelta
import httpx
import asyncio
import random
from app.config import get_settings
from supabase import create_client, Client
import os
import base64
import hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

settings = get_settings()
BUFFER = timedelta(minutes=5)
GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3"
MAX_RETRIES = 5
BASE_DELAY = 1.0

SALT_LENGTH = 16
IV_LENGTH = 12
KEY_LENGTH = 32

_client: Client | None = None

def get_supabase_client() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)
    return _client

def _derive_key(user_id: str, salt: bytes) -> bytes:
    master_key = settings.ENCRYPTION_MASTER_KEY.encode()
    key_material = master_key + user_id.encode()
    return hashlib.pbkdf2_hmac('sha256', key_material, salt, 100000, dklen=KEY_LENGTH)

def encrypt(plaintext: str, user_id: str) -> str:
    salt = os.urandom(SALT_LENGTH)
    iv = os.urandom(IV_LENGTH)
    key = _derive_key(user_id, salt)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(iv, plaintext.encode(), None)
    combined = salt + iv + ciphertext
    return base64.b64encode(combined).decode()

def decrypt(encrypted_data: str, user_id: str) -> str:
    combined = base64.b64decode(encrypted_data)
    salt = combined[:SALT_LENGTH]
    iv = combined[SALT_LENGTH:SALT_LENGTH + IV_LENGTH]
    ciphertext = combined[SALT_LENGTH + IV_LENGTH:]
    key = _derive_key(user_id, salt)
    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(iv, ciphertext, None)
    return plaintext.decode()

def get_google_account_tokens(google_account_id: str) -> dict:
    client = get_supabase_client()
    result = (
        client.table("google_account_tokens")
        .select("access_token, refresh_token, expires_at")
        .eq("google_account_id", google_account_id)
        .single()
        .execute()
    )
    return result.data

def update_google_account_tokens(google_account_id: str, access_token: str, expires_at: str):
    client = get_supabase_client()
    (
        client.table("google_account_tokens")
        .update({"access_token": access_token, "expires_at": expires_at})
        .eq("google_account_id", google_account_id)
        .execute()
    )

def mark_needs_reauth(google_account_id: str):
    client = get_supabase_client()
    (
        client.table("google_accounts")
        .update({"needs_reauth": True})
        .eq("id", google_account_id)
        .execute()
    )

def update_calendar_sync_state(calendar_id: str, sync_token: str):
    client = get_supabase_client()
    (
        client.table("calendar_sync_state")
        .upsert({
            "calendar_id": calendar_id,
            "sync_token": sync_token
        }, on_conflict="calendar_id")
        .execute()
    )

def get_calendar_sync_state(calendar_id: str) -> dict | None:
    client = get_supabase_client()
    result = (
        client.table("calendar_sync_state")
        .select("sync_token")
        .eq("calendar_id", calendar_id)
        .maybe_single()
        .execute()
    )
    return result.data

class GoogleAPIError(Exception):
    def __init__(self, status_code: int, message: str, retryable: bool = False):
        self.status_code = status_code
        self.message = message
        self.retryable = retryable
        super().__init__(f"Google API Error {status_code}: {message}")

def handle_google_response(response: httpx.Response, google_account_id: str):
    if response.status_code == 200:
        return response.json()

    if response.status_code == 401:
        mark_needs_reauth(google_account_id)
        raise GoogleAPIError(401, "Token revoked, needs reauth")

    if response.status_code == 403:
        raise GoogleAPIError(403, "Access forbidden")

    if response.status_code == 429:
        raise GoogleAPIError(429, "Rate limited", retryable=True)

    if response.status_code == 410:
        raise GoogleAPIError(410, "Sync token expired")

    if response.status_code >= 500:
        raise GoogleAPIError(response.status_code, "Google server error", retryable=True)

    raise GoogleAPIError(response.status_code, response.text)

async def with_retry(coro_func, google_account_id: str):
    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            return await coro_func()
        except GoogleAPIError as e:
            if not e.retryable:
                raise
            last_error = e
            delay = BASE_DELAY * (2 ** attempt) + random.uniform(-0.5, 0.5)
            await asyncio.sleep(delay)
    raise last_error

def get_decrypted_tokens(user_id: str, google_account_id: str):
    row = get_google_account_tokens(google_account_id)
    return {
        "access_token": decrypt(row["access_token"], user_id),
        "refresh_token": decrypt(row["refresh_token"], user_id),
        "expires_at": row["expires_at"]
    }

def get_valid_access_token(user_id: str, google_account_id: str):
    tokens = get_decrypted_tokens(user_id, google_account_id)
    expires_at = datetime.fromisoformat(tokens["expires_at"].replace("Z", "+00:00"))
    if expires_at < datetime.now(timezone.utc) + BUFFER:
        return refresh_access_token(user_id, google_account_id, tokens["refresh_token"])
    return tokens["access_token"]

def refresh_access_token(user_id: str, google_account_id: str, refresh_token: str):
    response = httpx.post(
        "https://oauth2.googleapis.com/token",
        data={
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token"
        }
    )

    if response.status_code != 200:
        raise Exception(f"Failed to refresh token: {response.text}")

    token_data = response.json()
    new_access_token = token_data["access_token"]
    expires_in = token_data.get("expires_in", 3600)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

    update_google_account_tokens(
        google_account_id,
        encrypt(new_access_token, user_id),
        expires_at.isoformat()
    )

    return new_access_token

async def list_calendars(user_id: str, google_account_id: str):
    access_token = get_valid_access_token(user_id, google_account_id)

    async def _request():
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{GOOGLE_CALENDAR_API}/users/me/calendarList",
                headers={"Authorization": f"Bearer {access_token}"}
            )
        return handle_google_response(response, google_account_id)

    return await with_retry(_request, google_account_id)

async def fetch_events(user_id: str, google_account_id: str, calendar_id: str, time_min: str = None, time_max: str = None, page_token: str = None, sync_token: str = None):
    access_token = get_valid_access_token(user_id, google_account_id)
    params = {
        "singleEvents": "true",
        "maxResults": 250
    }
    if time_min:
        params["timeMin"] = time_min
        params["orderBy"] = "startTime"
    if time_max:
        params["timeMax"] = time_max
    if page_token:
        params["pageToken"] = page_token
    if sync_token:
        params["syncToken"] = sync_token

    async def _request():
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{GOOGLE_CALENDAR_API}/calendars/{calendar_id}/events",
                headers={"Authorization": f"Bearer {access_token}"},
                params=params
            )
        return handle_google_response(response, google_account_id)

    return await with_retry(_request, google_account_id)

#   HELPERS
def get_google_calendar(calendar_id: str) -> dict | None:
    client = get_supabase_client()
    result = (
        client
        .table("google_calendars")
        .select("*")
        .eq("id", calendar_id)
        .maybe_single()
        .execute()
    )
    return result.data
    


def get_google_account(google_account_id: str) -> dict | None:
    client = get_supabase_client()
    result = (
        client
        .table("google_accounts")
        .select("*")
        .eq("id", google_account_id)
        .maybe_single()
        .execute()
    )
    return result.data

def get_calendars_for_account(google_account_id: str) -> list[dict]:
    client = get_supabase_client()
    result = (
        client
        .table("google_calendars")
        .select("*")
        .eq("google_account_id", google_account_id)
        .execute()
    )
    return result.data

def clear_calendar_sync_state(calendar_id: str):
    client = get_supabase_client()
    (
        client
        .table("calendar_sync_state")
        .update({"sync_token": None})
        .eq("calendar_id", calendar_id)
        .execute()
    )

def get_fetched_ranges(calendar_id: str) -> list[dict]:
    client = get_supabase_client()
    result = (
        client
        .table("calendar_fetched_ranges")
        .select("time_min, time_max")
        .eq("calendar_id", calendar_id)
        .execute()
    )
    return result.data

def is_range_covered(calendar_id: str, time_min: str, time_max: str) -> bool:
    ranges = get_fetched_ranges(calendar_id)
    for r in ranges:
        if r["time_min"] <= time_min and r["time_max"] >= time_max:
            return True
    return False


