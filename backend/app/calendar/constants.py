from datetime import timedelta

import httpx


class GoogleCalendarConfig:
    TOKEN_REFRESH_BUFFER = timedelta(minutes=5)
    API_BASE_URL = "https://www.googleapis.com/calendar/v3"
    OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"
    MAX_RETRIES = 5
    BASE_DELAY_SECONDS = 1.0
    MAX_CONCURRENT_PER_ACCOUNT = 3
    REQUEST_TIMEOUT = httpx.Timeout(30.0, connect=10.0)
    QUOTA_ERROR_REASONS = frozenset({
        "userRateLimitExceeded",
        "rateLimitExceeded",
        "quotaExceeded",
    })
