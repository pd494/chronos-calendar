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


_GOOGLE_API_ERROR_MAP: dict[int, tuple[int, str]] = {
    401: (401, "Google account needs reconnection"),
    429: (429, SAFE_ERROR_MESSAGES[429]),
}


def handle_google_api_error(e: GoogleAPIError, operation: str = "operation"):
    logger.error(
        "Google API error during %s: status=%d, message=%s",
        operation, e.status_code, e.message
    )

    if e.status_code >= 500:
        raise HTTPException(status_code=502, detail=get_safe_message(502))

    status, detail = _GOOGLE_API_ERROR_MAP.get(
        e.status_code, (500, get_safe_message(500))
    )
    raise HTTPException(status_code=status, detail=detail)


def handle_unexpected_error(e: Exception, operation: str = "operation"):
    logger.error(
        "Unexpected error during %s: %s\n%s",
        operation, str(e), traceback.format_exc()
    )
    raise HTTPException(status_code=500, detail=get_safe_message(500))
