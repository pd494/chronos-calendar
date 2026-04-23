from typing import Annotated, Any, Literal, NotRequired, TypedDict
from pydantic import BaseModel, Field, model_validator


class EventDateTime(BaseModel):
    date: str | None = None
    dateTime: str | None = None
    timeZone: str | None = None

    @model_validator(mode="after")
    def require_date_or_datetime(self):
        if not self.date and not self.dateTime:
            raise ValueError("Either date or dateTime must be provided")
        return self


class Event(BaseModel):
    id: str | None = None
    calendarId: str | None = None
    summary: str
    description: str | None = None
    location: str | None = None
    start: EventDateTime
    end: EventDateTime
    recurrence: list[str] | None = None
    recurringEventId: str | None = None
    originalStartTime: EventDateTime | None = None
    attendees: list[dict] | None = None
    organizer: dict | None = None
    colorId: str | None = None
    color: str | None = None
    status: str | None = None
    completed: bool = False
    visibility: str = "default"
    transparency: str = "opaque"
    reminders: dict | None = None
    conferenceData: dict | None = None
    created: str | None = None
    updated: str | None = None
    htmlLink: str | None = None
    iCalUID: str | None = None


class EventPatch(BaseModel):
    summary: str | None = None
    description: str | None = None
    location: str | None = None
    start: EventDateTime | None = None
    end: EventDateTime | None = None
    recurrence: list[str] | None = None
    attendees: list[dict] | None = None
    colorId: str | None = None
    status: str | None = None
    completed: bool | None = None
    visibility: str | None = None
    transparency: str | None = None
    reminders: dict | None = None
    conferenceData: dict | None = None


class CalendarEventData(TypedDict):
    start: NotRequired[dict[str, Any]]
    end: NotRequired[dict[str, Any]]
    summary: NotRequired[str | None]
    description: NotRequired[str | None]
    location: NotRequired[str | None]
    recurrence: NotRequired[list[str] | None]
    recurringEventId: NotRequired[str | None]
    originalStartTime: NotRequired[dict[str, Any] | None]
    attendees: NotRequired[list[dict] | None]
    colorId: NotRequired[str | None]
    status: NotRequired[str | None]
    visibility: NotRequired[str | None]
    transparency: NotRequired[str | None]
    reminders: NotRequired[dict[str, Any] | None]
    conferenceData: NotRequired[dict[str, Any] | None]
    id: NotRequired[str]
    googleEventId: NotRequired[str]


class ThisEventEditBody(BaseModel):
    instance_start: str
    action: Literal["edit"]
    patch: EventPatch


class ThisEventDeleteBody(BaseModel):
    instance_start: str
    action: Literal["delete"]


ThisEventBody = Annotated[ThisEventEditBody | ThisEventDeleteBody, Field(discriminator="action")]


class FollowingEventEditBody(BaseModel):
    split_point: str
    action: Literal["edit"]
    patch: EventPatch
    downstream_master_ids: list[str] = Field(default_factory=list)


class FollowingEventDeleteBody(BaseModel):
    split_point: str
    action: Literal["delete"]
    downstream_master_ids: list[str] = Field(default_factory=list)


FollowingEventBody = Annotated[
    FollowingEventEditBody | FollowingEventDeleteBody,
    Field(discriminator="action"),
]


class AllEventEditBody(BaseModel):
    action: Literal["edit"]
    patch: EventPatch


class AllEventDeleteBody(BaseModel):
    action: Literal["delete"]


AllEventBody = Annotated[AllEventEditBody | AllEventDeleteBody, Field(discriminator="action")]


class AllResult(BaseModel):
    master: CalendarEventData
    updated_exceptions: list[CalendarEventData] = Field(default_factory=list)
    deleted_exception_ids: list[str] = Field(default_factory=list)


class FollowingResult(BaseModel):
    truncated_master: CalendarEventData
    new_master: CalendarEventData | None = None
    migrated_exceptions: list[CalendarEventData] = Field(default_factory=list)
    deleted_exception_ids: list[str] = Field(default_factory=list)


class EventCompletion(BaseModel):
    google_calendar_id: str
    master_event_id: str
    instance_start: str
    completed: bool
