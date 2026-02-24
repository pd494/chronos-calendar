"""Auth endpoint tests - 4 tests covering OAuth, session/refresh/logout, errors, and delete account."""
import sys
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from conftest import _ensure_dependency_stubs, FakeTableChain, MOCK_USER

_ensure_dependency_stubs()

from app.main import app
from app.core.dependencies import get_current_user
from app.routers import auth as auth_router


class FakeUser:
    def __init__(self, user_id="user-123", email="test@example.com"):
        self.id = user_id
        self.email = email
        self.user_metadata = {"name": "Test User", "avatar_url": "https://example.com/pic.jpg"}
        self.identities = [type("Identity", (), {"provider": "google", "id": "g-123", "identity_data": {"email": email}})()]


class FakeSession:
    def __init__(self, access="access-token", refresh="refresh-token"):
        self.access_token = access
        self.refresh_token = refresh
        self.provider_token = "google-token"
        self.provider_refresh_token = "google-refresh"


ORIGIN = {"Origin": "http://localhost:5174"}


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_oauth_flow(client, monkeypatch):
    """Login redirect, callback success with cookies, callback errors (no code 422, no session 400)."""

    class LoginSupabase:
        class auth:
            @staticmethod
            def sign_in_with_oauth(params):
                assert params["provider"] == "google"
                return type("R", (), {"url": "https://accounts.google.com/oauth"})()

    monkeypatch.setattr(auth_router, "get_supabase_client", lambda: LoginSupabase())
    r = client.get("/auth/google/login")
    assert r.status_code == 200
    assert "accounts.google.com" in r.json()["redirectUrl"]

    class CallbackSupabase:
        class auth:
            @staticmethod
            def exchange_code_for_session(params):
                return type("R", (), {"session": FakeSession(), "user": FakeUser()})()

        @staticmethod
        def table(name):
            chain = FakeTableChain()
            chain.data = {"id": "user-123", "email": "test@example.com", "name": "Test", "avatar_url": None}
            return chain

    monkeypatch.setattr(auth_router, "get_supabase_client", lambda: CallbackSupabase())
    monkeypatch.setattr(auth_router, "store_google_account", lambda *a, **kw: "acct-1")

    r = client.post("/auth/web/callback", json={"code": "test-code"}, headers=ORIGIN)
    assert r.status_code == 200
    assert "chronos_session" in r.cookies
    assert "chronos_refresh" in r.cookies
    assert r.json()["user"]["id"] == "user-123"

    r = client.post("/auth/web/callback", json={}, headers=ORIGIN)
    assert r.status_code == 422

    class NoSessionSupabase:
        class auth:
            @staticmethod
            def exchange_code_for_session(params):
                return type("R", (), {"session": None, "user": None})()

    monkeypatch.setattr(auth_router, "get_supabase_client", lambda: NoSessionSupabase())
    r = client.post("/auth/web/callback", json={"code": "bad"}, headers=ORIGIN)
    assert r.status_code == 400


def test_session_refresh_logout(client, monkeypatch):
    """Session returns user, refresh rotates tokens, logout clears cookies."""

    app.dependency_overrides[get_current_user] = lambda: MOCK_USER
    r = client.get("/auth/session")
    assert r.status_code == 200
    assert r.json()["user"]["id"] == MOCK_USER["id"]
    assert "expires_at" in r.json()
    app.dependency_overrides.clear()

    class RefreshSupabase:
        class auth:
            @staticmethod
            def refresh_session(token):
                return type("R", (), {"session": FakeSession("new-access", "new-refresh"), "user": FakeUser()})()

        @staticmethod
        def table(name):
            chain = FakeTableChain()
            chain.data = {"id": "user-123", "email": "test@example.com"}
            return chain

    monkeypatch.setattr(auth_router, "get_supabase_client", lambda: RefreshSupabase())
    client.cookies.set("chronos_refresh", "old-refresh")

    r = client.post("/auth/refresh", headers=ORIGIN)
    assert r.status_code == 200
    assert "chronos_session" in r.cookies


def test_desktop_callback_page(client):
    from app.config import get_settings

    desktop_url = get_settings().DESKTOP_REDIRECT_URL

    r = client.get("/auth/desktop/callback?code=test-code")
    assert r.status_code == 200
    assert "Open Chronos" in r.text
    assert f"{desktop_url}?code=test-code" in r.text

    r = client.get("/auth/desktop/callback?error=access_denied")
    assert r.status_code == 200
    assert "Sign-in failed" in r.text


def test_logout(client):
    """Logout clears cookies and validates origin."""
    client.cookies.set("chronos_session", "token")
    client.cookies.set("chronos_refresh", "refresh")

    r = client.post("/auth/logout", headers={"Origin": "http://localhost:5174"})
    assert r.status_code == 200
    assert r.json()["message"] == "Logged out"

    r = client.post("/auth/logout")
    assert r.status_code == 403
    assert r.json()["detail"] == "Origin header required"

    r = client.post("/auth/logout", headers={"Origin": "http://evil.com"})
    assert r.status_code == 403
    assert r.json()["detail"] == "Invalid origin"


