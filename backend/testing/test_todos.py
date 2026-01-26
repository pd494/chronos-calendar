"""
Tests for todos endpoints.
"""
import sys
from pathlib import Path
from uuid import uuid4

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from conftest import FakeTableChain, MOCK_USER
from app.main import app
from app.core.dependencies import get_current_user
from app.core.encryption import Encryption
from app.routers import todos as todos_router


class TestTodosCRUD:
    @pytest.fixture
    def setup_mocks(self, authenticated_client, monkeypatch):
        self.user_id = MOCK_USER["id"]
        self.client = authenticated_client

        def make_fake_supabase(data_map):
            class ConfiguredSupabase:
                def table(self, name):
                    chain = FakeTableChain(data_map.get(name, []))
                    return chain
            return ConfiguredSupabase()

        self.make_fake_supabase = make_fake_supabase
        self.monkeypatch = monkeypatch
        return self

    def test_list_todos_returns_list(self, setup_mocks):
        encrypted_title = Encryption.encrypt("Test Todo", self.user_id)
        todo_data = [{"id": "todo-1", "title": encrypted_title, "user_id": self.user_id, "completed": False}]

        setup_mocks.monkeypatch.setattr(
            todos_router, "get_supabase_client",
            lambda: setup_mocks.make_fake_supabase({"todos": todo_data})
        )

        response = self.client.get("/todos/")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    def test_list_todos_filters_by_list_id(self, setup_mocks):
        list_id = str(uuid4())
        encrypted_title = Encryption.encrypt("Filtered Todo", self.user_id)
        todo_data = [{"id": "todo-1", "title": encrypted_title, "user_id": self.user_id, "list_id": list_id}]

        setup_mocks.monkeypatch.setattr(
            todos_router, "get_supabase_client",
            lambda: setup_mocks.make_fake_supabase({"todos": todo_data})
        )

        response = self.client.get(f"/todos/?listId={list_id}")
        assert response.status_code == 200

    def test_create_todo(self, setup_mocks):
        list_id = str(uuid4())
        encrypted_title = Encryption.encrypt("New Todo", self.user_id)
        created_todo = {"id": "new-todo", "title": encrypted_title, "user_id": self.user_id, "completed": False, "order": -1}
        existing_list = {"id": list_id, "user_id": self.user_id}

        class CreateSupabase:
            def table(self, name):
                if name == "todos":
                    return FakeTableChain([created_todo])
                elif name == "todo_lists":
                    return FakeTableChain([existing_list])
                return FakeTableChain([])

        setup_mocks.monkeypatch.setattr(todos_router, "get_supabase_client", lambda: CreateSupabase())

        response = self.client.post("/todos/", json={"title": "New Todo", "listId": list_id})
        assert response.status_code == 200
        assert "id" in response.json()

    def test_update_todo(self, setup_mocks):
        todo_id = str(uuid4())
        encrypted_title = Encryption.encrypt("Updated Todo", self.user_id)
        updated_todo = {"id": todo_id, "title": encrypted_title, "user_id": self.user_id, "completed": True}

        class UpdateSupabase:
            def table(self, name):
                return FakeTableChain([updated_todo])

        setup_mocks.monkeypatch.setattr(todos_router, "get_supabase_client", lambda: UpdateSupabase())

        response = self.client.put(f"/todos/{todo_id}", json={"completed": True})
        assert response.status_code == 200

    def test_update_nonexistent_todo_returns_404(self, setup_mocks):
        todo_id = str(uuid4())

        class EmptySupabase:
            def table(self, name):
                return FakeTableChain([])

        setup_mocks.monkeypatch.setattr(todos_router, "get_supabase_client", lambda: EmptySupabase())

        response = self.client.put(f"/todos/{todo_id}", json={"completed": True})
        assert response.status_code == 404

    def test_delete_todo(self, setup_mocks):
        todo_id = str(uuid4())
        deleted_todo = {"id": todo_id, "user_id": self.user_id}

        class DeleteSupabase:
            def table(self, name):
                return FakeTableChain([deleted_todo])

        setup_mocks.monkeypatch.setattr(todos_router, "get_supabase_client", lambda: DeleteSupabase())

        response = self.client.delete(f"/todos/{todo_id}")
        assert response.status_code == 200
        assert response.json()["message"] == "Todo deleted"

    def test_delete_nonexistent_todo_returns_404(self, setup_mocks):
        todo_id = str(uuid4())

        class EmptySupabase:
            def table(self, name):
                return FakeTableChain([])

        setup_mocks.monkeypatch.setattr(todos_router, "get_supabase_client", lambda: EmptySupabase())

        response = self.client.delete(f"/todos/{todo_id}")
        assert response.status_code == 404


