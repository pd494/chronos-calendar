"""Validation tests - 1 test covering title too long, invalid color, invalid UUID."""
import sys
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from conftest import FakeTableChain, MOCK_USER
from app.routers import todos as todos_router


def test_input_validation(authenticated_client, monkeypatch):
    """Title too long, invalid color, invalid UUID for 95% coverage."""
    user_id = MOCK_USER["id"]
    list_id = str(uuid4())

    class ValidSupabase:
        def table(self, name):
            if name == "todo_lists":
                return FakeTableChain([{"id": list_id, "user_id": user_id}])
            return FakeTableChain([{"id": "new", "title": "x", "user_id": user_id}])

    monkeypatch.setattr(todos_router, "get_supabase_client", lambda: ValidSupabase())

    r = authenticated_client.post("/todos", json={"title": "x" * 501, "listId": list_id})
    assert r.status_code == 422

    r = authenticated_client.post("/todos/todo-lists", json={"name": "x" * 101, "color": "#ff0000"})
    assert r.status_code == 422

    r = authenticated_client.post("/todos/todo-lists", json={"name": "Test", "color": "red"})
    assert r.status_code == 422

    r = authenticated_client.post("/todos/todo-lists", json={"name": "Test", "color": "#gg0000"})
    assert r.status_code == 422

    r = authenticated_client.post("/todos/todo-lists", json={"name": "Test", "color": "#ff00"})
    assert r.status_code == 422

    r = authenticated_client.put("/todos/not-a-uuid", json={"completed": True})
    assert r.status_code == 422

    r = authenticated_client.delete("/todos/not-a-uuid")
    assert r.status_code == 422

    r = authenticated_client.post("/todos/reorder", json={"todoIds": ["not-a-uuid"]})
    assert r.status_code == 422
