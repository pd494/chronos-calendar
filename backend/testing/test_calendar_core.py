"""Calendar backend core - 10 tests covering gcal, helpers, db, db_utils."""
import asyncio
import sys
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from conftest import FakeTableChain

from app.calendar.constants import GoogleCalendarConfig
from app.calendar.helpers import (
    GoogleAPIError,
    _cleanup_cache,
    _is_semaphore_active,
    _normalize_recurrence,
    _extract_original_start_time,
    decrypt_event,
    extract_error_reason,
    format_sse,
    get_account_semaphore,
    get_refresh_lock,
    parse_expires_at,
    proximity_sort_events,
    token_needs_refresh,
    transform_events,
    with_retry,
)
from app.calendar.gcal import handle_google_response
from app.core.db_utils import all_rows, first_row
from app.core.encryption import Encryption

USER_ID = "test-user-core"


def _mock_response(status_code, json_body=None):
    r = MagicMock(spec=httpx.Response)
    r.status_code = status_code
    if json_body is not None:
        r.json.return_value = json_body
    else:
        r.json.side_effect = ValueError("No JSON")
    return r


# 1 ---------------------------------------------------------------
def test_db_utils():
    assert first_row([{"id": 1}, {"id": 2}]) == {"id": 1}
    assert first_row({"direct": True}) == {"direct": True}
    assert first_row([]) is None
    assert first_row(None) is None
    assert first_row([42]) is None

    assert all_rows([{"a": 1}, {"b": 2}]) == [{"a": 1}, {"b": 2}]
    assert all_rows([{"ok": True}, 42]) == [{"ok": True}]
    assert all_rows([]) == []
    assert all_rows(None) == []


# 2 ---------------------------------------------------------------
def test_pure_helpers():
    err = GoogleAPIError(429, "Rate limited", retryable=True)
    assert err.status_code == 429 and err.retryable and "429" in str(err)
    assert GoogleAPIError(400, "Bad").retryable is False

    assert extract_error_reason(_mock_response(403, {"error": {"errors": [{"reason": "quotaExceeded"}]}})) == "quotaExceeded"
    assert extract_error_reason(_mock_response(403, {"error": {"errors": []}})) == ""
    assert extract_error_reason(_mock_response(500)) == ""

    assert token_needs_refresh(datetime.now(timezone.utc) - timedelta(hours=1)) is True
    assert token_needs_refresh(datetime.now(timezone.utc) + timedelta(hours=1)) is False
    assert token_needs_refresh(datetime.now(timezone.utc) + timedelta(minutes=3)) is True

    dt = parse_expires_at("2025-06-15T10:30:00+00:00")
    assert dt.year == 2025 and dt.tzinfo is not None
    assert parse_expires_at("2025-06-15T10:30:00Z") == dt

    assert _normalize_recurrence(None) is None
    assert _normalize_recurrence([]) is None
    assert _normalize_recurrence(["RRULE:FREQ=DAILY"]) == ["RRULE:FREQ=DAILY"]

    assert _extract_original_start_time({"originalStartTime": {"dateTime": "2025-06-15T10:00:00Z"}}) == "2025-06-15T10:00:00Z"
    assert _extract_original_start_time({"originalStartTime": {"date": "2025-06-15"}}) == "2025-06-15"
    assert _extract_original_start_time({}) is None

    sse = format_sse("sync", {"ok": True})
    assert sse.startswith("event: sync\n") and sse.endswith("\n\n")

    now = datetime.now(timezone.utc)
    events = [
        {"start_datetime": {"dateTime": (now + timedelta(days=30)).isoformat()}},
        {"start_datetime": {"dateTime": (now + timedelta(days=1)).isoformat()}},
        {"start_datetime": {"date": (now - timedelta(days=2)).strftime("%Y-%m-%d")}},
        {"start_datetime": {}},
    ]
    sorted_ev = proximity_sort_events(events)
    assert sorted_ev[-1]["start_datetime"] == {}


# 3 ---------------------------------------------------------------
def test_transform_events():
    events = [
        {"id": "e1", "summary": "Meeting", "description": "Notes", "location": "Room A",
         "start": {"dateTime": "2025-06-15T09:00:00Z"}, "end": {"dateTime": "2025-06-15T10:00:00Z"},
         "status": "confirmed", "recurrence": ["RRULE:FREQ=WEEKLY"], "colorId": "5"},
        {"id": "e2", "start": {"date": "2025-06-16"}, "end": {"date": "2025-06-17"}, "status": "cancelled"},
    ]
    result = transform_events(events, "cal-1", "acct-1", USER_ID, "#0000ff")
    e1, e2 = result

    assert Encryption.decrypt(e1["summary"], USER_ID) == "Meeting"
    assert Encryption.decrypt(e1["description"], USER_ID) == "Notes"
    assert Encryption.decrypt(e1["location"], USER_ID) == "Room A"
    assert e1["recurrence"] == ["RRULE:FREQ=WEEKLY"]
    assert e1["color_id"] == "5"
    assert e1["is_all_day"] is False
    assert e1["embedding_pending"] is True

    assert Encryption.decrypt(e2["summary"], USER_ID) == "(No title)"
    assert e2["description"] is None and e2["location"] is None
    assert e2["is_all_day"] is True
    assert e2["all_day_date"] == "2025-06-16"
    assert e2["embedding_pending"] is False
    assert e2["color_id"] == "#0000ff"


