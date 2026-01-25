import logging
import traceback

from fastapi import HTTPException

from app.calendar.helpers import GoogleAPIError

logger = logging.getLogger(__name__)


SAFE_ERROR_MESSAGES = {
    400: "Invalid request",
    401: "Authentication required",
    403: "Access denied",
    404: "Resource not found",
    429: "Too many requests, please try again later",
    500: "An internal error occurred",
    502: "Service temporarily unavailable",
    503: "Service temporarily unavailable",
    504: "Request timed out",
}


def get_safe_message(status_code: int, fallback: str = "An error occurred") -> str:
    return SAFE_ERROR_MESSAGES.get(status_code, fallback)


def handle_google_api_error(e: GoogleAPIError, operation: str = "operation"):
    logger.error(
        "Google API error during %s: status=%d, message=%s",
        operation, e.status_code, e.message
    )

    if e.status_code == 401:
        raise HTTPException(status_code=401, detail="Google account needs reconnection")
    if e.status_code == 429:
        raise HTTPException(status_code=429, detail=get_safe_message(429))
    if e.status_code >= 500:
        raise HTTPException(status_code=502, detail=get_safe_message(502))

    raise HTTPException(status_code=500, detail=get_safe_message(500))


def handle_unexpected_error(e: Exception, operation: str = "operation"):
    logger.error(
        "Unexpected error during %s: %s\n%s",
        operation, str(e), traceback.format_exc()
    )
    raise HTTPException(status_code=500, detail=get_safe_message(500))
