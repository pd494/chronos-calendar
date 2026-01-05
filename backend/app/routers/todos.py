from fastapi import APIRouter, HTTPException, Query
from uuid import UUID
from app.core.security import CurrentUser
from app.core.supabase import get_supabase_client
from app.models.todo import TodoCreate, TodoUpdate, ReorderRequest, TodoListCreate, TodoListUpdate, CategoryReorderRequest

router = APIRouter()

def to_snake_case(data: dict) -> dict:
    field_map = {
        "listId": "list_id",
        "scheduledDate": "scheduled_date"
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
    supabase = get_supabase_client()
    query = supabase.table("todos").select("*").eq("user_id", current_user["id"])

    if listId and listId != "all":
        query = query.eq("list_id", listId)

    result = query.order("order").execute()
    return [to_camel_case(todo) for todo in result.data]


@router.post("/")
async def create_todo(todo: TodoCreate, current_user: CurrentUser):
    supabase = get_supabase_client()

    min_order_result = (
        supabase.table("todos")
        .select("order")
        .eq("user_id", current_user["id"])
        .order("order")
        .limit(1)
        .execute()
    )
    min_order = min_order_result.data[0]["order"] if min_order_result.data else 0
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
    return to_camel_case(result.data[0])

@router.put("/{todo_id}")
async def update_todo(todo_id: UUID, todo: TodoUpdate, current_user: CurrentUser):
    supabase = get_supabase_client()
    update_data = to_snake_case(todo.model_dump(exclude_unset=True))

    result = (
        supabase.table("todos")
        .update(update_data)
        .eq("id", str(todo_id))
        .eq("user_id", current_user["id"])
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="Todo not found")

    return to_camel_case(result.data[0])


@router.delete("/{todo_id}")
async def delete_todo(todo_id: UUID, current_user: CurrentUser):
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
async def list_todo_lists(current_user: CurrentUser):
    supabase = get_supabase_client()

    result = (
        supabase.table("todo_lists")
        .select("*")
        .eq("user_id", current_user["id"])
        .order("order")
        .execute()
    )

    return [to_camel_case(list_item) for list_item in result.data]

@router.post("/todo-lists")
async def create_todo_list(todo_list: TodoListCreate, current_user: CurrentUser):
    supabase = get_supabase_client()

    min_order_result = (
        supabase.table("todo_lists")
        .select("order")
        .eq("user_id", current_user["id"])
        .order("order")
        .limit(1)
        .execute()
    )
    min_order = min_order_result.data[0]["order"] if min_order_result.data else 0
    new_order = min_order - 1

    list_data = {
        "user_id": current_user["id"],
        "name": todo_list.name,
        "color": todo_list.color,
        "is_system": False,
        "order": new_order
    }

    result = supabase.table("todo_lists").insert(list_data).execute()
    return to_camel_case(result.data[0])

@router.put("/todo-lists/{list_id}")
async def update_todo_list(list_id: UUID, todo_list: TodoListUpdate, current_user: CurrentUser):
    supabase = get_supabase_client()
    update_data = {k: v for k, v in todo_list.model_dump(exclude_unset=True).items() if v is not None}

    result = (
        supabase.table("todo_lists")
        .update(update_data)
        .eq("id", str(list_id))
        .eq("user_id", current_user["id"])
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="List not found")

    return to_camel_case(result.data[0])

@router.delete("/todo-lists/{list_id}")
async def delete_todo_list(list_id: UUID, current_user: CurrentUser):
    supabase = get_supabase_client()

    existing = (
        supabase.table("todo_lists")
        .select("is_system")
        .eq("id", str(list_id))
        .eq("user_id", current_user["id"])
        .execute()
    )

    if not existing.data:
        raise HTTPException(status_code=404, detail="List not found")

    if existing.data[0]["is_system"]:
        raise HTTPException(status_code=400, detail="Cannot delete system list")

    supabase.table("todo_lists").delete().eq("id", str(list_id)).eq("user_id", current_user["id"]).execute()
    return {"message": "List deleted"}

@router.post("/todo-lists/reorder")
async def reorder_todo_lists(request: CategoryReorderRequest, current_user: CurrentUser):
    supabase = get_supabase_client()

    for index, category_id in enumerate(request.categoryIds):
        supabase.table("todo_lists").update({"order": index}).eq("id", category_id).eq("user_id", current_user["id"]).execute()

    return {"message": "Reordered"}

@router.post("/reorder")
async def reorder_todos(request: ReorderRequest, current_user: CurrentUser):
    supabase = get_supabase_client()

    for index, todo_id in enumerate(request.todoIds):
        supabase.table("todos").update({"order": index}).eq("id", todo_id).eq("user_id", current_user["id"]).execute()

    return {"message": "Reordered"}
