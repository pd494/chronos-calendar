import base64
import hmac
import logging
import secrets
import time
import uuid

from fastapi import HTTPException
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
ALLOWED_SEC_FETCH_SITES = {"same-origin", "same-site", "none"}
ALLOWED_SEC_FETCH_MODES = {"cors", "same-origin"}
ALLOWED_SEC_FETCH_DESTS = {"empty"}


class RequestGuardMiddleware(BaseHTTPMiddleware):
    def __init__(self, app=None):
        if app is not None:
            super().__init__(app)
        self.settings = get_settings()

    def authorize(self, request: Request) -> None:
        path = request.url.path
        is_mutating = request.method in MUTATING_METHODS

        if not is_mutating and path != SYNC_STREAM_PATH:
            return

        origin = request.headers.get("origin")
        if origin and origin not in self.settings.cors_origins:
            raise HTTPException(status_code=403, detail="Invalid origin")

        has_auth_cookie = bool(
            request.cookies.get(self.settings.SESSION_COOKIE_NAME)
            or request.cookies.get(self.settings.REFRESH_COOKIE_NAME)
        )

        if has_auth_cookie:
            sec_fetch_site = request.headers.get("sec-fetch-site")
            if sec_fetch_site and sec_fetch_site not in ALLOWED_SEC_FETCH_SITES:
                raise HTTPException(status_code=403, detail="Blocked by Fetch Metadata policy")
            sec_fetch_mode = request.headers.get("sec-fetch-mode")
            if sec_fetch_mode and sec_fetch_mode not in ALLOWED_SEC_FETCH_MODES:
                raise HTTPException(status_code=403, detail="Blocked by Fetch Metadata policy")
            sec_fetch_dest = request.headers.get("sec-fetch-dest")
            if sec_fetch_dest and sec_fetch_dest not in ALLOWED_SEC_FETCH_DESTS:
                raise HTTPException(status_code=403, detail="Blocked by Fetch Metadata policy")

            csrf_cookie = get_csrf_cookie_token(request)
            csrf_request_header = get_csrf_request_token(request)

            if not csrf_cookie or not csrf_request_header or not hmac.compare_digest(csrf_cookie, csrf_request_header):
                raise HTTPException(status_code=403, detail="Invalid CSRF token")

            if not validate_csrf_token(token=csrf_request_header, secret=self.settings.CSRF_SECRET_KEY):
                logger.warning("security.reject csrf_invalid path=%s method=%s", request.url.path, request.method)
                raise HTTPException(status_code=403, detail="Invalid CSRF token")

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        try:
            self.authorize(request)
        except HTTPException as exc:
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
        return await call_next(request)


request_guard = RequestGuardMiddleware()

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request.state.request_id = str(uuid.uuid4())
        request.state.csp_nonce = base64.b64encode(secrets.token_bytes(16)).decode("ascii").rstrip("=")
        start = time.monotonic()

        response = await call_next(request)

        duration_ms = (time.monotonic() - start) * 1000
        logger.info("%s %s %s %.0fms", request.method, request.url.path, response.status_code, duration_ms)

        self._apply_headers(request, response)
        return response

    def _apply_headers(self, request: Request, response: Response) -> None:
        response.headers.update({
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "X-XSS-Protection": "1; mode=block",
            "X-Request-ID": request.state.request_id,
            "Referrer-Policy": "strict-origin-when-cross-origin",
            "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
        })

        if get_settings().ENVIRONMENT != "production":
            return

        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        if response.headers.get("content-type", "").startswith("text/html"):
            nonce = request.state.csp_nonce
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; "
                f"script-src 'self' 'nonce-{nonce}' https://apis.google.com; "
                f"style-src 'self' 'nonce-{nonce}' https://fonts.googleapis.com; "
                "font-src 'self' https://fonts.gstatic.com; "
                "img-src 'self' data: https:; "
                "connect-src 'self' https://*.supabase.co https://apis.google.com https://accounts.google.com; "
                "frame-src https://accounts.google.com; "
                "object-src 'none'; "
                "base-uri 'self';"
            )
