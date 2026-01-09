from cerebras.cloud.sdk import AsyncCerebras, Cerebras
from app.config import get_settings


def get_cerebras_client() -> Cerebras:
    settings = get_settings()
    return Cerebras(api_key=settings.CEREBRAS_API_KEY)


def get_async_cerebras_client() -> AsyncCerebras:
    settings = get_settings()
    return AsyncCerebras(api_key=settings.CEREBRAS_API_KEY)
