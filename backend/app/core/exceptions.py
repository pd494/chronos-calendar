import logging
from fastapi import HTTPException

from app.calendar.google_client import GoogleAPIError

logger = logging.getLogger(__name__)


def handle_google_api_error(e: GoogleAPIError, operation: str = "operation") -> HTTPException:
    if e.status_code == 401:
        raise HTTPException(status_code=401, detail="Google account needs reconnection")
    if e.status_code == 429:
        raise HTTPException(status_code=429, detail="Rate limited, try again later")
    if e.status_code >= 500:
        raise HTTPException(status_code=502, detail="Google Calendar is temporarily unavailable")
    raise HTTPException(status_code=500, detail=f"{operation} failed: {e.message}")


def handle_unexpected_error(operation: str = "operation") -> HTTPException:
    logger.exception(f"Unexpected error during {operation}")
    raise HTTPException(status_code=500, detail="An unexpected error occurred")
