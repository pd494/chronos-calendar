"""
Tests for security middleware.
"""
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


class TestSecurityHeaders:
    @pytest.fixture
    def client(self):
        with TestClient(app) as client:
            yield client

    def test_response_includes_x_content_type_options(self, client):
        response = client.get("/health")
        assert response.headers.get("X-Content-Type-Options") == "nosniff"

    def test_response_includes_x_frame_options(self, client):
        response = client.get("/health")
        assert response.headers.get("X-Frame-Options") == "DENY"

    def test_response_includes_x_request_id(self, client):
        response = client.get("/health")
        request_id = response.headers.get("X-Request-ID")
        assert request_id is not None

    def test_x_request_id_is_valid_uuid(self, client):
        response = client.get("/health")
        request_id = response.headers.get("X-Request-ID")
        parsed = uuid.UUID(request_id)
        assert str(parsed) == request_id

    def test_response_includes_xss_protection(self, client):
        response = client.get("/health")
        assert response.headers.get("X-XSS-Protection") == "1; mode=block"

    def test_response_includes_referrer_policy(self, client):
        response = client.get("/health")
        assert response.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"

    def test_response_includes_permissions_policy(self, client):
        response = client.get("/health")
        assert "geolocation=()" in response.headers.get("Permissions-Policy", "")


class TestProductionSecurityHeaders:
    @pytest.fixture
    def production_client(self, monkeypatch):
        original_settings = get_settings()
        monkeypatch.setattr(original_settings, "ENVIRONMENT", "production")
        with TestClient(app) as client:
            yield client

    def test_production_includes_strict_transport_security(self, production_client):
        response = production_client.get("/health")
        hsts = response.headers.get("Strict-Transport-Security")
        assert hsts is not None
        assert "max-age=" in hsts

    def test_production_includes_content_security_policy(self, production_client):
        response = production_client.get("/health")
        csp = response.headers.get("Content-Security-Policy")
        assert csp is not None
        assert "default-src" in csp
