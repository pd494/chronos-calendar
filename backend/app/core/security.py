import base64
import hmac
import logging
import secrets
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.config import get_settings
from app.core.csrf import (
    SYNC_STREAM_PATH,
    get_csrf_cookie_token,
    get_csrf_request_token,
    validate_csrf_token,
)

logger = logging.getLogger(__name__)

MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
ORIGIN_EXEMPT_PATHS = {"/calendar/webhook"}
CSRF_EXEMPT_PATHS = {"/calendar/webhook", "/auth/web/callback"}
FETCH_METADATA_EXEMPT_PATHS = {"/calendar/webhook"}


def _has_auth_cookie(request: Request) -> bool:
    settings = get_settings()
    cookies = request.cookies
    auth_cookie_names = (settings.SESSION_COOKIE_NAME, settings.REFRESH_COOKIE_NAME)
    return any(name in cookies and cookies[name] for name in auth_cookie_names)


def _is_mutating_request(request: Request) -> bool:
    return request.method in MUTATING_METHODS


class OriginValidationMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path
        is_mutating = _is_mutating_request(request)

        if (is_mutating and path in ORIGIN_EXEMPT_PATHS) or (not is_mutating and path != SYNC_STREAM_PATH):
            return await call_next(request)

        origin = request.headers.get("origin")
        if not origin:
            return await call_next(request)

        settings = get_settings()
        if origin not in settings.cors_origins:
            return JSONResponse(status_code=403, content={"detail": "Invalid origin"})

        return await call_next(request)


class CSRFMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path
        is_mutating = _is_mutating_request(request)

        if (is_mutating and path in CSRF_EXEMPT_PATHS) or (not is_mutating and path != SYNC_STREAM_PATH):
            return await call_next(request)

        settings = get_settings()
        if not _has_auth_cookie(request):
            return await call_next(request)

        cookie_token = get_csrf_cookie_token(request)
        request_token = get_csrf_request_token(request)
        if not cookie_token or not request_token or not hmac.compare_digest(cookie_token, request_token):
            return JSONResponse(status_code=403, content={"detail": "Invalid CSRF token"})

        if not validate_csrf_token(token=request_token, secret=settings.CSRF_SECRET_KEY):
            logger.warning("security.reject csrf_invalid path=%s method=%s", path, request.method)
            return JSONResponse(status_code=403, content={"detail": "Invalid CSRF token"})

        return await call_next(request)


class FetchMetadataMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path
        is_mutating = _is_mutating_request(request)

        if (is_mutating and path in FETCH_METADATA_EXEMPT_PATHS) or (
            not is_mutating and path != SYNC_STREAM_PATH
        ):
            return await call_next(request)

        if not _has_auth_cookie(request):
            return await call_next(request)

        sec_fetch_site = request.headers.get("sec-fetch-site")
        if not sec_fetch_site:
            return await call_next(request)

        if sec_fetch_site not in {"same-origin", "same-site", "none"}:
            logger.warning(
                "security.reject fetch_metadata path=%s method=%s sec_fetch_site=%s",
                path,
                request.method,
                sec_fetch_site,
            )
            return JSONResponse(status_code=403, content={"detail": "Blocked by Fetch Metadata policy"})

        return await call_next(request)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        request.state.csp_nonce = base64.b64encode(secrets.token_bytes(16)).decode("ascii").rstrip("=")
        start = time.monotonic()

        response = await call_next(request)

        duration_ms = (time.monotonic() - start) * 1000
        logger.info(
            "%s %s %s %.0fms",
            request.method, request.url.path, response.status_code, duration_ms,
        )

        settings = get_settings()

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["X-Request-ID"] = request_id
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"

        if settings.ENVIRONMENT == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
            content_type = response.headers.get("content-type", "")
            if content_type.startswith("text/html"):
                csp_nonce = request.state.csp_nonce
                response.headers["Content-Security-Policy"] = (
                    "default-src 'self'; "
                    f"script-src 'self' 'nonce-{csp_nonce}' https://apis.google.com; "
                    f"style-src 'self' 'nonce-{csp_nonce}' https://fonts.googleapis.com; "
                    "font-src 'self' https://fonts.gstatic.com; "
                    "img-src 'self' data: https:; "
                    "connect-src 'self' https://*.supabase.co https://apis.google.com https://accounts.google.com; "
                    "frame-src https://accounts.google.com; "
                    "object-src 'none'; "
                    "base-uri 'self';"
                )

        return response
