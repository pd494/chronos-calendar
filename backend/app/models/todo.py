from datetime import date
from uuid import UUID

from pydantic import BaseModel, Field


class Todo(BaseModel):
    title: str = Field(..., max_length=500)
    listId: str
    scheduledDate: date | None = None

class TodoPatch(BaseModel):
    title: str | None = Field(default=None, max_length=500)
    completed: bool | None = None
    scheduledDate: date | None = None
    listId: str | None = None
    order: int | None = None

class TodoList(BaseModel):
    name: str = Field(..., max_length=100)
    color: str = Field(..., pattern=r'^#[0-9a-fA-F]{6}$')

class TodoListPatch(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    color: str | None = Field(default=None, pattern=r'^#[0-9a-fA-F]{6}$')
    order: int | None = None

class TodoReorder(BaseModel):
    todoIds: list[UUID]


class TodoListReorder(BaseModel):
    categoryIds: list[UUID]
