import asyncio
import json
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
from app.calendar import gcal, sync as cal_sync
from app.calendar.helpers import GoogleAPIError
from app.core.encryption import Encryption
from app.main import app
from app.core.dependencies import get_current_user, get_http_client, verify_account_access
from app.routers.calendar import validate_origin
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


def _parse_sse(text):
    out = []
    for block in text.split("\n\n"):
        block = block.strip()
        if not block or block.startswith(":"):
            continue
        etype = data = None
        for line in block.split("\n"):
            if line.startswith("event: "):
                etype = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
        if etype and data is not None:
            out.append((etype, data))
    return out


@pytest.fixture(autouse=True)
def _reset():
    from app.routers.calendar import _sync_rate_limits
    _sync_rate_limits.clear()
    yield
    _sync_rate_limits.clear()
    app.dependency_overrides.clear()


@pytest.fixture
def auth():
    app.dependency_overrides[get_current_user] = lambda: MOCK_USER
    app.dependency_overrides[get_supabase_client] = lambda: MagicMock()
    app.dependency_overrides[get_http_client] = lambda: MagicMock()
    app.dependency_overrides[validate_origin] = lambda: None


def _stub_sync(mp, cal, state=None, upsert_fn=None, encrypt_fn=None):
    from app.calendar import db as cal_db
    from app.calendar import helpers as cal_helpers

    mp.setattr(cal, "get_user_calendar_ids", lambda sb, uid, cids=None: [CAL_ID])
    mp.setattr(cal_db, "get_google_calendar", lambda sb, cid, uid: _CAL)
    mp.setattr(cal_db, "get_calendar_sync_state", lambda sb, cid: state)
    mp.setattr(cal_helpers, "encrypt_events", encrypt_fn or (lambda evts, uid: evts))
    mp.setattr(cal_db, "upsert_events", upsert_fn or (lambda sb, evts: len(evts)))
    mp.setattr(cal_db, "update_calendar_sync_state", lambda sb, cid, tok, **kw: None)
    mp.setattr(cal_db, "clear_calendar_sync_state", lambda sb, cid: None)


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


# 2 — validate_origin: missing, wrong, valid
def test_validate_origin(monkeypatch):
    from app.routers import calendar as cal
    from app.routers.calendar import validate_origin

    monkeypatch.setattr(cal, "settings", MagicMock(cors_origins=["http://localhost:3000"]))

    req = MagicMock()
    req.headers.get.return_value = None
    with pytest.raises(HTTPException):
        validate_origin(req)

    req.headers.get.return_value = "http://evil.com"
    with pytest.raises(HTTPException):
        validate_origin(req)

    req.headers.get.return_value = "http://localhost:3000"
    validate_origin(req)


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
    from app.routers.calendar import validate_origin

    app.dependency_overrides[verify_account_access] = lambda: {"id": ACCT_ID}
    app.dependency_overrides[validate_origin] = lambda: None
    url = f"/calendar/accounts/{ACCT_ID}/refresh-calendars"

    async def ok(*a):
        return [{"id": CAL_ID}]

    async def google_err(*a):
        raise GoogleAPIError(500, "down")

    async def unexpected(*a):
        raise RuntimeError("boom")

    with TestClient(app) as c:
        monkeypatch.setattr(cal, "list_calendars", ok)
        assert c.post(url).json()["calendars"] == [{"id": CAL_ID}]

        monkeypatch.setattr(cal, "list_calendars", google_err)
        assert c.post(url).status_code == 502

        monkeypatch.setattr(cal, "list_calendars", unexpected)
        assert c.post(url).status_code == 500


# 5 — sync happy path: streams events + sync_token + complete, then rate-limits
def test_sync_happy_path(monkeypatch, auth):
    from app.routers import calendar as cal

    _stub_sync(monkeypatch, cal)

    async def gen(*a, **kw):
        yield {"type": "events", "events": [_plain("s1", "Sync")], "next_page_token": None}
        yield {"type": "sync_token", "token": "tok-1"}
    monkeypatch.setattr(gcal, "get_events", gen)

    with TestClient(app) as c:
        r = c.get(f"/calendar/sync?calendar_ids={CAL_ID}")
        assert r.status_code == 200
        msgs = _parse_sse(r.text)
        types = [t for t, _ in msgs]
        assert "events" in types and "sync_token" in types and types[-1] == "complete"
        assert msgs[0][1]["events"][0]["summary"] == "Sync"
        assert msgs[-1][1]["total_events"] == 1

        assert c.get(f"/calendar/sync?calendar_ids={CAL_ID}").status_code == 429


