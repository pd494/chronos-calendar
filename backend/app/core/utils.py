from typing import Any

Row = dict[str, Any]


def first_row(data: Any) -> Row | None:
    if isinstance(data, list) and len(data) > 0:
        return data[0]
    return None
