import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware

from app.calendar.gcal import close_http_client
from app.config import get_settings
from app.core.logging import setup_logging
from app.core.security import SecurityHeadersMiddleware
from app.core.supabase import SupabaseClient
from app.routers import auth, todos, calendar, settings as settings_router, chat

settings = get_settings()

setup_logging(is_production=settings.ENVIRONMENT == "production")

logger = logging.getLogger(__name__)


CSRF_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
CSRF_EXEMPT_PATHS = {"/calendar/google/webhook", "/calendar/cron/renew-channels", "/auth/callback"}


class CSRFMiddleware(BaseHTTPMiddleware):
    """
    CSRF protection via defense-in-depth strategy:

    1. SameSite=Lax cookies: Browser won't send cookies on cross-origin POST requests
    2. Origin header validation: Rejects requests from untrusted origins
    3. Referer header check: Additional validation when Origin is missing

    This combined approach protects against CSRF without requiring tokens,
    since the session cookie (SameSite=Lax) won't be sent on cross-origin
    state-changing requests anyway.
    """
    async def dispatch(self, request: Request, call_next):
        if request.method in CSRF_SAFE_METHODS:
            return await call_next(request)

        if request.url.path in CSRF_EXEMPT_PATHS:
            return await call_next(request)

        origin = request.headers.get("origin")
        referer = request.headers.get("referer")

        if origin:
            if origin not in settings.cors_origins:
                return JSONResponse(status_code=403, content={"detail": "Invalid origin"})
        elif referer:
            from urllib.parse import urlparse
            referer_origin = f"{urlparse(referer).scheme}://{urlparse(referer).netloc}"
            if referer_origin not in settings.cors_origins:
                return JSONResponse(status_code=403, content={"detail": "Invalid referer"})

        return await call_next(request)


class RequestTimingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.time()
        response = await call_next(request)
        duration_ms = int((time.time() - start) * 1000)
        logger.info(
            "[REQUEST] %s %s status=%d duration=%dms",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
        )
        return response


def get_user_identifier(request: Request) -> str:
    if hasattr(request.state, "user_id"):
        return str(request.state.user_id)
    return get_remote_address(request)


limiter = Limiter(key_func=get_user_identifier)


async def rate_limit_handler(request: Request, exc: Exception) -> Response:
    return JSONResponse(
        status_code=429,
        content={"detail": "Rate limit exceeded"},
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Application startup")
    yield
    logger.info("Application shutdown")
    await close_http_client()


app = FastAPI(
    title="Chronos Calendar API",
    version="1.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_handler)

app.add_middleware(RequestTimingMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(CSRFMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID", "X-CSRF-Token"],
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(todos.router, prefix="/todos", tags=["todos"])
app.include_router(calendar.router, prefix="/calendar", tags=["calendar"])
app.include_router(settings_router.router, prefix="/settings", tags=["settings"])
app.include_router(chat.router, prefix="/chat", tags=["chat"])


@app.get("/")
@limiter.limit(settings.RATE_LIMIT_API)
async def root(request: Request):
    return {"message": "Chronos Calendar API"}


@app.get("/health")
async def health():
    try:
        supabase = SupabaseClient.get_client()
        supabase.table("users").select("id").limit(1).execute()
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        logger.error("Health check failed: %s", e)
        return JSONResponse(
            status_code=503,
            content={"status": "unhealthy", "database": "disconnected"},
        )