# 4 ---------------------------------------------------------------
def test_decrypt_event():
    enc_sum = Encryption.encrypt("My Event", USER_ID)
    enc_desc = Encryption.encrypt("Details", USER_ID)
    db_event = {
        "google_event_id": "evt-1", "google_calendar_id": "cal-1",
        "summary": enc_sum, "description": enc_desc, "location": None,
        "start_datetime": {"dateTime": "2025-06-15T10:00:00Z"},
        "end_datetime": {"dateTime": "2025-06-15T11:00:00Z"},
        "status": "confirmed", "visibility": "default", "transparency": "opaque",
        "recurrence": [], "recurring_event_id": None, "color_id": "1",
        "created_at": "2025-01-01", "updated_at": "2025-01-02",
        "attendees": None, "organizer": None, "reminders": None,
        "conference_data": None, "html_link": None, "ical_uid": None,
        "original_start_time": "2025-06-15T10:00:00Z",
    }

    fe = decrypt_event(db_event, USER_ID)
    assert fe["id"] == "evt-1" and fe["summary"] == "My Event"
    assert fe["description"] == "Details"
    assert fe["recurrence"] is None
    assert fe["originalStartTime"] == {"dateTime": "2025-06-15T10:00:00Z"}

    db_fmt = decrypt_event(db_event, USER_ID, output_format="db")
    assert db_fmt["summary"] == "My Event" and db_fmt["google_event_id"] == "evt-1"

    corrupted = dict(db_event)
    corrupted["summary"] = "not-valid-encrypted!!!"
    assert decrypt_event(corrupted, USER_ID)["summary"] == ""

    all_day = dict(db_event)
    all_day["original_start_time"] = "2025-06-15"
    assert decrypt_event(all_day, USER_ID)["originalStartTime"] == {"date": "2025-06-15"}


# 5 ---------------------------------------------------------------
async def test_cache_and_retry(monkeypatch):
    from app.calendar import helpers

    monkeypatch.setattr(helpers, "CACHE_CLEANUP_THRESHOLD", 5)
    monkeypatch.setattr(helpers, "MAX_CACHED_ACCOUNTS", 3)
    helpers._account_semaphores.clear()
    helpers._refresh_locks.clear()

    for i in range(6):
        helpers._account_semaphores[f"fill-{i}"] = asyncio.Semaphore(3)
    sem = await get_account_semaphore("new-sem")
    assert isinstance(sem, asyncio.Semaphore)
    assert await get_account_semaphore("new-sem") is sem

    for i in range(6):
        helpers._refresh_locks[f"fill-{i}"] = asyncio.Lock()
    lock = await get_refresh_lock("new-lock")
    assert isinstance(lock, asyncio.Lock)
    assert await get_refresh_lock("new-lock") is lock

    cache = OrderedDict((f"k{i}", i) for i in range(10))
    _cleanup_cache(cache, 5, check_active=lambda v: v >= 8)
    assert "k8" in cache and "k9" in cache

    sem_check = asyncio.Semaphore(3)
    assert _is_semaphore_active(sem_check) is False
    await sem_check.acquire()
    assert _is_semaphore_active(sem_check) is True

    calls = 0
    async def non_retryable():
        nonlocal calls; calls += 1
        raise GoogleAPIError(403, "Forbidden", retryable=False)
    with pytest.raises(GoogleAPIError):
        await with_retry(non_retryable, "retry-1")
    assert calls == 1

    attempts = 0
    async def flaky():
        nonlocal attempts; attempts += 1
        if attempts < 3:
            raise GoogleAPIError(429, "Rate limited", retryable=True)
        return {"ok": True}
    assert (await with_retry(flaky, "retry-2")) == {"ok": True}

    timeout_n = 0
    async def timeout_fn():
        nonlocal timeout_n; timeout_n += 1
        if timeout_n == 1:
            raise httpx.TimeoutException("timeout")
        return "ok"
    assert (await with_retry(timeout_fn, "retry-3")) == "ok"

    net_n = 0
    async def net_fn():
        nonlocal net_n; net_n += 1
        if net_n == 1:
            raise httpx.NetworkError("down")
        return "ok"
    assert (await with_retry(net_fn, "retry-4")) == "ok"

    helpers._account_semaphores.clear()
    helpers._refresh_locks.clear()


