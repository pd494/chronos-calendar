from datetime import datetime, timedelta, timezone
import re
from typing import Any
from dateutil.rrule import rrulestr
from fastapi import HTTPException
from supabase import Client
from zoneinfo import ZoneInfo

from app.calendar.google_client import GoogleAPIClient
from app.calendar.helpers import GoogleAPIError, transform_events
from app.models.event import (
    AllEventBody,
    AllResult,
    CalendarEventData,
    Event,
    EventPatch,
    FollowingEventBody,
    FollowingEventEditBody,
    FollowingResult,
    ThisEventBody,
)

_ICAL_DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]


def get_datetime_value(value: dict[str, Any]) -> str:
    if "dateTime" in value:
        return value["dateTime"]
    return value["date"]


def shift_datetime_value(value: dict[str, Any], delta: timedelta) -> dict[str, str]:
    if "dateTime" in value:
        shifted = datetime.fromisoformat(value["dateTime"]) + delta
        result = {"dateTime": shifted.isoformat()}
        if value.get("timeZone"):
            result["timeZone"] = value["timeZone"]
        return result
    shifted = datetime.fromisoformat(value["date"]) + delta
    return {"date": shifted.strftime("%Y-%m-%d")}


def get_weekday_index(value: dict[str, Any]) -> int:
    return datetime.fromisoformat(get_datetime_value(value)).weekday()


def adjust_recurrence_for_start_change(
    recurrence_rules: list[str] | None,
    previous_start: dict[str, Any] | None,
    next_start: dict[str, Any] | None,
) -> list[str] | None:
    if not recurrence_rules or previous_start is None or next_start is None:
        return recurrence_rules

    old_day = get_weekday_index(previous_start)
    new_day = get_weekday_index(next_start)
    if old_day == new_day:
        return recurrence_rules

    return [
        _update_byday(rule, old_day, new_day)
        if rule.startswith("RRULE:") and "BYDAY=" in rule
        else rule
        for rule in recurrence_rules
    ]


def build_exception_patch(exception: CalendarEventData, start: dict[str, Any], end: dict[str, Any]) -> EventPatch:
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


def find_instance_by_original_start(
    instances: list[CalendarEventData],
    original_start: dict[str, Any],
) -> CalendarEventData | None:
    target_dt = datetime.fromisoformat(get_datetime_value(original_start))
    for instance in instances:
        candidate_original = instance.get("originalStartTime")
        if candidate_original is not None and datetime.fromisoformat(get_datetime_value(candidate_original)) == target_dt:
            return instance
        candidate_start = instance.get("start")
        if candidate_start is not None and datetime.fromisoformat(get_datetime_value(candidate_start)) == target_dt:
            return instance
    return None


def build_cancelled_instance_event(instance: CalendarEventData, recurring_event_id: str) -> CalendarEventData:
    return {
        "id": instance["id"],
        "summary": instance.get("summary"),
        "start": instance["start"],
        "end": instance["end"],
        "status": "cancelled",
        "recurringEventId": recurring_event_id,
        "originalStartTime": instance["originalStartTime"],
    }


def is_future_exception(exception: CalendarEventData, split_dt: datetime) -> bool:
    return datetime.fromisoformat(get_datetime_value(exception["originalStartTime"])) >= split_dt


def is_split_point_exception(exception: CalendarEventData, split_point: str) -> bool:
    return get_datetime_value(exception["originalStartTime"]) == split_point


def resets_exceptions(patch_data: dict[str, Any]) -> bool:
    return "recurrence" in patch_data or "start" in patch_data or "end" in patch_data


def truncate_recurrence(recurrence_rules: list[str], split_dt: datetime) -> list[str]:
    rrule_line = next(rule for rule in recurrence_rules if rule.startswith("RRULE:"))
    non_rrule_lines = [rule for rule in recurrence_rules if not rule.startswith("RRULE:")]
    until_dt = split_dt - timedelta(seconds=1)
    if until_dt.tzinfo is not None:
        until_dt = until_dt.astimezone(timezone.utc)
    until_str = until_dt.strftime("%Y%m%dT%H%M%SZ")
    return [_truncate_rrule(rrule_line, until_str)] + _filter_exdates(non_rrule_lines, split_dt, keep_before=True)


