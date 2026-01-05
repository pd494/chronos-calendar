from pydantic import BaseModel

class User(BaseModel):
    id: str
    email: str
    name: str | None = None
    avatar_url: str | None = None
    created_at: str

class UserCreate(BaseModel):
    id: str
    email: str
    name: str | None = None
    avatar_url: str | None = None