# 6 ---------------------------------------------------------------
def test_handle_google_response():
    assert handle_google_response(_mock_response(200, {"items": []})) == {"items": []}
    assert handle_google_response(_mock_response(204)) == {}

    for status, retryable in [(429, True), (410, False), (500, True), (503, True), (418, False)]:
        with pytest.raises(GoogleAPIError) as exc:
            handle_google_response(_mock_response(status))
        assert exc.value.status_code == status and exc.value.retryable == retryable

    with pytest.raises(GoogleAPIError) as exc:
        handle_google_response(_mock_response(403, {"error": {"errors": [{"reason": "rateLimitExceeded"}]}}))
    assert exc.value.retryable is True

    with pytest.raises(GoogleAPIError) as exc:
        handle_google_response(_mock_response(403, {"error": {"errors": [{"reason": "forbidden"}]}}))
    assert exc.value.retryable is False

    with pytest.raises(GoogleAPIError) as exc:
        handle_google_response(_mock_response(401))
    assert exc.value.status_code == 401


# 7 ---------------------------------------------------------------
async def test_token_refresh_flow(monkeypatch):
    from app.calendar import gcal

    uid, aid = "user-tok", "acct-tok"
    future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    expired = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    http = AsyncMock(spec=httpx.AsyncClient)
    sb = MagicMock()

    monkeypatch.setattr(gcal, "get_decrypted_tokens", lambda s, u, a: {
        "access_token": "fresh", "refresh_token": "ref", "expires_at": future,
    })
    assert await gcal.get_valid_access_token(http, sb, uid, aid) == "fresh"

    call_n = 0
    def expired_tokens(s, u, a):
        nonlocal call_n; call_n += 1
        return {"access_token": "old", "refresh_token": "ref", "expires_at": expired}
    monkeypatch.setattr(gcal, "get_decrypted_tokens", expired_tokens)

    refresh_resp = MagicMock(status_code=200)
    refresh_resp.json.return_value = {"access_token": "new-tok", "refresh_token": "rotated", "expires_in": 3600}
    http.post = AsyncMock(return_value=refresh_resp)

    captured = {}
    def capture(s, a, at, ea, refresh_token=None):
        captured["rt"] = refresh_token
    monkeypatch.setattr(gcal, "update_google_account_tokens", capture)

    tok = await gcal.get_valid_access_token(http, sb, uid, aid)
    assert tok == "new-tok"
    assert captured["rt"] is not None

    fail_resp = MagicMock(status_code=401)
    http.post = AsyncMock(return_value=fail_resp)
    reauth = False
    def mark(s, a):
        nonlocal reauth; reauth = True
    monkeypatch.setattr(gcal, "mark_needs_reauth", mark)

    with pytest.raises(GoogleAPIError):
        await gcal.refresh_access_token(http, sb, uid, aid, "ref")
    assert reauth


# 8 ---------------------------------------------------------------
async def test_list_calendars(monkeypatch):
    from app.calendar import gcal

    uid, aid = "user-lc", "acct-lc"
    token_n = 0
    async def mock_token(h, s, u, a):
        nonlocal token_n; token_n += 1
        return f"tok-{token_n}"
    monkeypatch.setattr(gcal, "get_valid_access_token", mock_token)
    monkeypatch.setattr(gcal, "get_google_account", lambda s, a: {"email": "a@b.com", "name": "Test", "needs_reauth": False})

    call_n = 0
    async def mock_get(*args, **kwargs):
        nonlocal call_n; call_n += 1
        if call_n == 1:
            return _mock_response(401)
        return _mock_response(200, {
            "items": [{"id": "cal@g.com", "summary": "Cal", "backgroundColor": "#f00", "primary": True, "accessRole": "owner"}],
        })

    http = MagicMock()
    http.get = mock_get
    sb = MagicMock()
    sb.table.return_value = FakeTableChain(data=[
        {"id": "uuid-1", "google_calendar_id": "cal@g.com", "name": "Cal", "color": "#f00", "is_primary": True},
    ])

    result = await gcal.list_calendars(http, sb, uid, aid)
    assert len(result) == 1
    assert result[0]["account_email"] == "a@b.com"
    assert result[0]["google_calendar_id"] == "cal@g.com"
    assert token_n == 2