def build_following_new_event(event: CalendarEventData, body: FollowingEventEditBody) -> tuple[Event, timedelta]:
    recurrence_rules = event["recurrence"]
    rrule_line = next(rule for rule in recurrence_rules if rule.startswith("RRULE:"))
    non_rrule_lines = [rule for rule in recurrence_rules if not rule.startswith("RRULE:")]
    split_dt = datetime.fromisoformat(body.split_point)

    original_start = event["start"]
    original_end = event["end"]
    if "dateTime" in original_start:
        duration = datetime.fromisoformat(original_end["dateTime"]) - datetime.fromisoformat(original_start["dateTime"])
        event_data = {
            "start": {"dateTime": body.split_point, "timeZone": original_start.get("timeZone")},
            "end": {"dateTime": (split_dt + duration).isoformat(), "timeZone": original_end.get("timeZone")},
        }
    else:
        duration = datetime.fromisoformat(original_end["date"]) - datetime.fromisoformat(original_start["date"])
        event_data = {
            "start": {"date": split_dt.strftime("%Y-%m-%d")},
            "end": {"date": (split_dt + duration).strftime("%Y-%m-%d")},
        }

    tail_non_rrule = _filter_exdates(non_rrule_lines, split_dt, keep_before=False)
    event_data.update({
        "summary": event.get("summary", ""),
        "description": event.get("description"),
        "location": event.get("location"),
        "attendees": event.get("attendees"),
        "colorId": event.get("colorId"),
        "visibility": event.get("visibility", "default"),
        "transparency": event.get("transparency", "opaque"),
        "reminders": event.get("reminders"),
    })
    patch_data = body.patch.model_dump(exclude_none=True)
    recurrence_patch = patch_data.get("recurrence")
    event_data.update(patch_data)

    start, end = _normalize_event_range(event_data["start"], event_data["end"], duration)
    event_data["start"] = start
    event_data["end"] = end
    series_delta = datetime.fromisoformat(get_datetime_value(event_data["start"])) - split_dt

    if recurrence_patch is not None:
        event_data["recurrence"] = recurrence_patch
    else:
        event_data["recurrence"] = [
            _build_following_tail_rrule(
                rrule_line,
                get_datetime_value(original_start),
                body.split_point,
                get_datetime_value(event_data["start"]),
            )
        ] + tail_non_rrule
    return Event(**{key: value for key, value in event_data.items() if value is not None}), series_delta


async def apply_this_event_update(
    client: GoogleAPIClient,
    supabase: Client,
    verified_calendar: dict[str, Any],
    master_id: str,
    body: ThisEventBody,
) -> CalendarEventData:
    calendar_external_id = verified_calendar["google_calendar_id"]
    instances: list[CalendarEventData] = await client.get_recurring_instances(calendar_external_id, master_id)
    target = datetime.fromisoformat(body.instance_start)
    match = next(
        (
            instance
            for instance in instances
            if datetime.fromisoformat(
                instance["originalStartTime"].get("dateTime") or instance["originalStartTime"]["date"]
            ) == target
        ),
        None,
    )
    if match is None:
        raise HTTPException(status_code=404, detail="Instance not found")

    if body.action == "delete":
        await client.delete_event(calendar_external_id, match["id"])
        cancelled_event = build_cancelled_instance_event(match, master_id)
        return _store_google_events(supabase, verified_calendar, [cancelled_event])[0]

    assert body.action == "edit"
    response = await client.edit_event(calendar_external_id, match["id"], body.patch)
    return _store_google_events(supabase, verified_calendar, [response])[0]