# 6 — resume from saved page_token, sync_token suppressed
def test_sync_resumes_from_page_token(monkeypatch, auth):
    from app.routers import calendar as cal

    cap = []
    _stub_sync(monkeypatch, cal, state={"sync_token": "old", "next_page_token": "pg2"})

    async def gen(http, sb, uid, gaid, cid, gceid, sync_token=None, calendar_color=None, page_token=None):
        cap.append({"sync_token": sync_token, "page_token": page_token})
        yield {"type": "events", "events": [_plain("p2")], "next_page_token": None}
        yield {"type": "sync_token", "token": "new"}
    monkeypatch.setattr(gcal, "get_events", gen)

    with TestClient(app) as c:
        r = c.get(f"/calendar/sync?calendar_ids={CAL_ID}")
    assert cap[0] == {"sync_token": None, "page_token": "pg2"}
    token_msgs = [d for t, d in _parse_sse(r.text) if t == "sync_token"]
    assert len(token_msgs) == 1
    assert "token" not in token_msgs[0]


# 7 — 410 Gone clears sync state and retries as full sync
def test_sync_410_retry(monkeypatch, auth):
    from app.routers import calendar as cal
    from app.calendar import db as cal_db

    cleared, n = [], {"c": 0}
    _stub_sync(monkeypatch, cal, state={"sync_token": "stale", "next_page_token": None})
    monkeypatch.setattr(cal_db, "clear_calendar_sync_state", lambda sb, cid: cleared.append(cid))

    async def gen(*a, **kw):
        n["c"] += 1
        if n["c"] == 1:
            raise GoogleAPIError(410, "Gone")
            yield
        yield {"type": "events", "events": [_plain("r1")], "next_page_token": None}
        yield {"type": "sync_token", "token": "fresh"}
    monkeypatch.setattr(gcal, "get_events", gen)

    with TestClient(app) as c:
        r = c.get(f"/calendar/sync?calendar_ids={CAL_ID}")
    assert CAL_ID in cleared and n["c"] == 2
    assert any(t == "events" for t, _ in _parse_sse(r.text))


# 8 — page_token resume fails → retries full sync from scratch
def test_sync_page_token_retry_on_error(monkeypatch, auth):
    from app.routers import calendar as cal

    cap, n = [], {"c": 0}
    _stub_sync(monkeypatch, cal, state={"sync_token": None, "next_page_token": "pg1"})

    async def gen(http, sb, uid, gaid, cid, gceid, sync_token=None, calendar_color=None, page_token=None):
        cap.append(page_token)
        n["c"] += 1
        if n["c"] == 1:
            raise GoogleAPIError(500, "fail", retryable=True)
            yield
        yield {"type": "events", "events": [_plain("pt1")], "next_page_token": None}
        yield {"type": "sync_token", "token": "tok-pt"}
    monkeypatch.setattr(gcal, "get_events", gen)

    with TestClient(app) as c:
        r = c.get(f"/calendar/sync?calendar_ids={CAL_ID}")
    assert cap == ["pg1", None]
    assert any(t == "events" for t, _ in _parse_sse(r.text))


# 9 — mid-sync failure saves current page_token for resume
def test_sync_saves_progress_on_failure(monkeypatch, auth):
    from app.routers import calendar as cal
    from app.calendar import db as cal_db

    saved = {}
    _stub_sync(monkeypatch, cal)
    monkeypatch.setattr(cal_db, "update_calendar_sync_state",
                        lambda sb, cid, tok, **kw: saved.update(cid=cid, pt=kw.get("page_token")))

    async def gen(*a, **kw):
        yield {"type": "events", "events": [_plain("f1")], "next_page_token": "pg3"}
        raise GoogleAPIError(500, "down", retryable=True)
    monkeypatch.setattr(gcal, "get_events", gen)

    with TestClient(app) as c:
        msgs = _parse_sse(c.get(f"/calendar/sync?calendar_ids={CAL_ID}").text)
    assert any(t == "sync_error" for t, _ in msgs)
    assert saved == {"cid": CAL_ID, "pt": "pg3"}


# 10 — missing calendar emits sync_error with 404, stream still completes
def test_sync_calendar_not_found(monkeypatch, auth):
    from app.routers import calendar as cal
    from app.calendar import db as cal_db

    monkeypatch.setattr(cal, "get_user_calendar_ids", lambda sb, uid, cids=None: [CAL_ID])
    monkeypatch.setattr(cal_db, "get_google_calendar", lambda sb, cid, uid: None)

    with TestClient(app) as c:
        msgs = _parse_sse(c.get(f"/calendar/sync?calendar_ids={CAL_ID}").text)
    errors = [d for t, d in msgs if t == "sync_error"]
    assert errors[0]["code"] == "404"
    assert msgs[-1][0] == "complete"


