import hashlib
import hmac
import secrets

from starlette.requests import Request

CSRF_COOKIE_NAME = "__Host-csrf_token"
FALLBACK_CSRF_COOKIE_NAME = "csrf_token"
CSRF_HEADER_NAME = "X-CSRF-Token"
CSRF_EXEMPT_PATHS = {
    "/auth/callback",
    "/calendar/webhook",
}


def get_csrf_cookie_name(settings) -> str:
    if settings.COOKIE_SECURE and settings.COOKIE_DOMAIN is None:
        return CSRF_COOKIE_NAME
    return FALLBACK_CSRF_COOKIE_NAME


def get_csrf_binding(session_token: str | None, refresh_token: str | None) -> str | None:
    return refresh_token or session_token


def get_csrf_binding_from_request(request: Request, settings) -> str | None:
    session_token = request.cookies.get(settings.SESSION_COOKIE_NAME)
    refresh_token = request.cookies.get(settings.REFRESH_COOKIE_NAME)
    return get_csrf_binding(session_token, refresh_token)


def _build_signature(secret: str, binding: str, nonce: str) -> str:
    message = f"{len(binding)}!{binding}!{nonce}"
    digest = hmac.new(
        secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    )
    return digest.hexdigest()


def generate_signed_csrf_token(binding: str, secret: str) -> str:
    nonce = secrets.token_hex(32)
    signature = _build_signature(secret, binding, nonce)
    return f"{nonce}.{signature}"


def is_valid_signed_csrf_token(token: str, binding: str, secret: str) -> bool:
    if not token or "." not in token:
        return False
    nonce, signature = token.split(".", 1)
    if not nonce or not signature:
        return False
    expected_signature = _build_signature(secret, binding, nonce)
    return hmac.compare_digest(expected_signature, signature)
