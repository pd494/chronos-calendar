"""Security middleware tests - 1 test covering dev headers and production HSTS/CSP."""
import sys
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from conftest import _ensure_dependency_stubs

_ensure_dependency_stubs()

from app.main import app
from app.config import get_settings


def test_security_headers(monkeypatch):
    """Dev headers + production HSTS/CSP."""
    with TestClient(app) as client:
        r = client.get("/health")

        assert r.headers.get("X-Content-Type-Options") == "nosniff"
        assert r.headers.get("X-Frame-Options") == "DENY"
        assert r.headers.get("X-XSS-Protection") == "1; mode=block"
        assert r.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"
        assert "geolocation=()" in r.headers.get("Permissions-Policy", "")

        request_id = r.headers.get("X-Request-ID")
        assert request_id is not None
        uuid.UUID(request_id)

    settings = get_settings()
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")

    with TestClient(app) as prod_client:
        r = prod_client.get("/health")

        hsts = r.headers.get("Strict-Transport-Security")
        assert hsts is not None
        assert "max-age=" in hsts

        csp = r.headers.get("Content-Security-Policy")
        assert csp is not None
        assert "default-src" in csp
