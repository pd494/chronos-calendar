from datetime import timedelta

import httpx


WEBHOOK_CHANNEL_BUFFER_HOURS = 1


class GoogleCalendarConfig:
    TOKEN_REFRESH_BUFFER = timedelta(minutes=5)
    MAX_RETRIES = 5
    BASE_DELAY_SECONDS = 1.0
    MAX_CONCURRENT_PER_ACCOUNT = 3
    REQUEST_TIMEOUT = httpx.Timeout(30.0, connect=10.0)
    QUOTA_ERROR_REASONS = frozenset({
        "userRateLimitExceeded",
        "rateLimitExceeded",
        "quotaExceeded",
    })
