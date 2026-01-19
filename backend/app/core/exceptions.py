import logging
import traceback

from fastapi import HTTPException

logger = logging.getLogger(__name__)


HTTP_ERROR_MESSAGES = {
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


def get_error_message(status_code: int, fallback: str = "An error occurred") -> str:
    return HTTP_ERROR_MESSAGES.get(status_code, fallback)


def handle_unexpected_error(e: Exception, operation: str = "operation"):
    logger.error(
        "Unexpected error during %s: %s\n%s",
        operation, str(e), traceback.format_exc()
    )
    raise HTTPException(status_code=500, detail=get_error_message(500))