async def apply_all_event_update(
    client: GoogleAPIClient,
    supabase: Client,
    verified_calendar: dict[str, Any],
    master_id: str,
    body: AllEventBody,
) -> AllResult:
    calendar_id = verified_calendar["id"]
    calendar_external_id = verified_calendar["google_calendar_id"]
    updated_exceptions: list[CalendarEventData] = []
    deleted_exception_ids: list[str] = []

    if body.action == "delete":
        deleted_exception_ids.extend(
            await _delete_exceptions_for_master(client, supabase, calendar_id, calendar_external_id, master_id)
        )
        await _delete_event_and_row(client, supabase, calendar_id, calendar_external_id, master_id)
        return AllResult(master={}, deleted_exception_ids=deleted_exception_ids)

    assert body.action == "edit"
    patch_data = body.patch.model_dump(exclude_none=True)
    master_event: CalendarEventData = await client.get_event(calendar_external_id, master_id)
    if "start" in patch_data and "recurrence" not in patch_data:
        adjusted_recurrence = adjust_recurrence_for_start_change(
            master_event.get("recurrence"),
            master_event.get("start"),
            patch_data["start"],
        )
        if adjusted_recurrence is not None:
            patch_data["recurrence"] = adjusted_recurrence

    master_response = await client.edit_event(calendar_external_id, master_id, EventPatch(**patch_data))
    master_transformed = _store_google_events(supabase, verified_calendar, [master_response])[0]

    if resets_exceptions(patch_data):
        deleted_exception_ids.extend(
            await _delete_exceptions_for_master(client, supabase, calendar_id, calendar_external_id, master_id)
        )
        return AllResult(master=master_transformed, deleted_exception_ids=deleted_exception_ids)

    propagated_patch_data = {
        key: value
        for key, value in patch_data.items()
        if key != "recurrence"
    }
    if propagated_patch_data:
        exceptions = (
            supabase.table("events")
            .select("*")
            .eq("googleCalendarId", calendar_id)
            .eq("recurringEventId", master_id)
            .execute()
        )
        exception_patch = EventPatch(**propagated_patch_data)
        for exception in exceptions.data or []:
            exception_id = exception.get("googleEventId")
            if not exception_id or exception.get("status") == "cancelled":
                continue
            exception_response = await client.edit_event(calendar_external_id, exception_id, exception_patch)
            updated_exceptions.append(_store_google_events(supabase, verified_calendar, [exception_response])[0])

    return AllResult(
        master=master_transformed,
        updated_exceptions=updated_exceptions,
        deleted_exception_ids=deleted_exception_ids,
    )


async def apply_following_event_update(
    client: GoogleAPIClient,
    supabase: Client,
    verified_calendar: dict[str, Any],
    master_id: str,
    body: FollowingEventBody,
) -> FollowingResult:
    calendar_id = verified_calendar["id"]
    calendar_external_id = verified_calendar["google_calendar_id"]
    event: CalendarEventData = await client.get_event(calendar_external_id, master_id)

    split_dt = datetime.fromisoformat(body.split_point)
    truncated_response = await client.edit_event(
        calendar_external_id,
        master_id,
        EventPatch(recurrence=truncate_recurrence(event["recurrence"], split_dt)),
    )
    truncated_master = _store_google_events(supabase, verified_calendar, [truncated_response])[0]
    new_master = None
    migrated_exceptions: list[CalendarEventData] = []
    deleted_exception_ids: list[str] = []
    recurrence_was_changed = False
    downstream_master_ids = list(dict.fromkeys(
        downstream_master_id
        for downstream_master_id in body.downstream_master_ids
        if downstream_master_id and downstream_master_id != master_id
    ))

    new_instances: list[CalendarEventData] = []
    series_delta = timedelta(0)
    if body.action == "edit":
        recurrence_was_changed = body.patch.recurrence is not None
        new_event, series_delta = build_following_new_event(event, body)
        new_response = await client.create_event(calendar_external_id, new_event)
        if not new_response.get("recurrence"):
            new_response["recurrence"] = new_event.recurrence
        new_master = _store_google_events(supabase, verified_calendar, [new_response])[0]
        new_instances = await client.get_recurring_instances(calendar_external_id, new_response["id"])

    old_exceptions = (
        supabase.table("events")
        .select("*")
        .eq("googleCalendarId", calendar_id)
        .eq("recurringEventId", master_id)
        .execute()
    )
    for exception in old_exceptions.data or []:
        exception_id = exception.get("googleEventId")
        if not exception_id or not is_future_exception(exception, split_dt):
            continue

        should_delete_exception = (
            body.action == "delete"
            or is_split_point_exception(exception, body.split_point)
            or recurrence_was_changed
        )

        if new_master is not None and not should_delete_exception:
            mapped_original_start = shift_datetime_value(exception["originalStartTime"], series_delta)
            match = find_instance_by_original_start(new_instances, mapped_original_start)
            if match:
                if exception.get("status") == "cancelled":
                    await client.delete_event(calendar_external_id, match["id"])
                    cancelled_event = build_cancelled_instance_event(match, new_master["googleEventId"])
                    migrated_exceptions.append(_store_google_events(supabase, verified_calendar, [cancelled_event])[0])
                else:
                    migrated_patch = build_exception_patch(exception, match["start"], match["end"])
                    migrated_response = await client.edit_event(calendar_external_id, match["id"], migrated_patch)
                    migrated_exceptions.append(_store_google_events(supabase, verified_calendar, [migrated_response])[0])
                should_delete_exception = True

        if not should_delete_exception:
            continue

        await _delete_event_and_row(client, supabase, calendar_id, calendar_external_id, exception_id)
        deleted_exception_ids.append(exception_id)

    for downstream_master_id in downstream_master_ids:
        deleted_exception_ids.extend(
            await _delete_exceptions_for_master(client, supabase, calendar_id, calendar_external_id, downstream_master_id)
        )
        await _delete_event_and_row(client, supabase, calendar_id, calendar_external_id, downstream_master_id)
        supabase.table("completed_events").delete().eq("google_calendar_id", calendar_id).eq("master_event_id", downstream_master_id).execute()

    return FollowingResult(
        truncated_master=truncated_master,
        new_master=new_master,
        migrated_exceptions=migrated_exceptions,
        deleted_exception_ids=deleted_exception_ids,
    )


