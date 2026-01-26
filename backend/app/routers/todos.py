import asyncio
import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import get_settings
from app.core.dependencies import CurrentUser
from app.core.encryption import Encryption
from app.core.supabase import get_supabase_client
from app.models.todo import TodoCreate, TodoUpdate, ReorderRequest, TodoListCreate, TodoListUpdate, CategoryReorderRequest

limiter = Limiter(key_func=get_remote_address)
settings = get_settings()
logger = logging.getLogger(__name__)
router = APIRouter()

CAMEL_TO_SNAKE = {"listId": "list_id", "scheduledDate": "scheduled_date"}
SNAKE_TO_CAMEL = {
    "user_id": "userId",
    "list_id": "listId",
    "scheduled_date": "scheduledDate",
    "created_at": "createdAt",
    "updated_at": "updatedAt",
    "is_system": "isSystem",
}


def to_snake_case(data: dict) -> dict:
    return {CAMEL_TO_SNAKE.get(k, k): v for k, v in data.items()}


def to_camel_case(data: dict) -> dict:
    return {SNAKE_TO_CAMEL.get(k, k): v for k, v in data.items()}


def decrypt_todo(todo: dict, user_id: str) -> dict:
    result = dict(todo)
    if result.get("title"):
        try:
            result["title"] = Encryption.decrypt(result["title"], user_id)
        except ValueError:
            logger.warning("Failed to decrypt todo title for todo %s", result.get("id"))
            result["title"] = "[Decryption Error]"
    return result


def decrypt_list(todo_list: dict, user_id: str) -> dict:
    result = dict(todo_list)
    if result.get("name") and not result.get("is_system"):
        try:
            result["name"] = Encryption.decrypt(result["name"], user_id)
        except ValueError:
            logger.warning("Failed to decrypt list name for list %s", result.get("id"))
            result["name"] = "[Decryption Error]"
    return result


def get_next_order(supabase, table: str, user_id: str) -> int:
    result = (
        supabase.table(table)
        .select("order")
        .eq("user_id", user_id)
        .order("order")
        .limit(1)
        .execute()
    )
    min_order = result.data[0]["order"] if result.data else 0
    return min_order - 1


@router.get("/")
@limiter.limit(settings.RATE_LIMIT_API)
async def list_todos(
    request: Request,
    current_user: CurrentUser,
    listId: str | None = Query(None)
):
    supabase = get_supabase_client()
    user_id = current_user["id"]
    query = (
        supabase.table("todos")
        .select("*")
        .eq("user_id", user_id)
    )

    if listId and listId != "all":
        query = query.eq("list_id", listId)

    result = query.order("order").execute()
    return [to_camel_case(decrypt_todo(todo, user_id)) for todo in result.data]


@router.post("/")
@limiter.limit(settings.RATE_LIMIT_API)
async def create_todo(request: Request, todo: TodoCreate, current_user: CurrentUser):
    supabase = get_supabase_client()
    user_id = current_user["id"]

    list_check = (
        supabase.table("todo_lists")
        .select("id")
        .eq("id", todo.listId)
        .eq("user_id", user_id)
        .execute()
    )
    if not list_check.data:
        raise HTTPException(status_code=400, detail="Invalid list_id")

    todo_data = {
        "user_id": user_id,
        "title": Encryption.encrypt(todo.title, user_id),
        "list_id": todo.listId,
        "scheduled_date": str(todo.scheduledDate) if todo.scheduledDate else None,
        "order": get_next_order(supabase, "todos", user_id),
        "completed": False,
    }

    result = supabase.table("todos").insert(todo_data).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create todo")
    return to_camel_case(decrypt_todo(result.data[0], user_id))


@router.put("/{todo_id}")
@limiter.limit(settings.RATE_LIMIT_API)
async def update_todo(request: Request, todo_id: UUID, todo: TodoUpdate, current_user: CurrentUser):
    supabase = get_supabase_client()
    user_id = current_user["id"]
    update_data = to_snake_case(todo.model_dump(exclude_unset=True))

    if "list_id" in update_data and update_data["list_id"]:
        list_check = (
            supabase.table("todo_lists")
            .select("id")
            .eq("id", update_data["list_id"])
            .eq("user_id", user_id)
            .execute()
        )
        if not list_check.data:
            raise HTTPException(status_code=400, detail="Invalid list_id")

    if "title" in update_data and update_data["title"]:
        update_data["title"] = Encryption.encrypt(update_data["title"], user_id)

    if "scheduled_date" in update_data and update_data["scheduled_date"]:
        update_data["scheduled_date"] = str(update_data["scheduled_date"])

    result = (
        supabase.table("todos")
        .update(update_data)
        .eq("id", str(todo_id))
        .eq("user_id", user_id)
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="Todo not found")

    return to_camel_case(decrypt_todo(result.data[0], user_id))


