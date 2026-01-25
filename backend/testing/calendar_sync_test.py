from __future__ import annotations

import json
import sys
import types
import importlib.util
from pathlib import Path
from typing import Any

import pytest
ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT))

from app.calendar.helpers import GoogleAPIError  # noqa: E402
from app.routers import calendar as calendar_router  # noqa: E402


def _ensure_dependency_stubs() -> None:
    if importlib.util.find_spec("gotrue.errors") is None:
        gotrue = types.ModuleType("gotrue")
        gotrue_errors = types.ModuleType("gotrue.errors")

        class AuthApiError(Exception):
            def __init__(self, message: str = "", code: str | None = None):
                super().__init__(message)
                self.message = message
                self.code = code

        setattr(gotrue_errors, "AuthApiError", AuthApiError)
        setattr(gotrue, "errors", gotrue_errors)
        sys.modules["gotrue"] = gotrue
        sys.modules["gotrue.errors"] = gotrue_errors

    if importlib.util.find_spec("postgrest") is None:
        postgrest = types.ModuleType("postgrest")

        class PostgrestAPIError(Exception):
            pass

        setattr(postgrest, "APIError", PostgrestAPIError)
        sys.modules["postgrest"] = postgrest

    if importlib.util.find_spec("postgrest.exceptions") is None:
        postgrest_exceptions = types.ModuleType("postgrest.exceptions")

        class PostgrestExceptionsAPIError(Exception):
            pass

        setattr(postgrest_exceptions, "APIError", PostgrestExceptionsAPIError)
        sys.modules["postgrest.exceptions"] = postgrest_exceptions


_ensure_dependency_stubs()

def _parse_sse_blocks(payload: str) -> list[str]:
    return [block for block in payload.split("\n\n") if block.strip()]


def _extract_data(block: str) -> dict:
    for line in block.split("\n"):
        if line.startswith("data: "):
            return json.loads(line.replace("data: ", "", 1))
    return {}


@pytest.mark.asyncio
async def test_sync_streams_events_and_completes(monkeypatch: pytest.MonkeyPatch):
    sync_calls: list[tuple[str, str]] = []

    calendar_router._sync_rate_limits.clear()

    def fake_get_user_calendar_ids(supabase, user_id, calendar_ids):
        return ["cal-1", "cal-2"]

    def fake_get_google_calendar(supabase, calendar_id, _user_id=None):
        return {
            "id": calendar_id,
            "google_account_id": "acct-1",
            "google_calendar_id": f"g-{calendar_id}",
            "color": "#123456",
        }

    async def fake_get_events(
        supabase,
        user_id,
        google_account_id,
        google_calendar_id,
        google_calendar_external_id,
        sync_token=None,
        calendar_color=None,
    ):
        events = [
            {
                "google_event_id": f"evt-{google_calendar_id}",
                "google_calendar_id": google_calendar_id,
                "summary": "Test",
                "start_datetime": {},
                "end_datetime": {},
                "status": "confirmed",
                "visibility": "default",
                "transparency": "opaque",
            }
        ]
        yield {"type": "events", "events": events}
        yield {"type": "sync_token", "token": f"token-{google_calendar_id}"}

    def fake_decrypt_event(event, user_id):
        return {
            "id": event["google_event_id"],
            "calendarId": event["google_calendar_id"],
            "summary": event.get("summary", ""),
            "start": {},
            "end": {},
            "status": "confirmed",
            "visibility": "default",
            "transparency": "opaque",
        }

    def fake_update_calendar_sync_state(supabase, calendar_id, sync_token):
        sync_calls.append((calendar_id, sync_token))

    monkeypatch.setattr(calendar_router, "get_user_calendar_ids", fake_get_user_calendar_ids)
    monkeypatch.setattr(calendar_router, "get_google_calendar", fake_get_google_calendar)
    monkeypatch.setattr(calendar_router, "get_calendar_sync_state", lambda supabase, calendar_id: None)
    monkeypatch.setattr(calendar_router, "update_calendar_sync_state", fake_update_calendar_sync_state)
    monkeypatch.setattr(calendar_router, "get_events", fake_get_events)
    monkeypatch.setattr(calendar_router, "upsert_events", lambda supabase, events: None)
    monkeypatch.setattr(calendar_router, "decrypt_event", fake_decrypt_event)

    mock_supabase: Any = object()
    response = await calendar_router.sync_calendars(
        current_user={"id": "user-1"},
        supabase=mock_supabase,
        calendar_ids="cal-1,cal-2",
    )

    chunks: list[str] = []
    async for chunk in response.body_iterator:
        if isinstance(chunk, (bytes, bytearray)):
            chunks.append(chunk.decode())
        elif isinstance(chunk, str):
            chunks.append(chunk)
        if "event: complete" in chunks[-1]:
            break

    payload = "".join(chunks)
    blocks = _parse_sse_blocks(payload)

    events_blocks = [block for block in blocks if block.startswith("event: events")]
    assert len(events_blocks) == 2
    event_calendar_ids = { _extract_data(block)["calendar_id"] for block in events_blocks }
    assert event_calendar_ids == {"cal-1", "cal-2"}

    sync_blocks = [block for block in blocks if block.startswith("event: sync_token")]
    assert len(sync_blocks) == 2

    assert any(block.startswith("event: complete") for block in blocks)
    assert len(sync_calls) == 2


@pytest.mark.asyncio
async def test_sync_emits_error_payload(monkeypatch: pytest.MonkeyPatch):
    calendar_router._sync_rate_limits.clear()

    def fake_get_user_calendar_ids(supabase, user_id, calendar_ids):
        return ["cal-1"]

    def fake_get_google_calendar(supabase, calendar_id, _user_id=None):
        return {
            "id": calendar_id,
            "google_account_id": "acct-1",
            "google_calendar_id": f"g-{calendar_id}",
            "color": "#123456",
        }

    async def fake_get_events(*args, **kwargs):
        raise GoogleAPIError(500, "Boom", retryable=True)
        if False:
            yield  # pragma: no cover

    monkeypatch.setattr(calendar_router, "get_user_calendar_ids", fake_get_user_calendar_ids)
    monkeypatch.setattr(calendar_router, "get_google_calendar", fake_get_google_calendar)
    monkeypatch.setattr(calendar_router, "get_calendar_sync_state", lambda supabase, calendar_id: None)
    monkeypatch.setattr(calendar_router, "get_events", fake_get_events)
    monkeypatch.setattr(calendar_router, "upsert_events", lambda supabase, events: None)

    mock_supabase: Any = object()
    response = await calendar_router.sync_calendars(
        current_user={"id": "user-1"},
        supabase=mock_supabase,
        calendar_ids="cal-1",
    )

    chunks: list[str] = []
    async for chunk in response.body_iterator:
        if isinstance(chunk, (bytes, bytearray)):
            chunks.append(chunk.decode())
        elif isinstance(chunk, str):
            chunks.append(chunk)
        if "event: complete" in chunks[-1]:
            break

    payload = "".join(chunks)
    blocks = _parse_sse_blocks(payload)
    error_blocks = [block for block in blocks if block.startswith("event: sync_error")]
    assert len(error_blocks) == 1
    error_payload = _extract_data(error_blocks[0])
    assert error_payload["code"] == "500"
    assert error_payload["retryable"] is True
