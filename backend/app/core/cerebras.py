from cerebras.cloud.sdk import AsyncCerebras, Cerebras

from app.config import get_settings

_sync_client: Cerebras | None = None
_async_client: AsyncCerebras | None = None


class CerebrasClient:
    @staticmethod
    def get_sync_client() -> Cerebras:
        global _sync_client
        if _sync_client is None:
            settings = get_settings()
            _sync_client = Cerebras(api_key=settings.CEREBRAS_API_KEY)
        return _sync_client

    @staticmethod
    def get_async_client() -> AsyncCerebras:
        global _async_client
        if _async_client is None:
            settings = get_settings()
            _async_client = AsyncCerebras(api_key=settings.CEREBRAS_API_KEY)
        return _async_client