@router.delete("/{todo_id}")
@limiter.limit(settings.RATE_LIMIT_API)
async def delete_todo(request: Request, todo_id: UUID, current_user: CurrentUser):
    supabase = get_supabase_client()

    result = (
        supabase.table("todos")
        .delete()
        .eq("id", str(todo_id))
        .eq("user_id", current_user["id"])
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="Todo not found")

    return {"message": "Todo deleted"}


@router.get("/todo-lists")
@limiter.limit(settings.RATE_LIMIT_API)
async def list_todo_lists(request: Request, current_user: CurrentUser):
    supabase = get_supabase_client()
    user_id = current_user["id"]

    result = (
        supabase.table("todo_lists")
        .select("*")
        .eq("user_id", user_id)
        .order("order")
        .execute()
    )

    return [to_camel_case(decrypt_list(item, user_id)) for item in result.data]


@router.post("/todo-lists")
@limiter.limit(settings.RATE_LIMIT_API)
async def create_todo_list(request: Request, todo_list: TodoListCreate, current_user: CurrentUser):
    supabase = get_supabase_client()
    user_id = current_user["id"]

    list_data = {
        "user_id": user_id,
        "name": Encryption.encrypt(todo_list.name, user_id),
        "color": todo_list.color,
        "is_system": False,
        "order": get_next_order(supabase, "todo_lists", user_id),
    }

    result = supabase.table("todo_lists").insert(list_data).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create list")
    return to_camel_case(decrypt_list(result.data[0], user_id))


@router.put("/todo-lists/{list_id}")
@limiter.limit(settings.RATE_LIMIT_API)
async def update_todo_list(request: Request, list_id: UUID, todo_list: TodoListUpdate, current_user: CurrentUser):
    supabase = get_supabase_client()
    user_id = current_user["id"]
    update_data = todo_list.model_dump(exclude_unset=True)

    if "name" in update_data and update_data["name"]:
        update_data["name"] = Encryption.encrypt(update_data["name"], user_id)

    result = (
        supabase.table("todo_lists")
        .update(update_data)
        .eq("id", str(list_id))
        .eq("user_id", user_id)
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="List not found")

    return to_camel_case(decrypt_list(result.data[0], user_id))


@router.delete("/todo-lists/{list_id}")
@limiter.limit(settings.RATE_LIMIT_API)
async def delete_todo_list(request: Request, list_id: UUID, current_user: CurrentUser):
    supabase = get_supabase_client()
    user_id = current_user["id"]

    existing = (
        supabase.table("todo_lists")
        .select("is_system")
        .eq("id", str(list_id))
        .eq("user_id", user_id)
        .execute()
    )

    if not existing.data:
        raise HTTPException(status_code=404, detail="List not found")

    if existing.data[0]["is_system"]:
        raise HTTPException(status_code=400, detail="Cannot delete system list")

    (
        supabase.table("todo_lists")
        .delete()
        .eq("id", str(list_id))
        .eq("user_id", user_id)
        .execute()
    )
    return {"message": "List deleted"}


@router.post("/todo-lists/reorder")
@limiter.limit(settings.RATE_LIMIT_API)
async def reorder_todo_lists(request: Request, reorder_request: CategoryReorderRequest, current_user: CurrentUser):
    supabase = get_supabase_client()
    user_id = current_user["id"]

    def update_order(category_id: UUID, order: int):
        (
            supabase.table("todo_lists")
            .update({"order": order})
            .eq("id", str(category_id))
            .eq("user_id", user_id)
            .execute()
        )

    await asyncio.gather(*[
        asyncio.to_thread(update_order, category_id, index)
        for index, category_id in enumerate(reorder_request.categoryIds)
    ])

    return {"message": "Reordered"}


@router.post("/reorder")
@limiter.limit(settings.RATE_LIMIT_API)
async def reorder_todos(request: Request, reorder_request: ReorderRequest, current_user: CurrentUser):
    supabase = get_supabase_client()
    user_id = current_user["id"]

    def update_order(todo_id: UUID, order: int):
        (
            supabase.table("todos")
            .update({"order": order})
            .eq("id", str(todo_id))
            .eq("user_id", user_id)
            .execute()
        )

    await asyncio.gather(*[
        asyncio.to_thread(update_order, todo_id, index)
        for index, todo_id in enumerate(reorder_request.todoIds)
    ])

    return {"message": "Reordered"}
