from datetime import datetime, timedelta
import re
from typing import Any
from dateutil.rrule import rrulestr

from app.models.event import Event, EventPatch, FollowingEventBody

_ICAL_DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]


def parse_datetime_value(value: str) -> datetime:
    return datetime.fromisoformat(value)


def get_datetime_value(value: dict | None) -> str:
    if not value:
        return ""
    return value.get("dateTime") or value.get("date") or ""


def shift_datetime_value(value: dict | None, delta: timedelta) -> dict | None:
    if not value:
        return None
    if value.get("dateTime"):
        shifted = datetime.fromisoformat(value["dateTime"]) + delta
        result = {"dateTime": shifted.isoformat()}
        if value.get("timeZone"):
            result["timeZone"] = value["timeZone"]
        return result
    if value.get("date"):
        shifted = datetime.fromisoformat(value["date"]) + delta
        return {"date": shifted.strftime("%Y-%m-%d")}
    return None


def get_weekday_index(value: dict | None) -> int | None:
    if not value:
        return None
    if value.get("dateTime"):
        day = datetime.fromisoformat(value["dateTime"]).weekday()
        return day
    if value.get("date"):
        day = datetime.fromisoformat(value["date"]).weekday()
        return day
    return None


def adjust_recurrence_for_start_change(
    recurrence_rules: list[str] | None,
    previous_start: dict | None,
    next_start: dict | None,
) -> list[str] | None:
    if not recurrence_rules or not next_start:
        return recurrence_rules

    old_day = get_weekday_index(previous_start)
    new_day = get_weekday_index(next_start)
    if old_day is None or new_day is None or old_day == new_day:
        return recurrence_rules

    return [
        _update_byday(rule, old_day, new_day)
        if rule.startswith("RRULE:") and "BYDAY=" in rule
        else rule
        for rule in recurrence_rules
    ]


def build_exception_patch(exception: dict, start: dict | None, end: dict | None) -> EventPatch:
    data = {
        "summary": exception.get("summary"),
        "description": exception.get("description"),
        "location": exception.get("location"),
        "start": start,
        "end": end,
        "attendees": exception.get("attendees"),
        "colorId": exception.get("colorId"),
        "status": exception.get("status"),
        "visibility": exception.get("visibility"),
        "transparency": exception.get("transparency"),
        "reminders": exception.get("reminders"),
        "conferenceData": exception.get("conferenceData"),
    }
    return EventPatch(**{key: value for key, value in data.items() if value is not None})


def find_instance_by_original_start(instances: list[dict], original_start: dict | None) -> dict | None:
    target = get_datetime_value(original_start)
    if not target:
        return None
    target_dt = parse_datetime_value(target)
    for instance in instances:
        candidate_original = get_datetime_value(instance.get("originalStartTime"))
        if candidate_original and parse_datetime_value(candidate_original) == target_dt:
            return instance
        candidate_start = get_datetime_value(instance.get("start"))
        if candidate_start and parse_datetime_value(candidate_start) == target_dt:
            return instance
    return None


def build_cancelled_instance_event(instance: dict, recurring_event_id: str) -> dict:
    return {
        "id": instance["id"],
        "summary": instance.get("summary", ""),
        "start": instance.get("start") or instance.get("originalStartTime") or {},
        "end": instance.get("end") or instance.get("originalStartTime") or {},
        "status": "cancelled",
        "recurringEventId": recurring_event_id,
        "originalStartTime": instance.get("originalStartTime"),
        "visibility": instance.get("visibility", "default"),
        "transparency": instance.get("transparency", "opaque"),
    }


def is_future_exception(exception: dict, split_dt: datetime) -> bool:
    original_start = exception.get("originalStartTime") or {}
    original_start_value = get_datetime_value(original_start)
    if not original_start_value:
        return False
    return parse_datetime_value(original_start_value) >= split_dt


def is_split_point_exception(exception: dict, split_point: str) -> bool:
    original_start = exception.get("originalStartTime") or {}
    return get_datetime_value(original_start) == split_point


def recurrence_removed(patch_data: dict[str, Any]) -> bool:
    return "recurrence" in patch_data and len(patch_data["recurrence"]) == 0


def recurrence_changed(patch_data: dict[str, Any]) -> bool:
    return "recurrence" in patch_data and len(patch_data["recurrence"]) > 0


def resets_exceptions(patch_data: dict[str, Any]) -> bool:
    return recurrence_removed(patch_data) or recurrence_changed(patch_data) or "start" in patch_data or "end" in patch_data


def exception_patch_data(patch_data: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in patch_data.items() if key != "recurrence"}


def truncate_recurrence(recurrence_rules: list[str], split_dt: datetime) -> list[str]:
    rrule_line = next(rule for rule in recurrence_rules if rule.startswith("RRULE:"))
    non_rrule_lines = [rule for rule in recurrence_rules if not rule.startswith("RRULE:")]
    until_str = (split_dt - timedelta(days=1)).strftime("%Y%m%dT235959Z")
    return [_truncate_rrule(rrule_line, until_str)] + _filter_exdates(non_rrule_lines, split_dt, keep_before=True)