def _parse_exdate(value: str, tzid: str | None) -> datetime:
    if value.endswith("Z"):
        return datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
    if "T" not in value:
        return datetime.strptime(value, "%Y%m%d")
    dt = datetime.strptime(value, "%Y%m%dT%H%M%S")
    if tzid is None:
        return dt
    return dt.replace(tzinfo=ZoneInfo(tzid))


def _filter_exdates(lines: list[str], split_dt: datetime, keep_before: bool) -> list[str]:
    result = []
    for line in lines:
        if not line.startswith("EXDATE"):
            result.append(line)
            continue
        prefix, values = line.split(":", 1)
        tzid_match = re.search(r"TZID=([^;:]+)", prefix)
        tzid = tzid_match.group(1) if tzid_match else None
        kept_values = []
        for value in values.split(","):
            stripped = value.strip()
            exdate = _parse_exdate(stripped, tzid)
            keep = exdate < split_dt if keep_before else exdate >= split_dt
            if keep:
                kept_values.append(stripped)
        if kept_values:
            result.append(f"{prefix}:{','.join(kept_values)}")
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

    raise AssertionError("Event range must use matching start and end types")


def _store_google_events(
    supabase: Client,
    verified_calendar: dict[str, Any],
    events: list[CalendarEventData],
) -> list[CalendarEventData]:
    transformed = transform_events(
        events,
        verified_calendar["id"],
        verified_calendar["google_account_id"],
        verified_calendar.get("color"),
    )
    supabase.table("events").upsert(transformed, on_conflict="googleCalendarId,googleEventId,source").execute()
    return transformed


async def _delete_event_and_row(
    client: GoogleAPIClient,
    supabase: Client,
    calendar_id: str,
    calendar_external_id: str,
    event_id: str,
) -> None:
    await client.delete_event(calendar_external_id, event_id)
    supabase.table("events").delete().eq("googleCalendarId", calendar_id).eq("googleEventId", event_id).execute()


async def _delete_exceptions_for_master(
    client: GoogleAPIClient,
    supabase: Client,
    calendar_id: str,
    calendar_external_id: str,
    master_id: str,
) -> list[str]:
    exceptions = (
        supabase.table("events")
        .select("googleEventId")
        .eq("googleCalendarId", calendar_id)
        .eq("recurringEventId", master_id)
        .execute()
    )
    deleted_ids: list[str] = []
    for exception in exceptions.data or []:
        exception_id = exception.get("googleEventId")
        if not exception_id:
            continue
        await _delete_event_and_row(client, supabase, calendar_id, calendar_external_id, exception_id)
        deleted_ids.append(exception_id)
    return deleted_ids
