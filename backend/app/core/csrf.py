import base64
import hmac
import json
import secrets
import time

from fastapi import Request, Response

from app.config import get_settings

CSRF_HEADER_NAME = "X-CSRF-Token"
settings = get_settings()

def create_csrf_token(*, secret: str, ttl_seconds: int, now_ts: int | None = None) -> str:
    # Use provided time for deterministic tests; otherwise current unix time.
    now = now_ts if now_ts is not None else int(time.time())

    # Payload includes:
    # - n: random nonce so each token is unique
    # - exp: absolute expiry time (unix seconds)
    payload = json.dumps(
        {
            "n": secrets.token_hex(16),
            "exp": now + ttl_seconds,
        },
        separators=(",", ":"),
    ).encode("utf-8")

    # Encode payload as URL-safe base64 text and strip "=" padding.
    payload_b64 = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")

    # Sign payload text with HMAC-SHA256 using the CSRF secret.
    sig = hmac.new(
        key=secret.encode("utf-8"),
        msg=payload_b64.encode("ascii"),
        digestmod="sha256",
    ).digest()

    # Encode signature as URL-safe base64 text and strip "=" padding.
    sig_b64 = base64.urlsafe_b64encode(sig).decode("ascii").rstrip("=")

    # Final token format: <payload>.<signature>
    return f"{payload_b64}.{sig_b64}"

def validate_csrf_token(*, token: str, secret: str, now_ts: int | None = None) -> bool:
    if not token:
        return False
    parts = token.split(".")
    if len(parts) != 2:
        return False
    payload_b64, sig_b64 = parts
    if not payload_b64 or not sig_b64:
        return False

    expected_sig = hmac.new(
        key=secret.encode("utf-8"),
        msg=payload_b64.encode("ascii"),
        digestmod="sha256",
    ).digest()
    expected_sig_b64 = base64.urlsafe_b64encode(expected_sig).decode("ascii").rstrip("=")
    if not hmac.compare_digest(sig_b64, expected_sig_b64):
        return False
    try:
        pad = "=" * ((4 - len(payload_b64) % 4) % 4)
        payload_json = base64.urlsafe_b64decode(payload_b64 + pad).decode("utf-8")
        payload = json.loads(payload_json)
        exp = int(payload.get("exp"))
    except (ValueError, TypeError, json.JSONDecodeError):
        return False

    now = now_ts if now_ts is not None else int(time.time())
    return exp >= now

def set_csrf_cookie(response: Response, *, token: str, max_age: int) -> None:
    response.set_cookie(
        key=settings.CSRF_COOKIE_NAME,
        value=token,
        max_age=max_age,
        httponly=False,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        domain=settings.COOKIE_DOMAIN,
        path="/",
    )


def delete_csrf_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.CSRF_COOKIE_NAME,
        domain=settings.COOKIE_DOMAIN,
        path="/",
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
    )


def get_csrf_request_token(request: Request) -> str | None:
    token = request.headers.get(CSRF_HEADER_NAME)
    return token if token else None


def get_csrf_cookie_token(request: Request) -> str | None:
    token = request.cookies.get(settings.CSRF_COOKIE_NAME)
    return token if token else None


def csrf_tokens_match(*, cookie_token: str | None, header_token: str | None) -> bool:
    if not cookie_token or not header_token:
        return False
    return hmac.compare_digest(cookie_token, header_token)
