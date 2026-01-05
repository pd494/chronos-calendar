from pydantic import BaseModel

class TodoBase(BaseModel):
    title: str
    listId: str
    scheduledDate: str | None = None

class TodoCreate(TodoBase):
    pass

class TodoUpdate(BaseModel):
    title: str | None = None
    completed: bool | None = None
    scheduledDate: str | None = None
    listId: str | None = None
    order: int | None = None

class Todo(BaseModel):
    id: str
    userId: str
    title: str
    completed: bool
    scheduledDate: str | None = None
    listId: str
    order: int
    createdAt: str
    updatedAt: str

class TodoListBase(BaseModel):
    name: str
    color: str

class TodoListCreate(TodoListBase):
    pass

class TodoListUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    order: int | None = None

class ReorderRequest(BaseModel):
    todoIds: list[str]

class CategoryReorderRequest(BaseModel):
    categoryIds: list[str]

class TodoList(BaseModel):
    id: str
    userId: str
    name: str
    color: str
    isSystem: bool
    order: int
