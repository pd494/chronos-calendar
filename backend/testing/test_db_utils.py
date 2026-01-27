"""Tests for db_utils - first_row and all_rows helpers."""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.core.db_utils import all_rows, first_row


@pytest.mark.parametrize("input_data,expected", [
    ([{"id": 1}, {"id": 2}], {"id": 1}),
    ([{"name": "only"}], {"name": "only"}),
    ({"direct": True}, {"direct": True}),
    ([], None),
    ([42, "string"], None),
    (None, None),
    ("not a list", None),
])
def test_first_row(input_data, expected):
    assert first_row(input_data) == expected


@pytest.mark.parametrize("input_data,expected", [
    ([{"a": 1}, {"b": 2}], [{"a": 1}, {"b": 2}]),
    ([{"ok": True}, 42, "nope", {"also": "ok"}], [{"ok": True}, {"also": "ok"}]),
    ([], []),
    (None, []),
    ("string", []),
])
def test_all_rows(input_data, expected):
    assert all_rows(input_data) == expected
