"""Todos endpoint tests - 3 tests covering CRUD and errors."""
import sys
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from conftest import FakeTableChain, MOCK_USER
from app.core.encryption import Encryption
from app.routers import todos as todos_router


class CapturingTableChain(FakeTableChain):
    """FakeTableChain that captures insert/update data and returns it encrypted."""

    def __init__(self, data=None, user_id=None):
        super().__init__(data)
        self.user_id = user_id
        self.captured_insert = None
        self.captured_update = None

    def insert(self, data):
        self.captured_insert = data
        self.data = [{**data, "id": str(uuid4()), "order": -1}]
        return self

    def update(self, data):
        self.captured_update = data
        if self.data:
            self.data = [{**self.data[0], **data}]
        return self


def test_todos_crud(authenticated_client, monkeypatch):
    """List, create, update, delete - verify encrypted storage and decrypted response."""
    user_id = MOCK_USER["id"]
    list_id = str(uuid4())
    todo_id = str(uuid4())

    existing_encrypted = Encryption.encrypt("Existing Todo", user_id)

    class ListSupabase:
        def table(self, name):
            return FakeTableChain([{"id": todo_id, "title": existing_encrypted, "user_id": user_id, "completed": False}])

    monkeypatch.setattr(todos_router, "get_supabase_client", lambda: ListSupabase())
    r = authenticated_client.get("/todos")
    assert r.status_code == 200
    assert r.json()[0]["title"] == "Existing Todo"

    todos_chain = CapturingTableChain(user_id=user_id)
    lists_chain = FakeTableChain([{"id": list_id, "user_id": user_id}])

    class CreateSupabase:
        def table(self, name):
            return lists_chain if name == "todo_lists" else todos_chain

    monkeypatch.setattr(todos_router, "get_supabase_client", lambda: CreateSupabase())
    r = authenticated_client.post("/todos", json={"title": "New Todo", "listId": list_id})
    assert r.status_code == 200
    assert r.json()["title"] == "New Todo"
    assert todos_chain.captured_insert["title"] != "New Todo"
    assert Encryption.decrypt(todos_chain.captured_insert["title"], user_id) == "New Todo"

    update_chain = CapturingTableChain([{"id": todo_id, "title": existing_encrypted, "user_id": user_id, "completed": False}], user_id)

    class UpdateSupabase:
        def table(self, name):
            return update_chain

    monkeypatch.setattr(todos_router, "get_supabase_client", lambda: UpdateSupabase())
    r = authenticated_client.put(f"/todos/{todo_id}", json={"title": "Updated Todo", "completed": True})
    assert r.status_code == 200
    assert r.json()["title"] == "Updated Todo"
    assert update_chain.captured_update["title"] != "Updated Todo"
    assert Encryption.decrypt(update_chain.captured_update["title"], user_id) == "Updated Todo"

    class DeleteSupabase:
        def table(self, name):
            return FakeTableChain([{"id": todo_id, "user_id": user_id}])

    monkeypatch.setattr(todos_router, "get_supabase_client", lambda: DeleteSupabase())
    r = authenticated_client.delete(f"/todos/{todo_id}")
    assert r.status_code == 200


def test_todo_lists_crud(authenticated_client, monkeypatch):
    """List, create, update, delete - verify encrypted storage and decrypted response."""
    user_id = MOCK_USER["id"]
    list_id = str(uuid4())

    existing_encrypted = Encryption.encrypt("Work", user_id)

    class ListSupabase:
        def table(self, name):
            return FakeTableChain([{"id": list_id, "name": existing_encrypted, "user_id": user_id, "is_system": False}])

    monkeypatch.setattr(todos_router, "get_supabase_client", lambda: ListSupabase())
    r = authenticated_client.get("/todos/todo-lists")
    assert r.status_code == 200
    assert r.json()[0]["name"] == "Work"

    create_chain = CapturingTableChain(user_id=user_id)

    class CreateSupabase:
        def table(self, name):
            return create_chain

    monkeypatch.setattr(todos_router, "get_supabase_client", lambda: CreateSupabase())
    r = authenticated_client.post("/todos/todo-lists", json={"name": "New List", "color": "#ff0000"})
    assert r.status_code == 200
    assert r.json()["name"] == "New List"
    assert create_chain.captured_insert["name"] != "New List"
    assert Encryption.decrypt(create_chain.captured_insert["name"], user_id) == "New List"

    update_chain = CapturingTableChain([{"id": list_id, "name": existing_encrypted, "user_id": user_id, "is_system": False}], user_id)

    class UpdateSupabase:
        def table(self, name):
            return update_chain

    monkeypatch.setattr(todos_router, "get_supabase_client", lambda: UpdateSupabase())
    r = authenticated_client.put(f"/todos/todo-lists/{list_id}", json={"name": "Updated List"})
    assert r.status_code == 200
    assert r.json()["name"] == "Updated List"
    assert update_chain.captured_update["name"] != "Updated List"
    assert Encryption.decrypt(update_chain.captured_update["name"], user_id) == "Updated List"

    class DeleteSupabase:
        def table(self, name):
            return FakeTableChain([{"id": list_id, "is_system": False, "user_id": user_id}])

    monkeypatch.setattr(todos_router, "get_supabase_client", lambda: DeleteSupabase())
    r = authenticated_client.delete(f"/todos/todo-lists/{list_id}")
    assert r.status_code == 200


def test_todos_errors(authenticated_client, monkeypatch):
    """404 cases, system list (400), invalid listId (400)."""
    user_id = MOCK_USER["id"]

    class EmptySupabase:
        def table(self, name):
            return FakeTableChain([])

    monkeypatch.setattr(todos_router, "get_supabase_client", lambda: EmptySupabase())

    r = authenticated_client.put(f"/todos/{uuid4()}", json={"completed": True})
    assert r.status_code == 404

    r = authenticated_client.delete(f"/todos/{uuid4()}")
    assert r.status_code == 404

    r = authenticated_client.delete(f"/todos/todo-lists/{uuid4()}")
    assert r.status_code == 404

    list_id = str(uuid4())

    class SystemListSupabase:
        def table(self, name):
            return FakeTableChain([{"id": list_id, "is_system": True, "user_id": user_id}])

    monkeypatch.setattr(todos_router, "get_supabase_client", lambda: SystemListSupabase())
    r = authenticated_client.delete(f"/todos/todo-lists/{list_id}")
    assert r.status_code == 400

    class InvalidListSupabase:
        def table(self, name):
            return FakeTableChain([])

    monkeypatch.setattr(todos_router, "get_supabase_client", lambda: InvalidListSupabase())
    r = authenticated_client.post("/todos", json={"title": "Test", "listId": str(uuid4())})
    assert r.status_code == 400
