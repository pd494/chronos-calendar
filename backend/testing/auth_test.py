"""
Integration tests for auth endpoints using FastAPI TestClient.
Run: cd backend && ./venv/bin/python -m pytest testing/auth_test.py -v

Two testing layers:
1. Dependency Override - Override get_current_user for protected endpoints
2. Supabase Mock - Mock get_supabase_client for auth flow endpoints
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from conftest import _ensure_dependency_stubs, FakeTableChain, MOCK_USER

_ensure_dependency_stubs()

from app.main import app
from app.core.dependencies import get_current_user
from app.routers import auth as auth_router
from app.config import get_settings


# =============================================================================
# Layer 1: Dependency Override Tests
# Override get_current_user to test protected endpoints without real auth
# =============================================================================

class TestProtectedEndpointsWithOverride:
    @pytest.fixture
    def authenticated_client(self):
        def override_get_current_user():
            return MOCK_USER

        app.dependency_overrides[get_current_user] = override_get_current_user
        with TestClient(app) as client:
            yield client
        app.dependency_overrides.clear()

    def test_session_returns_401_without_auth(self):
        with TestClient(app) as client:
            response = client.get("/auth/session")
            assert response.status_code == 401
            assert response.json()["detail"] == "Not authenticated"


# =============================================================================
# Layer 2: Supabase Mock Tests
# Mock get_supabase_client to test the actual auth flow logic
# =============================================================================

class TestGoogleOAuthFlow:
    @pytest.fixture
    def client(self):
        with TestClient(app) as client:
            yield client

    def test_google_login_returns_redirect_url(self, client: TestClient, monkeypatch: pytest.MonkeyPatch):
        class FakeOAuthResponse:
            url = "https://accounts.google.com/o/oauth2/v2/auth?client_id=test&scope=calendar"

        class FakeAuth:
            def sign_in_with_oauth(self, params: dict) -> FakeOAuthResponse:
                assert params["provider"] == "google"
                assert "calendar" in params["options"]["scopes"]
                return FakeOAuthResponse()

        class FakeSupabase:
            auth = FakeAuth()

        monkeypatch.setattr(auth_router, "get_supabase_client", lambda: FakeSupabase())

        response = client.get("/auth/google/login")

        assert response.status_code == 200
        data = response.json()
        assert "redirectUrl" in data
        assert "accounts.google.com" in data["redirectUrl"]
        # No OAuth state cookie - Supabase handles CSRF via PKCE

    def test_callback_exchanges_code_for_session(self, client: TestClient, monkeypatch: pytest.MonkeyPatch):
        class FakeIdentity:
            provider = "google"
            id = "google-id-123"
            identity_data = {"email": "test@gmail.com", "full_name": "Test User"}

        class FakeUser:
            id = "user-123"
            email = "test@gmail.com"
            user_metadata = {"name": "Test User", "avatar_url": "https://example.com/pic.jpg"}
            identities = [FakeIdentity()]

        class FakeSession:
            access_token = "access-token-xyz"
            refresh_token = "refresh-token-xyz"
            provider_token = "google-access-token"
            provider_refresh_token = "google-refresh-token"

        class FakeAuthResponse:
            session = FakeSession()
            user = FakeUser()

        class FakeAuth:
            def exchange_code_for_session(self, params: dict) -> FakeAuthResponse:
                assert "auth_code" in params
                return FakeAuthResponse()

        class FakeSupabase:
            auth = FakeAuth()

            def table(self, name: str) -> FakeTableChain:
                return FakeTableChain([{"id": "account-123"}])

        def fake_store_google_account(*args, **kwargs):
            return "account-123"

        monkeypatch.setattr(auth_router, "get_supabase_client", lambda: FakeSupabase())
        monkeypatch.setattr(auth_router, "store_google_account", fake_store_google_account)

        response = client.post("/auth/callback?code=test-auth-code-123")

        assert response.status_code == 200
        data = response.json()
        assert data["user"]["id"] == "user-123"
        assert data["user"]["email"] == "test@gmail.com"
        assert "expires_at" in data
        assert "chronos_session" in response.cookies
        assert response.cookies["chronos_session"] == "access-token-xyz"

    def test_callback_sets_both_session_and_refresh_cookies(self, client: TestClient, monkeypatch: pytest.MonkeyPatch):
        class FakeIdentity:
            provider = "google"
            id = "google-id-123"
            identity_data = {"email": "test@gmail.com"}

        class FakeUser:
            id = "user-123"
            email = "test@gmail.com"
            user_metadata = {}
            identities = [FakeIdentity()]

        class FakeSession:
            access_token = "access-token"
            refresh_token = "refresh-token"
            provider_token = None
            provider_refresh_token = None

        class FakeAuthResponse:
            session = FakeSession()
            user = FakeUser()

        class FakeAuth:
            def exchange_code_for_session(self, params: dict) -> FakeAuthResponse:
                return FakeAuthResponse()

        class FakeSupabase:
            auth = FakeAuth()
            def table(self, name: str) -> FakeTableChain:
                return FakeTableChain([{"id": "account-123"}])

        monkeypatch.setattr(auth_router, "get_supabase_client", lambda: FakeSupabase())

        response = client.post("/auth/callback?code=test-code")

        assert "chronos_session" in response.cookies
        assert "chronos_refresh" in response.cookies

    def test_callback_fails_without_code(self, client: TestClient):
        response = client.post("/auth/callback")
        assert response.status_code == 422

    def test_callback_fails_when_exchange_returns_no_session(self, client: TestClient, monkeypatch: pytest.MonkeyPatch):
        class FakeAuthResponse:
            session = None
            user = None

        class FakeAuth:
            def exchange_code_for_session(self, params: dict) -> FakeAuthResponse:
                return FakeAuthResponse()

        class FakeSupabase:
            auth = FakeAuth()

        monkeypatch.setattr(auth_router, "get_supabase_client", lambda: FakeSupabase())

        response = client.post("/auth/callback?code=bad-code")
        assert response.status_code == 400

    def test_session_validates_cookie(self, client: TestClient, monkeypatch: pytest.MonkeyPatch):
        class FakeUser:
            id = "user-123"
            email = "test@example.com"
            user_metadata = {"name": "Test User"}

        class FakeUserResponse:
            user = FakeUser()

        class FakeAuth:
            def get_user(self, token: str) -> FakeUserResponse:
                assert token == "valid-session-token"
                return FakeUserResponse()

        class FakeSupabase:
            auth = FakeAuth()

            def table(self, name: str) -> FakeTableChain:
                chain = FakeTableChain()
                chain.data = {"id": "user-123", "email": "test@example.com", "name": "Test User"}
                return chain

        monkeypatch.setattr(auth_router, "get_supabase_client", lambda: FakeSupabase())

        client.cookies.set("chronos_session", "valid-session-token")
        response = client.get("/auth/session")

        assert response.status_code == 200
        data = response.json()
        assert data["user"]["id"] == "user-123"
        assert "expires_at" in data

    def test_session_returns_401_with_invalid_token(self, client: TestClient, monkeypatch: pytest.MonkeyPatch):
        class FakeUserResponse:
            user = None

        class FakeAuth:
            def get_user(self, token: str):
                return FakeUserResponse()

        class FakeSupabase:
            auth = FakeAuth()

        monkeypatch.setattr(auth_router, "get_supabase_client", lambda: FakeSupabase())

        client.cookies.set("chronos_session", "invalid-token")
        response = client.get("/auth/session")

        assert response.status_code == 401

    def test_session_returns_401_on_auth_api_error(self, client: TestClient, monkeypatch: pytest.MonkeyPatch):
        from supabase_auth.errors import AuthApiError

        class FakeAuth:
            def get_user(self, token: str):
                raise AuthApiError("Token expired", 401, None)

        class FakeSupabase:
            auth = FakeAuth()

        monkeypatch.setattr(auth_router, "get_supabase_client", lambda: FakeSupabase())

        client.cookies.set("chronos_session", "expired-token")
        response = client.get("/auth/session")

        assert response.status_code == 401

    def test_logout_clears_both_cookies(self, client: TestClient, monkeypatch: pytest.MonkeyPatch):
        class FakeAuth:
            def set_session(self, access_token, refresh_token):
                pass
            def sign_out(self):
                pass

        class FakeSupabase:
            auth = FakeAuth()

        monkeypatch.setattr(auth_router, "get_supabase_client", lambda: FakeSupabase())

        client.cookies.set("chronos_session", "some-token")
        client.cookies.set("chronos_refresh", "some-refresh-token")
        response = client.post("/auth/logout")

        assert response.status_code == 200
        assert response.json()["message"] == "Logged out"

    def test_logout_works_without_cookies(self, client: TestClient):
        response = client.post("/auth/logout")

        assert response.status_code == 200
        assert response.json()["message"] == "Logged out"

    def test_refresh_with_valid_token(self, client: TestClient, monkeypatch: pytest.MonkeyPatch):
        class FakeUser:
            id = "user-123"

        class FakeSession:
            access_token = "new-access-token"
            refresh_token = "new-refresh-token"

        class FakeRefreshResponse:
            session = FakeSession()
            user = FakeUser()

        class FakeAuth:
            def refresh_session(self, token: str) -> FakeRefreshResponse:
                return FakeRefreshResponse()

        class FakeSupabase:
            auth = FakeAuth()

            def table(self, name: str) -> FakeTableChain:
                chain = FakeTableChain()
                chain.data = {"id": "user-123", "email": "test@example.com"}
                return chain

        monkeypatch.setattr(auth_router, "get_supabase_client", lambda: FakeSupabase())

        client.cookies.set("chronos_refresh", "old-refresh-token")
        response = client.post("/auth/refresh")

        assert response.status_code == 200
        assert "chronos_session" in response.cookies

    def test_refresh_returns_401_without_cookie(self, client: TestClient):
        response = client.post("/auth/refresh")
        assert response.status_code == 401
        assert response.json()["detail"] == "Not authenticated"

    def test_refresh_returns_401_with_invalid_token(self, client: TestClient, monkeypatch: pytest.MonkeyPatch):
        class FakeRefreshResponse:
            session = None
            user = None

        class FakeAuth:
            def refresh_session(self, token: str) -> FakeRefreshResponse:
                return FakeRefreshResponse()

        class FakeSupabase:
            auth = FakeAuth()

        monkeypatch.setattr(auth_router, "get_supabase_client", lambda: FakeSupabase())

        client.cookies.set("chronos_refresh", "invalid-refresh-token")
        response = client.post("/auth/refresh")

        assert response.status_code == 401


class TestSetSession:
    @pytest.fixture
    def client(self):
        with TestClient(app) as client:
            yield client

    def test_set_session_with_valid_token(self, client: TestClient, monkeypatch: pytest.MonkeyPatch):
        class FakeUser:
            id = "user-123"
            email = "test@example.com"

        class FakeUserResponse:
            user = FakeUser()

        class FakeAuth:
            def get_user(self, token: str):
                return FakeUserResponse()

        class FakeSupabase:
            auth = FakeAuth()

        monkeypatch.setattr(auth_router, "get_supabase_client", lambda: FakeSupabase())

        response = client.post("/auth/set-session", json={"access_token": "valid-token"})

        assert response.status_code == 200
        assert response.json()["success"] is True
        assert "chronos_session" in response.cookies

    def test_set_session_with_invalid_token_returns_401(self, client: TestClient, monkeypatch: pytest.MonkeyPatch):
        class FakeUserResponse:
            user = None

        class FakeAuth:
            def get_user(self, token: str):
                return FakeUserResponse()

        class FakeSupabase:
            auth = FakeAuth()

        monkeypatch.setattr(auth_router, "get_supabase_client", lambda: FakeSupabase())

        response = client.post("/auth/set-session", json={"access_token": "invalid-token"})

        assert response.status_code == 401


class TestStoreTokens:
    @pytest.fixture
    def client(self):
        with TestClient(app) as client:
            yield client

    def test_store_tokens_with_valid_session(self, client: TestClient, monkeypatch: pytest.MonkeyPatch):
        class FakeIdentity:
            provider = "google"
            id = "google-id-123"
            identity_data = {"email": "test@gmail.com"}

        class FakeUser:
            id = "user-123"
            email = "test@example.com"
            user_metadata = {}
            identities = [FakeIdentity()]

        class FakeUserResponse:
            user = FakeUser()

        class FakeAuth:
            def get_user(self, token: str):
                return FakeUserResponse()

        class FakeSupabase:
            auth = FakeAuth()
            def table(self, name: str):
                return FakeTableChain([{"id": "account-123"}])

        def fake_store_google_account(*args, **kwargs):
            return "account-123"

        monkeypatch.setattr(auth_router, "get_supabase_client", lambda: FakeSupabase())
        monkeypatch.setattr(auth_router, "store_google_account", fake_store_google_account)

        client.cookies.set("chronos_session", "valid-token")
        response = client.post("/auth/google/store-tokens", json={
            "provider_token": "google-token",
            "provider_refresh_token": "google-refresh"
        })

        assert response.status_code == 200
        assert response.json()["success"] is True

    def test_store_tokens_without_session_returns_401(self, client: TestClient):
        response = client.post("/auth/google/store-tokens", json={
            "provider_token": "google-token"
        })

        assert response.status_code == 401
