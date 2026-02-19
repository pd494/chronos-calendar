import logging
import time
import uuid
import hmac

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.config import get_settings
from app.core.csrf import (
    CSRF_EXEMPT_PATHS,
    CSRF_HEADER_NAME,
    get_csrf_binding_from_request,
    get_csrf_cookie_name,
    is_valid_signed_csrf_token,
)

logger = logging.getLogger(__name__)

MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
ORIGIN_EXEMPT_PATHS = {"/calendar/webhook"}


class OriginValidationMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method in MUTATING_METHODS:
            path = request.url.path
            if path in ORIGIN_EXEMPT_PATHS:
                return await call_next(request)
            origin = request.headers.get("origin")
            if not origin:
                return JSONResponse(status_code=403, content={"detail": "Origin header required"})
            settings = get_settings()
            if origin not in settings.cors_origins:
                return JSONResponse(status_code=403, content={"detail": "Invalid origin"})
            if path in CSRF_EXEMPT_PATHS:
                return await call_next(request)

            csrf_binding = get_csrf_binding_from_request(request, settings)
            if not csrf_binding:
                return await call_next(request)

            csrf_cookie = request.cookies.get(get_csrf_cookie_name(settings))
            csrf_header = request.headers.get(CSRF_HEADER_NAME)
            if not csrf_cookie or not csrf_header:
                return JSONResponse(status_code=403, content={"detail": "CSRF token required"})
            if not hmac.compare_digest(csrf_cookie, csrf_header):
                return JSONResponse(status_code=403, content={"detail": "CSRF token mismatch"})
            if not is_valid_signed_csrf_token(csrf_cookie, csrf_binding, settings.csrf_secret):
                return JSONResponse(status_code=403, content={"detail": "Invalid CSRF token"})
        return await call_next(request)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
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
            # TODO: Migrate away from 'unsafe-inline' by implementing nonce-based CSP:
            # 1. Generate a random nonce per request and pass it to templates
            # 2. Add nonce attribute to all inline scripts: <script nonce="...">
            # 3. Replace 'unsafe-inline' with 'nonce-{value}' in script-src
            # 4. For styles, consider using a CSS-in-JS solution that supports nonces
            #    or extract inline styles to external stylesheets
            #
            # 'unsafe-inline' is required for:
            # - React's development error overlay
            # - Some third-party libraries that inject inline scripts/styles
            # - Google APIs integration scripts
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; "
                "script-src 'self' 'unsafe-inline' https://apis.google.com; "
                "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
                "font-src 'self' https://fonts.gstatic.com; "
                "img-src 'self' data: https:; "
                "connect-src 'self' https://*.supabase.co https://apis.google.com https://accounts.google.com; "
                "frame-src https://accounts.google.com; "
                "object-src 'none'; "
                "base-uri 'self';"
            )

        return response
