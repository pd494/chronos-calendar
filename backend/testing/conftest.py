"""Shared test fixtures and utilities."""
import sys
import types
import importlib.util
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def _ensure_dependency_stubs():
    if importlib.util.find_spec("supabase_auth.errors") is None:
        supabase_auth = types.ModuleType("supabase_auth")
        supabase_auth_errors = types.ModuleType("supabase_auth.errors")

        class AuthApiError(Exception):
            def __init__(self, message="", code=None, status=None):
                super().__init__(message)
                self.message = message
                self.code = code
                self.status = status

        setattr(supabase_auth_errors, "AuthApiError", AuthApiError)
        setattr(supabase_auth, "errors", supabase_auth_errors)
        sys.modules["supabase_auth"] = supabase_auth
        sys.modules["supabase_auth.errors"] = supabase_auth_errors


_ensure_dependency_stubs()

from app.main import app
from app.core.dependencies import get_current_user

MOCK_USER = {
    "id": "test-user-123",
    "email": "test@example.com",
    "name": "Test User",
    "avatar_url": None,
}


class FakeTableChain:
    def __init__(self, data=None):
        self.data = data if data is not None else []

    def select(self, *args):
        return self

    def insert(self, data):
        self._insert_data = data
        return self

    def update(self, data):
        self._update_data = data
        return self

    def delete(self):
        return self

    def upsert(self, data, **kwargs):
        self._upsert_data = data
        return self

    def eq(self, *args):
        return self

    def in_(self, *args):
        return self

    def order(self, *args, **kwargs):
        return self

    def limit(self, *args):
        return self

    def maybe_single(self):
        return self

    def single(self):
        return self

    def execute(self):
        return self


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def authenticated_client():
    app.dependency_overrides[get_current_user] = lambda: MOCK_USER
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
