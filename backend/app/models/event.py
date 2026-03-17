from pydantic import BaseModel, model_validator


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

class EventCompletion(BaseModel):
    google_calendar_id: str
    master_event_id: str
    instance_start: str
    completed: bool
