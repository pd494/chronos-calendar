import logging
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query

from app.core.dependencies import CurrentUser
from app.core.supabase import SupabaseClient
from app.models.todo import TodoCreate, TodoUpdate, ReorderRequest, TodoListCreate, TodoListUpdate, CategoryReorderRequest

logger = logging.getLogger(__name__)

router = APIRouter()

Row = dict[str, Any]


def _first_row(data: Any) -> Row | None:
    if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
        return data[0]
    if isinstance(data, dict):
        return data
    return None


def _all_rows(data: Any) -> list[Row]:
    if isinstance(data, list):
        return [r for r in data if isinstance(r, dict)]
    return []


def to_snake_case(data: dict) -> dict:
    field_map = {
        "listId": "list_id",
        "scheduledDate": "scheduled_date",
        "userId": "user_id",
        "createdAt": "created_at",
        "updatedAt": "updated_at",
        "isSystem": "is_system",
        "todoIds": "todo_ids",
        "categoryIds": "category_ids",
    }
    return {field_map.get(k, k): v for k, v in data.items()}


def to_camel_case(data: dict) -> dict:
    field_map = {
        "user_id": "userId",
        "list_id": "listId",
        "scheduled_date": "scheduledDate",
        "created_at": "createdAt",
        "updated_at": "updatedAt",
        "is_system": "isSystem"
    }
    return {field_map.get(k, k): v for k, v in data.items()}


@router.get("/")
async def list_todos(
    current_user: CurrentUser,
    listId: str | None = Query(None)
):
    supabase = SupabaseClient.get_client()
    query = supabase.table("todos").select("*").eq("user_id", current_user["id"])

    if listId and listId != "all":
        query = query.eq("list_id", listId)

    result = query.order("order").execute()
    return [to_camel_case(todo) for todo in _all_rows(result.data)]


@router.post("/")
async def create_todo(todo: TodoCreate, current_user: CurrentUser):
    supabase = SupabaseClient.get_client()

    min_order_result = (
        supabase.table("todos")
        .select("order")
        .eq("user_id", current_user["id"])
        .order("order")
        .limit(1)
        .execute()
    )
    first = _first_row(min_order_result.data)
    min_order = first["order"] if first else 0
    new_order = min_order - 1

    todo_data = {
        "user_id": current_user["id"],
        "title": todo.title,
        "list_id": todo.listId,
        "scheduled_date": todo.scheduledDate,
        "order": new_order,
        "completed": False
    }

    result = supabase.table("todos").insert(todo_data).execute()
    row = _first_row(result.data)
    if not row:
        raise HTTPException(status_code=500, detail="Failed to create todo")
    return to_camel_case(row)


@router.put("/{todo_id}")
async def update_todo(todo_id: UUID, todo: TodoUpdate, current_user: CurrentUser):
    supabase = SupabaseClient.get_client()
    update_data = to_snake_case(todo.model_dump(exclude_unset=True))

    result = (
        supabase.table("todos")
        .update(update_data)
        .eq("id", str(todo_id))
        .eq("user_id", current_user["id"])
        .execute()
    )

    row = _first_row(result.data)
    if not row:
        raise HTTPException(status_code=404, detail="Todo not found")
    return to_camel_case(row)


@router.delete("/{todo_id}")
async def delete_todo(todo_id: UUID, current_user: CurrentUser):
    supabase = SupabaseClient.get_client()

    result = (
        supabase.table("todos")
        .delete()
        .eq("id", str(todo_id))
        .eq("user_id", current_user["id"])
        .execute()
    )

    if not _first_row(result.data):
        raise HTTPException(status_code=404, detail="Todo not found")

    return {"message": "Todo deleted"}


@router.get("/todo-lists")
async def list_todo_lists(current_user: CurrentUser):
    supabase = SupabaseClient.get_client()

    result = (
        supabase.table("todo_lists")
        .select("*")
        .eq("user_id", current_user["id"])
        .order("order")
        .execute()
    )

    return [to_camel_case(list_item) for list_item in _all_rows(result.data)]


@router.post("/todo-lists")
async def create_todo_list(todo_list: TodoListCreate, current_user: CurrentUser):
    supabase = SupabaseClient.get_client()

    min_order_result = (
        supabase.table("todo_lists")
        .select("order")
        .eq("user_id", current_user["id"])
        .order("order")
        .limit(1)
        .execute()
    )
    first = _first_row(min_order_result.data)
    min_order = first["order"] if first else 0
    new_order = min_order - 1

    list_data = {
        "user_id": current_user["id"],
        "name": todo_list.name,
        "color": todo_list.color,
        "is_system": False,
        "order": new_order
    }

    result = supabase.table("todo_lists").insert(list_data).execute()
    row = _first_row(result.data)
    if not row:
        raise HTTPException(status_code=500, detail="Failed to create todo list")
    return to_camel_case(row)


@router.put("/todo-lists/{list_id}")
async def update_todo_list(list_id: UUID, todo_list: TodoListUpdate, current_user: CurrentUser):
    supabase = SupabaseClient.get_client()
    update_data = {k: v for k, v in todo_list.model_dump(exclude_unset=True).items() if v is not None}

    result = (
        supabase.table("todo_lists")
        .update(update_data)
        .eq("id", str(list_id))
        .eq("user_id", current_user["id"])
        .execute()
    )

    row = _first_row(result.data)
    if not row:
        raise HTTPException(status_code=404, detail="List not found")

    return to_camel_case(row)


@router.delete("/todo-lists/{list_id}")
async def delete_todo_list(list_id: UUID, current_user: CurrentUser):
    supabase = SupabaseClient.get_client()

    existing = (
        supabase.table("todo_lists")
        .select("is_system")
        .eq("id", str(list_id))
        .eq("user_id", current_user["id"])
        .execute()
    )

    row = _first_row(existing.data)
    if not row:
        raise HTTPException(status_code=404, detail="List not found")

    if row["is_system"]:
        raise HTTPException(status_code=400, detail="Cannot delete system list")

    supabase.table("todo_lists").delete().eq("id", str(list_id)).eq("user_id", current_user["id"]).execute()
    return {"message": "List deleted"}


@router.post("/todo-lists/reorder")
async def reorder_todo_lists(request: CategoryReorderRequest, current_user: CurrentUser):
    supabase = SupabaseClient.get_client()
    try:
        supabase.rpc(
            "bulk_reorder_todo_lists",
            {"p_user_id": current_user["id"], "p_list_ids": request.categoryIds}
        ).execute()
    except Exception as e:
        logger.error("Failed to reorder todo lists: %s", e)
        raise HTTPException(status_code=500, detail="Failed to reorder todo lists")
    return {"message": "Reordered"}


@router.post("/reorder")
async def reorder_todos(request: ReorderRequest, current_user: CurrentUser):
    supabase = SupabaseClient.get_client()
    try:
        supabase.rpc(
            "bulk_reorder_todos",
            {"p_user_id": current_user["id"], "p_todo_ids": request.todoIds}
        ).execute()
    except Exception as e:
        logger.error("Failed to reorder todos: %s", e)
        raise HTTPException(status_code=500, detail="Failed to reorder todos")
    return {"message": "Reordered"}
