"""Tests for calendar helpers - pure functions and async retry logic."""
import asyncio
import sys
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.calendar.constants import GoogleCalendarConfig
from app.calendar.helpers import (
    GoogleAPIError,
    _cleanup_cache,
    _normalize_recurrence,
    decrypt_event,
    extract_error_reason,
    format_sse,
    parse_expires_at,
    proximity_sort_events,
    token_needs_refresh,
    transform_events,
    with_retry,
)
from app.core.encryption import Encryption

USER_ID = "test-user-helpers"


def _make_response(status_code: int, json_body=None, text="") -> httpx.Response:
    response = MagicMock(spec=httpx.Response)
    response.status_code = status_code
    response.text = text
    if json_body is not None:
        response.json.return_value = json_body
    else:
        response.json.side_effect = ValueError("No JSON")
    return response


def test_google_api_error_attributes():
    err = GoogleAPIError(429, "Rate limited", retryable=True)
    assert err.status_code == 429
    assert err.message == "Rate limited"
    assert err.retryable is True
    assert "429" in str(err)

    err_default = GoogleAPIError(400, "Bad request")
    assert err_default.retryable is False


def test_extract_error_reason():
    valid = _make_response(403, {"error": {"errors": [{"reason": "rateLimitExceeded"}]}})
    assert extract_error_reason(valid) == "rateLimitExceeded"

    empty_errors = _make_response(403, {"error": {"errors": []}})
    assert extract_error_reason(empty_errors) == ""

    no_json = _make_response(500)
    assert extract_error_reason(no_json) == ""


def test_token_needs_refresh():
    expired = datetime.now(timezone.utc) - timedelta(hours=1)
    assert token_needs_refresh(expired) is True

    fresh = datetime.now(timezone.utc) + timedelta(hours=1)
    assert token_needs_refresh(fresh) is False

    within_buffer = datetime.now(timezone.utc) + timedelta(minutes=3)
    assert token_needs_refresh(within_buffer) is True


def test_parse_expires_at():
    iso = "2025-06-15T10:30:00+00:00"
    result = parse_expires_at(iso)
    assert result.year == 2025
    assert result.month == 6
    assert result.tzinfo is not None

    z_suffix = "2025-06-15T10:30:00Z"
    result_z = parse_expires_at(z_suffix)
    assert result_z == result


def test_normalize_recurrence():
    assert _normalize_recurrence(None) is None
    assert _normalize_recurrence([]) is None
    rules = ["RRULE:FREQ=WEEKLY;BYDAY=MO"]
    assert _normalize_recurrence(rules) == rules


def test_proximity_sort_events():
    now = datetime.now(timezone.utc)
    events = [
        {"start_datetime": {"dateTime": (now + timedelta(days=30)).isoformat()}},
        {"start_datetime": {"dateTime": (now + timedelta(days=1)).isoformat()}},
        {"start_datetime": {"dateTime": (now - timedelta(days=2)).isoformat()}},
    ]
    sorted_events = proximity_sort_events(events)
    dates = [
        datetime.fromisoformat(e["start_datetime"]["dateTime"])
        for e in sorted_events
    ]
    distances = [abs((d.replace(hour=0, minute=0, second=0, microsecond=0) - now.replace(hour=0, minute=0, second=0, microsecond=0)).days) for d in dates]
    assert distances == sorted(distances)


def test_transform_events_encryption():
    raw_events = [
        {
            "id": "evt_001",
            "summary": "Team Standup",
            "description": "Daily sync",
            "location": "Room 42",
            "start": {"dateTime": "2025-06-15T09:00:00Z"},
            "end": {"dateTime": "2025-06-15T09:30:00Z"},
            "status": "confirmed",
            "recurrence": ["RRULE:FREQ=DAILY"],
        },
        {
            "id": "evt_002",
            "start": {"date": "2025-06-16"},
            "end": {"date": "2025-06-17"},
            "status": "cancelled",
        },
    ]

    result = transform_events(raw_events, "cal-id", "acct-id", USER_ID)
    assert len(result) == 2

    evt1 = result[0]
    assert evt1["google_event_id"] == "evt_001"
    assert evt1["source"] == "google"
    assert Encryption.decrypt(evt1["summary"], USER_ID) == "Team Standup"
    assert Encryption.decrypt(evt1["description"], USER_ID) == "Daily sync"
    assert Encryption.decrypt(evt1["location"], USER_ID) == "Room 42"
    assert evt1["recurrence"] == ["RRULE:FREQ=DAILY"]
    assert evt1["is_all_day"] is False
    assert evt1["embedding_pending"] is True

    evt2 = result[1]
    assert Encryption.decrypt(evt2["summary"], USER_ID) == "(No title)"
    assert evt2["description"] is None
    assert evt2["location"] is None
    assert evt2["is_all_day"] is True
    assert evt2["all_day_date"] == "2025-06-16"
    assert evt2["embedding_pending"] is False


def test_decrypt_event_frontend_format():
    encrypted_summary = Encryption.encrypt("My Event", USER_ID)
    encrypted_desc = Encryption.encrypt("Details here", USER_ID)
    db_event = {
        "google_event_id": "evt_100",
        "google_calendar_id": "cal-1",
        "summary": encrypted_summary,
        "description": encrypted_desc,
        "location": None,
        "start_datetime": {"dateTime": "2025-06-15T10:00:00Z"},
        "end_datetime": {"dateTime": "2025-06-15T11:00:00Z"},
        "status": "confirmed",
        "visibility": "default",
        "transparency": "opaque",
        "recurrence": None,
        "recurring_event_id": None,
        "color_id": "1",
        "created_at": "2025-06-10",
        "updated_at": "2025-06-12",
        "attendees": [{"email": "a@b.com"}],
        "organizer": {"email": "o@b.com"},
        "reminders": None,
        "conference_data": None,
        "html_link": "https://calendar.google.com/event/123",
        "ical_uid": "uid@google.com",
        "original_start_time": None,
    }

    result = decrypt_event(db_event, USER_ID)
    assert result["id"] == "evt_100"
    assert result["summary"] == "My Event"
    assert result["description"] == "Details here"
    assert result["location"] is None
    assert result["calendarId"] == "cal-1"
    assert result["colorId"] == "1"

    db_result = decrypt_event(db_event, USER_ID, output_format="db")
    assert db_result["summary"] == "My Event"
    assert db_result["google_event_id"] == "evt_100"


def test_format_sse():
    output = format_sse("sync", {"status": "done"})
    assert output.startswith("event: sync\n")
    assert '"status": "done"' in output
    assert output.endswith("\n\n")


def test_cleanup_cache_respects_active():
    cache: OrderedDict[str, int] = OrderedDict()
    for i in range(10):
        cache[f"key-{i}"] = i

    _cleanup_cache(cache, max_size=5, check_active=lambda v: v >= 7)
    assert len(cache) <= 7
    assert "key-7" in cache
    assert "key-8" in cache
    assert "key-9" in cache


async def test_with_retry_non_retryable_raises_immediately():
    call_count = 0

    async def failing():
        nonlocal call_count
        call_count += 1
        raise GoogleAPIError(403, "Access forbidden", retryable=False)

    with pytest.raises(GoogleAPIError) as exc_info:
        await with_retry(failing, "test-account")
    assert exc_info.value.status_code == 403
    assert call_count == 1


async def test_with_retry_succeeds_after_transient_failure():
    attempts = 0

    async def flaky():
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise GoogleAPIError(429, "Rate limited", retryable=True)
        return {"ok": True}

    result = await with_retry(flaky, "test-account-retry")
    assert result == {"ok": True}
    assert attempts == 3
