import sys
import uuid
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from conftest import MOCK_USER
from app.calendar.helpers import GoogleAPIError
from app.core.encryption import Encryption
from app.main import app
from app.core.dependencies import get_current_user, get_http_client, verify_account_access
from app.core.supabase import get_supabase_client

USER_ID = MOCK_USER["id"]
CAL_ID = str(uuid.uuid4())
ACCT_ID = str(uuid.uuid4())

_CAL = {
    "id": CAL_ID, "google_account_id": ACCT_ID,
    "google_calendar_id": "primary@gmail.com",
    "name": "Primary", "color": "#4285f4", "is_primary": True,
}


def _plain(eid, summary="Test"):
    """Plaintext event as returned by transform_events (used for sync mocks)."""
    return {
        "google_event_id": eid, "google_calendar_id": CAL_ID,
        "google_account_id": ACCT_ID, "source": "google",
        "summary": summary,
        "description": None, "location": None,
        "start_datetime": {"dateTime": "2025-06-15T10:00:00Z"},
        "end_datetime": {"dateTime": "2025-06-15T11:00:00Z"},
        "is_all_day": False, "all_day_date": None,
        "recurrence": None, "recurring_event_id": None,
        "original_start_time": None, "status": "confirmed",
        "visibility": "default", "transparency": "opaque",
        "attendees": None, "organizer": None,
        "color_id": "#4285f4", "reminders": None,
        "conference_data": None, "html_link": None,
        "ical_uid": None, "etag": None, "embedding_pending": True,
        "created_at": "2025-01-01T00:00:00Z", "updated_at": "2025-01-02T00:00:00Z",
    }


def _db_event(eid, summary="Test"):
    """Encrypted event as stored in DB (used for read endpoint mocks)."""
    event = _plain(eid, summary)
    event["summary"] = Encryption.encrypt(summary, USER_ID)
    return event


@pytest.fixture(autouse=True)
def _reset():
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def auth():
    app.dependency_overrides[get_current_user] = lambda: MOCK_USER
    app.dependency_overrides[get_supabase_client] = lambda: MagicMock()
    app.dependency_overrides[get_http_client] = lambda: MagicMock()


# 1 — parse_calendar_ids: empty, single, multi, too-many, invalid
def test_parse_calendar_ids():
    from app.calendar.helpers import parse_calendar_ids
    from app.routers.calendar import MAX_CALENDARS_PER_SYNC

    assert parse_calendar_ids(None, MAX_CALENDARS_PER_SYNC) is None
    assert parse_calendar_ids("", MAX_CALENDARS_PER_SYNC) is None

    v = str(uuid.uuid4())
    assert parse_calendar_ids(v, MAX_CALENDARS_PER_SYNC) == [v]
    assert parse_calendar_ids(f"  {v}  ", MAX_CALENDARS_PER_SYNC) == [v]

    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    assert parse_calendar_ids(f"{a},{b}", MAX_CALENDARS_PER_SYNC) == [a, b]

    with pytest.raises(HTTPException, match="Too many"):
        parse_calendar_ids(",".join(str(uuid.uuid4()) for _ in range(MAX_CALENDARS_PER_SYNC + 1)), MAX_CALENDARS_PER_SYNC)

    with pytest.raises(HTTPException, match="Invalid"):
        parse_calendar_ids("not-a-uuid", MAX_CALENDARS_PER_SYNC)


# 2 — origin validation middleware: missing, wrong, valid
def test_origin_validation_middleware(monkeypatch, auth):
    from app.routers import calendar as cal

    app.dependency_overrides[verify_account_access] = lambda: {"id": ACCT_ID}

    async def ok(*a):
        return [{"id": CAL_ID}]
    monkeypatch.setattr(cal, "list_calendars", ok)

    url = f"/calendar/accounts/{ACCT_ID}/refresh-calendars"

    with TestClient(app) as c:
        assert c.post(url).status_code == 403
        assert c.post(url, headers={"Origin": "http://evil.com"}).status_code == 403
        assert c.post(url, headers={"Origin": "http://localhost:5174"}).status_code == 200


# 3 — read endpoints: events, accounts, calendars, sync-status, empty-calendars
def test_read_endpoints(monkeypatch, auth):
    from app.routers import calendar as cal

    ev = _db_event("e1", "Standup")
    monkeypatch.setattr(cal, "get_user_calendar_ids", lambda sb, uid, cids=None: [CAL_ID])
    monkeypatch.setattr(cal, "query_events", lambda sb, cids: ([ev], [], []))
    monkeypatch.setattr(cal, "get_google_accounts_for_user", lambda sb, uid: [{"id": ACCT_ID}])
    monkeypatch.setattr(cal, "get_all_calendars_for_user", lambda sb, uid: [{"id": CAL_ID}])
    monkeypatch.setattr(cal, "get_latest_sync_at", lambda sb, cids: "2025-06-15T12:00:00Z")

    with TestClient(app) as c:
        assert c.get("/calendar/events").json()["events"][0]["summary"] == "Standup"
        assert c.get(f"/calendar/events?calendar_ids={CAL_ID}").json()["events"][0]["id"] == "e1"
        assert c.get("/calendar/accounts").json()["accounts"] == [{"id": ACCT_ID}]
        assert c.get("/calendar/calendars").json()["calendars"] == [{"id": CAL_ID}]
        assert c.get("/calendar/sync-status").json()["lastSyncAt"] == "2025-06-15T12:00:00Z"

        monkeypatch.setattr(cal, "get_user_calendar_ids", lambda sb, uid, cids=None: [])
        assert c.get("/calendar/events").json() == {"events": [], "masters": [], "exceptions": []}


# 4 — refresh-calendars: success, GoogleAPIError→502, unexpected→500
def test_refresh_and_error_handlers(monkeypatch, auth):
    from app.routers import calendar as cal

    app.dependency_overrides[verify_account_access] = lambda: {"id": ACCT_ID}
    url = f"/calendar/accounts/{ACCT_ID}/refresh-calendars"
    headers = {"Origin": "http://localhost:5174"}

    async def ok(*a):
        return [{"id": CAL_ID}]

    async def google_err(*a):
        raise GoogleAPIError(500, "down")

    async def unexpected(*a):
        raise RuntimeError("boom")

    with TestClient(app) as c:
        monkeypatch.setattr(cal, "list_calendars", ok)
        assert c.post(url, headers=headers).json()["calendars"] == [{"id": CAL_ID}]

        monkeypatch.setattr(cal, "list_calendars", google_err)
        assert c.post(url, headers=headers).status_code == 502

        monkeypatch.setattr(cal, "list_calendars", unexpected)
        assert c.post(url, headers=headers).status_code == 500