# 9 ---------------------------------------------------------------
async def test_get_events(monkeypatch):
    from app.calendar import gcal

    monkeypatch.setattr(gcal, "get_valid_access_token", AsyncMock(return_value="tok"))

    page1 = {
        "items": [{"id": "e1", "summary": "Ev1", "start": {"dateTime": "2025-06-15T10:00:00Z"},
                   "end": {"dateTime": "2025-06-15T11:00:00Z"}, "status": "confirmed"}],
        "nextPageToken": "p2",
    }
    page2 = {
        "items": [{"id": "e2", "summary": "Ev2", "start": {"date": "2025-06-16"},
                   "end": {"date": "2025-06-17"}, "status": "confirmed"}],
        "nextSyncToken": "sync-abc",
    }
    pages = iter([_mock_response(200, page1), _mock_response(200, page2)])
    async def mock_get(*a, **kw):
        return next(pages)

    http = MagicMock()
    http.get = mock_get
    sb = MagicMock()

    chunks = []
    async for chunk in gcal.get_events(http, sb, USER_ID, "acct-1", "cal-uuid", "cal@g.com", sync_token="old"):
        chunks.append(chunk)

    assert len(chunks) == 3
    assert chunks[0]["type"] == "events" and len(chunks[0]["events"]) == 1
    assert chunks[1]["type"] == "events" and len(chunks[1]["events"]) == 1
    assert chunks[2] == {"type": "sync_token", "token": "sync-abc"}


# 10 --------------------------------------------------------------
def test_db_operations():
    from app.calendar import db

    sb = MagicMock()
    sb.table.return_value = FakeTableChain()

    db.update_google_account_tokens(sb, "a1", "enc-at", "2025-06-15T10:00:00Z")
    db.update_google_account_tokens(sb, "a1", "enc-at", "2025-06-15T10:00:00Z", refresh_token="enc-rt")
    db.mark_needs_reauth(sb, "a1")
    db.clear_calendar_sync_state(sb, "c1")

    enc_at = Encryption.encrypt("access", USER_ID)
    enc_rt = Encryption.encrypt("refresh", USER_ID)
    sb.table.return_value = FakeTableChain(data={
        "access_token": enc_at, "refresh_token": enc_rt,
        "expires_at": "2025-06-15T10:00:00Z", "google_accounts": {"user_id": USER_ID},
    })
    tokens = db.get_decrypted_tokens(sb, USER_ID, "a1")
    assert tokens["access_token"] == "access" and tokens["refresh_token"] == "refresh"

    sb.table.return_value = FakeTableChain(data={
        "access_token": enc_at, "refresh_token": None,
        "expires_at": "2025-06-15T10:00:00Z", "google_accounts": {"user_id": USER_ID},
    })
    tokens_null_rt = db.get_decrypted_tokens(sb, USER_ID, "a1")
    assert tokens_null_rt["refresh_token"] is None

    chain = FakeTableChain()
    sb.table.return_value = chain
    db.update_calendar_sync_state(sb, "c1", "sync-tok", page_token=None)
    assert chain._upsert_data["next_page_token"] is None
    assert chain._upsert_data["sync_token"] == "sync-tok"

    sb.table.return_value = FakeTableChain(data=[{"sync_token": "st", "last_sync_at": "2025-01-01"}])
    assert db.get_calendar_sync_state(sb, "c1")["sync_token"] == "st"

    sb.table.return_value = FakeTableChain(data=[{"id": "cal-1", "name": "My Cal"}])
    assert db.get_google_calendar(sb, "cal-1")["id"] == "cal-1"
    assert db.get_google_calendar(sb, "cal-1", user_id="u1") is not None

    sb.table.return_value = FakeTableChain(data=[{"id": "a1", "email": "a@b.com"}])
    assert db.get_google_account(sb, "a1")["email"] == "a@b.com"

    sb.table.return_value = FakeTableChain(data=[{"id": "a1"}, {"id": "a2"}])
    assert len(db.get_google_accounts_for_user(sb, "u1")) == 2

    sb.table.return_value = FakeTableChain(data=[{"id": "c1"}])
    assert len(db.get_all_calendars_for_user(sb, "u1")) == 1

    assert db.upsert_events(sb, []) == 0
    sb.table.return_value = FakeTableChain()
    assert db.upsert_events(sb, [{"google_calendar_id": "c1"}] * 3) == 3

    sb.table.return_value = FakeTableChain(data=[{"id": "c1"}, {"id": "c2"}, {"id": "c3"}])
    assert len(db.get_user_calendar_ids(sb, "u1")) == 3
    sb.table.return_value = FakeTableChain(data=[{"id": "c1"}, {"id": "c2"}, {"id": "c3"}])
    assert db.get_user_calendar_ids(sb, "u1", "c1,c3") == ["c1", "c3"]

    assert db.get_latest_sync_at(sb, []) is None
    sb.table.return_value = FakeTableChain(data=[{"last_sync_at": "2025-01-15T10:00:00Z"}])
    assert db.get_latest_sync_at(sb, ["c1"]) == "2025-01-15T10:00:00Z"

    sb.table.return_value = FakeTableChain(data=[{"id": "e1"}])
    events, masters, exceptions = db.query_events(sb, ["c1"])
    assert isinstance(events, list) and isinstance(masters, list) and isinstance(exceptions, list)