def test_auth_errors(client, monkeypatch):
    """401 for: no cookie, invalid token, AuthApiError, refresh without cookie."""
    from supabase_auth.errors import AuthApiError
    from app.core import dependencies as deps_module

    r = client.get("/auth/session")
    assert r.status_code == 401

    class InvalidTokenSupabase:
        class auth:
            @staticmethod
            def get_user(token):
                return type("R", (), {"user": None})()

    monkeypatch.setattr(deps_module, "get_supabase_client", lambda: InvalidTokenSupabase())
    client.cookies.set("chronos_session", "invalid")
    r = client.get("/auth/session")
    assert r.status_code == 401

    class AuthErrorSupabase:
        class auth:
            @staticmethod
            def get_user(token):
                raise AuthApiError("expired", 401, None)

    monkeypatch.setattr(deps_module, "get_supabase_client", lambda: AuthErrorSupabase())
    client.cookies.set("chronos_session", "expired")
    r = client.get("/auth/session")
    assert r.status_code == 401

    client.cookies.clear()
    r = client.post("/auth/refresh", headers=ORIGIN)
    assert r.status_code == 401


def test_delete_google_account(client, monkeypatch):
    """Success, not found (404), wrong user (403), no session (401), invalid UUID (422)."""
    account_id = str(uuid4())

    r = client.delete(f"/auth/google/accounts/{account_id}", headers=ORIGIN)
    assert r.status_code == 401

    app.dependency_overrides[get_current_user] = lambda: MOCK_USER
    r = client.delete("/auth/google/accounts/not-a-uuid", headers=ORIGIN)
    assert r.status_code == 422
    app.dependency_overrides.clear()

    class SuccessSupabase:
        @staticmethod
        def table(name):
            chain = FakeTableChain()
            chain.data = {"id": account_id, "user_id": MOCK_USER["id"], "google_account_tokens": None}
            return chain

    app.dependency_overrides[get_current_user] = lambda: MOCK_USER
    monkeypatch.setattr(auth_router, "get_supabase_client", lambda: SuccessSupabase())

    r = client.delete(f"/auth/google/accounts/{account_id}", headers=ORIGIN)
    assert r.status_code == 200
    assert r.json()["success"] is True

    class NotFoundSupabase:
        @staticmethod
        def table(name):
            chain = FakeTableChain()
            chain.data = None
            return chain

    monkeypatch.setattr(auth_router, "get_supabase_client", lambda: NotFoundSupabase())
    r = client.delete(f"/auth/google/accounts/{uuid4()}", headers=ORIGIN)
    assert r.status_code == 404

    class WrongUserSupabase:
        @staticmethod
        def table(name):
            chain = FakeTableChain()
            chain.data = {"id": account_id, "user_id": "other-user", "google_account_tokens": None}
            return chain

    monkeypatch.setattr(auth_router, "get_supabase_client", lambda: WrongUserSupabase())
    r = client.delete(f"/auth/google/accounts/{account_id}", headers=ORIGIN)
    assert r.status_code == 403

    app.dependency_overrides.clear()


def test_auth_error_cases_comprehensive(client, monkeypatch):
    """Comprehensive error case tests for 90%+ coverage."""
    from supabase_auth.errors import AuthApiError
    import httpx

    # 1. /auth/callback - AuthApiError handling (400 response)
    class CallbackAuthErrorSupabase:
        class auth:
            @staticmethod
            def exchange_code_for_session(params):
                raise AuthApiError("Invalid code", 400, None)

    monkeypatch.setattr(auth_router, "get_supabase_client", lambda: CallbackAuthErrorSupabase())
    r = client.post("/auth/web/callback", json={"code": "invalid-code"}, headers=ORIGIN)
    assert r.status_code == 400
    assert r.json()["detail"] == "Authentication failed"

    # 2. /auth/callback - httpx.HTTPError (502 response)
    class CallbackHttpErrorSupabase:
        class auth:
            @staticmethod
            def exchange_code_for_session(params):
                raise httpx.HTTPError("Connection failed")

    monkeypatch.setattr(auth_router, "get_supabase_client", lambda: CallbackHttpErrorSupabase())
    r = client.post("/auth/web/callback", json={"code": "network-error"}, headers=ORIGIN)
    assert r.status_code == 502
    assert r.json()["detail"] == "External service error"

    # 3. /auth/refresh - refresh_response.session is None (401 response)
    class RefreshNoSessionSupabase:
        class auth:
            @staticmethod
            def refresh_session(token):
                return type("R", (), {"session": None, "user": FakeUser()})()

    monkeypatch.setattr(auth_router, "get_supabase_client", lambda: RefreshNoSessionSupabase())
    client.cookies.set("chronos_refresh", "some-refresh-token")
    r = client.post("/auth/refresh", headers=ORIGIN)
    assert r.status_code == 401
    assert r.json()["detail"] == "Failed to refresh"

    # 4. /auth/refresh - refresh_response.user is None (401 response)
    class RefreshNoUserSupabase:
        class auth:
            @staticmethod
            def refresh_session(token):
                return type("R", (), {"session": FakeSession(), "user": None})()

    monkeypatch.setattr(auth_router, "get_supabase_client", lambda: RefreshNoUserSupabase())
    client.cookies.set("chronos_refresh", "some-refresh-token")
    r = client.post("/auth/refresh", headers=ORIGIN)
    assert r.status_code == 401
    assert r.json()["detail"] == "Failed to get user"

    # 5. /auth/refresh - AuthApiError exception (401 response)
    class RefreshAuthErrorSupabase:
        class auth:
            @staticmethod
            def refresh_session(token):
                raise AuthApiError("Token expired", 401, None)

    monkeypatch.setattr(auth_router, "get_supabase_client", lambda: RefreshAuthErrorSupabase())
    client.cookies.set("chronos_refresh", "expired-refresh-token")
    r = client.post("/auth/refresh", headers=ORIGIN)
    assert r.status_code == 401
    assert r.json()["detail"] == "Refresh failed"
