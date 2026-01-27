from typing import Any

Row = dict[str, Any]


def first_row(data: Any) -> Row | None:
    if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
        return data[0]
    if isinstance(data, dict):
        return data
    return None


def all_rows(data: Any) -> list[Row]:
    if isinstance(data, list):
        return [r for r in data if isinstance(r, dict)]
    return []
