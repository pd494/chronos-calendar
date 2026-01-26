from fastapi import APIRouter, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import get_settings
from app.core.dependencies import CurrentUser

limiter = Limiter(key_func=get_remote_address)
settings = get_settings()
router = APIRouter()


@router.get("/")
@limiter.limit(settings.RATE_LIMIT_API)
async def list_events(request: Request, current_user: CurrentUser):
    return []
