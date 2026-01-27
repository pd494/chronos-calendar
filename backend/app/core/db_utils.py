from typing import Any

type Row = dict[str, Any]


def first_row(data: list | dict | None) -> Row | None:
    if isinstance(data, list):
        return data[0] if data else None
    return data


def all_rows(data: list | None) -> list[Row]:
    return data or []
