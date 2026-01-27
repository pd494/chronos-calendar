"""Tests for gcal.py - Google response handling and token refresh."""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.calendar.helpers import GoogleAPIError
from app.calendar.gcal import handle_google_response


def _make_response(status_code: int, json_body=None) -> httpx.Response:
    response = MagicMock(spec=httpx.Response)
    response.status_code = status_code
    if json_body is not None:
        response.json.return_value = json_body
    else:
        response.json.side_effect = ValueError("No JSON body")
    return response


def _make_supabase():
    from conftest import FakeTableChain
    mock = MagicMock()
    mock.table.return_value = FakeTableChain()
    return mock


ACCOUNT_ID = "ga-test-123"


def test_handle_google_response_200():
    body = {"items": [{"id": "cal-1"}]}
    response = _make_response(200, body)
    result = handle_google_response(_make_supabase(), response, ACCOUNT_ID)
    assert result == body


def test_handle_google_response_204():
    response = _make_response(204)
    result = handle_google_response(_make_supabase(), response, ACCOUNT_ID)
    assert result == {}


@pytest.mark.parametrize("status,expected_code,retryable", [
    (401, 401, False),
    (429, 429, True),
    (410, 410, False),
    (500, 500, True),
    (503, 503, True),
    (418, 418, False),
])
def test_handle_google_response_errors(status, expected_code, retryable):
    json_body = {"error": {"errors": []}} if status == 403 else None
    response = _make_response(status, json_body)

    supabase = _make_supabase()
    with pytest.raises(GoogleAPIError) as exc_info:
        handle_google_response(supabase, response, ACCOUNT_ID)

    assert exc_info.value.status_code == expected_code
    assert exc_info.value.retryable == retryable


def test_handle_google_response_403_quota():
    response = _make_response(403, {
        "error": {"errors": [{"reason": "rateLimitExceeded"}]}
    })
    with pytest.raises(GoogleAPIError) as exc_info:
        handle_google_response(_make_supabase(), response, ACCOUNT_ID)
    assert exc_info.value.status_code == 403
    assert exc_info.value.retryable is True


def test_handle_google_response_403_forbidden():
    response = _make_response(403, {
        "error": {"errors": [{"reason": "forbidden"}]}
    })
    with pytest.raises(GoogleAPIError) as exc_info:
        handle_google_response(_make_supabase(), response, ACCOUNT_ID)
    assert exc_info.value.status_code == 403
    assert exc_info.value.retryable is False


def test_handle_google_response_401_marks_reauth():
    response = _make_response(401)
    supabase = _make_supabase()

    with patch("app.calendar.gcal.mark_needs_reauth") as mock_reauth:
        with pytest.raises(GoogleAPIError):
            handle_google_response(supabase, response, ACCOUNT_ID)
        mock_reauth.assert_called_once_with(supabase, ACCOUNT_ID)
