from pydantic import BaseModel
from app.models.user import User

class AuthSession(BaseModel):
    user: User
    expires_at: int

class GoogleLoginResponse(BaseModel):
    redirectUrl: str

class CallbackResponse(BaseModel):
    user: dict
    expires_at: int
