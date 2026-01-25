from datetime import datetime

from app.calendar.helpers import decrypt_event


def get_event_start_time(event: dict) -> str | None:
    start_dt = event.get("start_datetime") or {}
    return start_dt.get("dateTime") or start_dt.get("date")


def format_events_for_prompt(events: list, user_id: str) -> str:
    if not events:
        return "No events found."

    lines = []
    for i, event in enumerate(events, 1):
        decrypted = decrypt_event(event, user_id, format="db")
        title = decrypted.get("summary") or "Untitled"
        line = f"{i}. **{title}**"

        start_time = get_event_start_time(event)
        if start_time:
            if event.get("is_all_day"):
                line += f" | {start_time} (All day)"
            else:
                line += f" | {start_time}"

        if decrypted.get("location"):
            line += f" | Location: {decrypted['location']}"

        if event.get("similarity") and event["similarity"] < 1.0:
            line += f" (relevance: {event['similarity']:.0%})"

        lines.append(line)

    return "\n".join(lines)


def parse_temporal_context(temporal_context: dict | None) -> tuple[datetime | None, datetime | None]:
    if not temporal_context:
        return None, None

    start_str = temporal_context.get("start")
    end_str = temporal_context.get("end")

    start_ts = datetime.fromisoformat(start_str.replace("Z", "+00:00")) if start_str else None
    end_ts = datetime.fromisoformat(end_str.replace("Z", "+00:00")) if end_str else None

    return start_ts, end_ts
