import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any


class StructuredJsonFormatter(logging.Formatter):
    SENSITIVE_FIELDS = {
        "password", "token", "access_token", "refresh_token", "secret",
        "api_key", "authorization", "cookie", "session", "credentials"
    }

    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)

        request_id = getattr(record, "request_id", None)
        if request_id is not None:
            log_data["request_id"] = request_id
        user_id = getattr(record, "user_id", None)
        if user_id is not None:
            log_data["user_id"] = user_id

        extra_fields = {
            k: v for k, v in record.__dict__.items()
            if k not in {
                "name", "msg", "args", "created", "filename", "funcName",
                "levelname", "levelno", "lineno", "module", "msecs",
                "pathname", "process", "processName", "relativeCreated",
                "stack_info", "exc_info", "exc_text", "thread", "threadName",
                "taskName", "request_id", "user_id", "message"
            }
        }
        if extra_fields:
            log_data["extra"] = self._redact_sensitive(extra_fields)

        return json.dumps(log_data, default=str)

    def _redact_sensitive(self, data: Any) -> Any:
        if isinstance(data, dict):
            return {
                k: "[REDACTED]" if k.lower() in self.SENSITIVE_FIELDS else self._redact_sensitive(v)
                for k, v in data.items()
            }
        if isinstance(data, list):
            return [self._redact_sensitive(item) for item in data]
        return data


def setup_logging(is_production: bool = False):
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.DEBUG if not is_production else logging.INFO)

    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    handler = logging.StreamHandler(sys.stdout)

    if is_production:
        handler.setFormatter(StructuredJsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
        )

    root_logger.addHandler(handler)

    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("hpack").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.INFO)


class RequestContextLogger:
    def __init__(self, logger: logging.Logger, request_id: str | None = None, user_id: str | None = None):
        self._logger = logger
        self._request_id = request_id
        self._user_id = user_id

    def _log(self, level: int, msg: str, *args, **kwargs):
        extra = kwargs.pop("extra", {})
        if self._request_id:
            extra["request_id"] = self._request_id
        if self._user_id:
            extra["user_id"] = self._user_id
        kwargs["extra"] = extra
        self._logger.log(level, msg, *args, **kwargs)

    def debug(self, msg: str, *args, **kwargs):
        self._log(logging.DEBUG, msg, *args, **kwargs)

    def info(self, msg: str, *args, **kwargs):
        self._log(logging.INFO, msg, *args, **kwargs)

    def warning(self, msg: str, *args, **kwargs):
        self._log(logging.WARNING, msg, *args, **kwargs)

    def error(self, msg: str, *args, **kwargs):
        self._log(logging.ERROR, msg, *args, **kwargs)

    def exception(self, msg: str, *args, **kwargs):
        kwargs["exc_info"] = True
        self._log(logging.ERROR, msg, *args, **kwargs)