# 11 — multi-calendar sync: both calendars contribute events and complete
def test_sync_multi_calendar(monkeypatch, auth):
    from app.routers import calendar as cal
    from app.calendar import db as cal_db

    cal2_id = str(uuid.uuid4())
    cal2 = {
        "id": cal2_id, "google_account_id": ACCT_ID,
        "google_calendar_id": "secondary@gmail.com",
        "name": "Secondary", "color": "#34a853", "is_primary": False,
    }
    _stub_sync(monkeypatch, cal)
    monkeypatch.setattr(cal, "get_user_calendar_ids", lambda sb, uid, cids=None: [CAL_ID, cal2_id])
    monkeypatch.setattr(cal_db, "get_google_calendar", lambda sb, cid, uid: _CAL if cid == CAL_ID else cal2)

    async def gen(http, sb, uid, gaid, cid, gceid, sync_token=None, calendar_color=None, page_token=None):
        eid = "mc1" if cid == CAL_ID else "mc2"
        yield {"type": "events", "events": [_plain(eid)], "next_page_token": None}
        yield {"type": "sync_token", "token": f"tok-{eid}"}
    monkeypatch.setattr(gcal, "get_events", gen)

    with TestClient(app) as c:
        r = c.get(f"/calendar/sync?calendar_ids={CAL_ID},{cal2_id}")
    msgs = _parse_sse(r.text)
    event_msgs = [d for t, d in msgs if t == "events"]
    token_msgs = [d for t, d in msgs if t == "sync_token"]
    complete = next(d for t, d in msgs if t == "complete")
    assert len(event_msgs) == 2
    assert len(token_msgs) == 2
    assert complete["calendars_synced"] == 2
    assert complete["total_events"] == 2


# 12 — sync timeout emits 408 and completes gracefully
def test_sync_timeout(monkeypatch, auth):
    from app.routers import calendar as cal

    monkeypatch.setattr(cal, "MAX_SYNC_DURATION_SECONDS", -1)
    monkeypatch.setattr(cal, "get_user_calendar_ids", lambda sb, uid, cids=None: [CAL_ID])

    async def hang(http, sb, uid, cid, queue, semaphore=None):
        await asyncio.sleep(100)
        await queue.put({"type": "calendar_done", "calendar_id": cid})
    monkeypatch.setattr(cal_sync, "sync_events", hang)

    with TestClient(app) as c:
        msgs = _parse_sse(c.get(f"/calendar/sync?calendar_ids={CAL_ID}").text)
    assert any(t == "sync_error" and d["code"] == "408" for t, d in msgs)
    assert msgs[-1][0] == "complete"


# 13 — partial upsert failure emits error but sync still completes
def test_sync_partial_upsert_failure(monkeypatch, auth):
    from app.routers import calendar as cal

    def bad_upsert(sb, evts):
        raise RuntimeError("db down")
    _stub_sync(monkeypatch, cal, upsert_fn=bad_upsert)

    async def gen(*a, **kw):
        yield {"type": "events", "events": [_plain("u1")], "next_page_token": None}
        yield {"type": "sync_token", "token": "tok-u"}
    monkeypatch.setattr(gcal, "get_events", gen)

    with TestClient(app) as c:
        msgs = _parse_sse(c.get(f"/calendar/sync?calendar_ids={CAL_ID}").text)
    errors = [d for t, d in msgs if t == "sync_error"]
    assert any(e["code"] == "500" and "persist" in e["message"].lower() for e in errors)
    assert any(t == "sync_token" for t, _ in msgs)
    assert msgs[-1][0] == "complete"


# 14 — empty calendar list yields immediate complete
def test_sync_no_calendars(monkeypatch, auth):
    from app.routers import calendar as cal

    monkeypatch.setattr(cal, "get_user_calendar_ids", lambda sb, uid, cids=None: [])

    with TestClient(app) as c:
        msgs = _parse_sse(c.get(f"/calendar/sync?calendar_ids={str(uuid.uuid4())}").text)
    complete = next(d for t, d in msgs if t == "complete")
    assert complete["total_events"] == 0
    assert complete["calendars_synced"] == 0


# 15 — integration: encrypt_events is called and encrypted data reaches upsert_events
def test_sync_encrypt_then_upsert_integration(monkeypatch, auth):
    from app.routers import calendar as cal
    from app.calendar import helpers as cal_helpers
    from app.calendar.helpers import encrypt_events

    captured_upserts = []

    def capture_upsert(sb, evts):
        captured_upserts.extend(evts)
        return len(evts)

    _stub_sync(monkeypatch, cal, upsert_fn=capture_upsert)
    monkeypatch.setattr(cal_helpers, "encrypt_events", encrypt_events)

    async def gen(*a, **kw):
        yield {"type": "events", "events": [_plain("int1", "Secret Meeting")], "next_page_token": None}
        yield {"type": "sync_token", "token": "tok-int"}
    monkeypatch.setattr(gcal, "get_events", gen)

    with TestClient(app) as c:
        r = c.get(f"/calendar/sync?calendar_ids={CAL_ID}")
        assert r.status_code == 200

    assert len(captured_upserts) == 1
    assert captured_upserts[0]["summary"] != "Secret Meeting"
    assert Encryption.decrypt(captured_upserts[0]["summary"], USER_ID) == "Secret Meeting"
