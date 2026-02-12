from datetime import date
from uuid import UUID

from pydantic import BaseModel, Field


class TodoBase(BaseModel):
    title: str = Field(..., max_length=500)
    listId: str
    scheduledDate: date | None = None

class TodoCreate(TodoBase):
    pass

class TodoUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=500)
    completed: bool | None = None
    scheduledDate: date | None = None
    listId: str | None = None
    order: int | None = None

class TodoListBase(BaseModel):
    name: str = Field(..., max_length=100)
    color: str = Field(..., pattern=r'^#[0-9a-fA-F]{6}$')

class TodoListCreate(TodoListBase):
    pass

class TodoListUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    color: str | None = Field(default=None, pattern=r'^#[0-9a-fA-F]{6}$')
    order: int | None = None

class ReorderRequest(BaseModel):
    todoIds: list[UUID]


class CategoryReorderRequest(BaseModel):
    categoryIds: list[UUID]