class TestTodoLists:
    @pytest.fixture
    def setup_mocks(self, authenticated_client, monkeypatch):
        self.user_id = MOCK_USER["id"]
        self.client = authenticated_client
        self.monkeypatch = monkeypatch
        return self

    def test_list_todo_lists(self, setup_mocks):
        encrypted_name = Encryption.encrypt("Work", self.user_id)
        list_data = [{"id": "list-1", "name": encrypted_name, "user_id": self.user_id, "is_system": False}]

        class ListSupabase:
            def table(self, name):
                return FakeTableChain(list_data if name == "todo_lists" else [])

        setup_mocks.monkeypatch.setattr(todos_router, "get_supabase_client", lambda: ListSupabase())

        response = self.client.get("/todos/todo-lists")
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    def test_create_todo_list(self, setup_mocks):
        encrypted_name = Encryption.encrypt("New List", self.user_id)
        created_list = {"id": "new-list", "name": encrypted_name, "user_id": self.user_id, "is_system": False, "order": -1}

        class CreateSupabase:
            def table(self, name):
                return FakeTableChain([created_list] if name == "todo_lists" else [])

        setup_mocks.monkeypatch.setattr(todos_router, "get_supabase_client", lambda: CreateSupabase())

        response = self.client.post("/todos/todo-lists", json={"name": "New List", "color": "#ff0000"})
        assert response.status_code == 200

    def test_update_todo_list(self, setup_mocks):
        list_id = str(uuid4())
        encrypted_name = Encryption.encrypt("Updated List", self.user_id)
        updated_list = {"id": list_id, "name": encrypted_name, "user_id": self.user_id}

        class UpdateSupabase:
            def table(self, name):
                return FakeTableChain([updated_list])

        setup_mocks.monkeypatch.setattr(todos_router, "get_supabase_client", lambda: UpdateSupabase())

        response = self.client.put(f"/todos/todo-lists/{list_id}", json={"name": "Updated List"})
        assert response.status_code == 200

    def test_delete_todo_list(self, setup_mocks):
        list_id = str(uuid4())
        existing_list = {"id": list_id, "is_system": False, "user_id": self.user_id}

        class DeleteSupabase:
            def table(self, name):
                return FakeTableChain([existing_list])

        setup_mocks.monkeypatch.setattr(todos_router, "get_supabase_client", lambda: DeleteSupabase())

        response = self.client.delete(f"/todos/todo-lists/{list_id}")
        assert response.status_code == 200

    def test_delete_system_list_returns_400(self, setup_mocks):
        list_id = str(uuid4())
        system_list = {"id": list_id, "is_system": True, "user_id": self.user_id}

        class SystemListSupabase:
            def table(self, name):
                return FakeTableChain([system_list])

        setup_mocks.monkeypatch.setattr(todos_router, "get_supabase_client", lambda: SystemListSupabase())

        response = self.client.delete(f"/todos/todo-lists/{list_id}")
        assert response.status_code == 400
        assert "system" in response.json()["detail"].lower()

    def test_delete_nonexistent_list_returns_404(self, setup_mocks):
        list_id = str(uuid4())

        class EmptySupabase:
            def table(self, name):
                return FakeTableChain([])

        setup_mocks.monkeypatch.setattr(todos_router, "get_supabase_client", lambda: EmptySupabase())

        response = self.client.delete(f"/todos/todo-lists/{list_id}")
        assert response.status_code == 404


class TestReordering:
    @pytest.fixture
    def setup_mocks(self, authenticated_client, monkeypatch):
        self.user_id = MOCK_USER["id"]
        self.client = authenticated_client
        self.monkeypatch = monkeypatch
        return self

    def test_reorder_todos(self, setup_mocks):
        class ReorderSupabase:
            def table(self, name):
                return FakeTableChain([])

        setup_mocks.monkeypatch.setattr(todos_router, "get_supabase_client", lambda: ReorderSupabase())

        todo_ids = [str(uuid4()), str(uuid4()), str(uuid4())]
        response = self.client.post("/todos/reorder", json={"todoIds": todo_ids})
        assert response.status_code == 200
        assert response.json()["message"] == "Reordered"

    def test_reorder_todo_lists(self, setup_mocks):
        class ReorderSupabase:
            def table(self, name):
                return FakeTableChain([])

        setup_mocks.monkeypatch.setattr(todos_router, "get_supabase_client", lambda: ReorderSupabase())

        category_ids = [str(uuid4()), str(uuid4())]
        response = self.client.post("/todos/todo-lists/reorder", json={"categoryIds": category_ids})
        assert response.status_code == 200
        assert response.json()["message"] == "Reordered"


class TestUserIsolation:
    @pytest.fixture
    def setup_mocks(self, authenticated_client, monkeypatch):
        self.user_id = MOCK_USER["id"]
        self.client = authenticated_client
        self.monkeypatch = monkeypatch
        return self

    def test_update_other_users_todo_returns_404(self, setup_mocks):
        todo_id = str(uuid4())

        class EmptySupabase:
            def table(self, name):
                return FakeTableChain([])

        setup_mocks.monkeypatch.setattr(todos_router, "get_supabase_client", lambda: EmptySupabase())

        response = self.client.put(f"/todos/{todo_id}", json={"completed": True})
        assert response.status_code == 404

    def test_delete_other_users_todo_returns_404(self, setup_mocks):
        todo_id = str(uuid4())

        class EmptySupabase:
            def table(self, name):
                return FakeTableChain([])

        setup_mocks.monkeypatch.setattr(todos_router, "get_supabase_client", lambda: EmptySupabase())

        response = self.client.delete(f"/todos/{todo_id}")
        assert response.status_code == 404