def build_following_new_event(event: dict[str, Any], body: FollowingEventBody) -> tuple[Event, timedelta]:
    recurrence_rules = event["recurrence"]
    rrule_line = next(rule for rule in recurrence_rules if rule.startswith("RRULE:"))
    non_rrule_lines = [rule for rule in recurrence_rules if not rule.startswith("RRULE:")]
    split_dt = datetime.fromisoformat(body.split_point)

    start = event["start"]
    end = event["end"]
    if "dateTime" in start:
        duration = datetime.fromisoformat(end["dateTime"]) - datetime.fromisoformat(start["dateTime"])
        new_start = {"dateTime": body.split_point, "timeZone": start.get("timeZone")}
        new_end = {"dateTime": (split_dt + duration).isoformat(), "timeZone": end.get("timeZone")}
    else:
        duration = datetime.fromisoformat(end["date"]) - datetime.fromisoformat(start["date"])
        new_start = {"date": split_dt.strftime("%Y-%m-%d")}
        new_end = {"date": (split_dt + duration).strftime("%Y-%m-%d")}

    tail_non_rrule = _filter_exdates(non_rrule_lines, split_dt, keep_before=False)

    new_event_data = {
        "summary": event.get("summary", ""),
        "description": event.get("description"),
        "location": event.get("location"),
        "start": new_start,
        "end": new_end,
        "attendees": event.get("attendees"),
        "colorId": event.get("colorId"),
        "visibility": event.get("visibility", "default"),
        "transparency": event.get("transparency", "opaque"),
        "reminders": event.get("reminders"),
    }
    recurrence_patch: list[str] | None = None
    if body.patch:
        patch_data = body.patch.model_dump(exclude_none=True)
        recurrence_patch = patch_data.get("recurrence")
        new_event_data.update(patch_data)

    normalized_start, normalized_end = _normalize_event_range(new_event_data["start"], new_event_data["end"], duration)
    new_event_data["start"] = normalized_start
    new_event_data["end"] = normalized_end
    series_delta = parse_datetime_value(get_datetime_value(new_event_data["start"])) - split_dt

    if recurrence_patch is not None:
        new_event_data["recurrence"] = recurrence_patch
    else:
        new_event_data["recurrence"] = [
            _build_following_tail_rrule(
                rrule_line,
                get_datetime_value(start),
                body.split_point,
                get_datetime_value(new_event_data["start"]),
            )
        ] + tail_non_rrule
    return Event(**{key: value for key, value in new_event_data.items() if value is not None}), series_delta


def _parse_exdate(line: str) -> datetime | None:
    colon = line.index(":")
    value = line[colon + 1:].strip()
    return datetime.fromisoformat(value) if "T" in value else datetime.strptime(value, "%Y%m%d")


def _filter_exdates(lines: list[str], split_dt: datetime, keep_before: bool) -> list[str]:
    result = []
    for line in lines:
        if not line.startswith("EXDATE"):
            result.append(line)
            continue
        exdate = _parse_exdate(line)
        if exdate and ((keep_before and exdate < split_dt) or (not keep_before and exdate >= split_dt)):
            result.append(line)
    return result


def _clean_rrule(rrule_line: str) -> str:
    params = rrule_line.removeprefix("RRULE:")
    params = re.sub(r"COUNT=\d+;?", "", params).rstrip(";")
    params = re.sub(r"UNTIL=[^;]+;?", "", params).rstrip(";")
    return f"RRULE:{params}"


def _truncate_rrule(rrule_line: str, until_str: str) -> str:
    return f"{_clean_rrule(rrule_line)};UNTIL={until_str}"


def _update_byday(rrule_line: str, old_day: int, new_day: int) -> str:
    old_byday = _ICAL_DAYS[old_day]
    new_byday = _ICAL_DAYS[new_day]
    byday_match = re.search(r"BYDAY=([^;]+)", rrule_line)
    if not byday_match:
        return rrule_line
    days = byday_match.group(1).split(",")
    if old_byday in days:
        days = [new_byday if day == old_byday else day for day in days]
        return re.sub(r"BYDAY=[^;]+", f"BYDAY={','.join(days)}", rrule_line)
    return rrule_line


def _build_following_tail_rrule(
    rrule_line: str,
    original_start_value: str,
    split_point: str,
    new_start_value: str,
) -> str:
    next_rule = rrule_line
    split_day = datetime.fromisoformat(split_point).weekday()
    new_day = datetime.fromisoformat(new_start_value).weekday()
    if split_day != new_day and "BYDAY=" in next_rule:
        next_rule = _update_byday(next_rule, split_day, new_day)

    count_match = re.search(r"COUNT=(\d+)", next_rule)
    if not count_match:
        return next_rule

    original_rule = rrulestr(
        rrule_line.removeprefix("RRULE:"),
        dtstart=datetime.fromisoformat(original_start_value),
    )
    remaining_count = len([occurrence for occurrence in original_rule if occurrence >= datetime.fromisoformat(split_point)])
    if remaining_count <= 0:
        remaining_count = 1
    return re.sub(r"COUNT=\d+", f"COUNT={remaining_count}", next_rule)


def _normalize_event_range(start: dict, end: dict, duration: timedelta) -> tuple[dict, dict]:
    if "dateTime" in start and "dateTime" in end:
        start_dt = datetime.fromisoformat(start["dateTime"])
        end_dt = datetime.fromisoformat(end["dateTime"])
        if end_dt <= start_dt:
            normalized_end = {"dateTime": (start_dt + duration).isoformat()}
            if end.get("timeZone"):
                normalized_end["timeZone"] = end["timeZone"]
            return start, normalized_end
        return start, end

    if "date" in start and "date" in end:
        start_dt = datetime.fromisoformat(start["date"])
        end_dt = datetime.fromisoformat(end["date"])
        if end_dt <= start_dt:
            return start, {"date": (start_dt + duration).strftime("%Y-%m-%d")}
        return start, end

    return start, end
