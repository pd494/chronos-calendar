from pydantic import BaseModel

class EventDateTime(BaseModel):
    dateTime: str | None = None
    date: str | None = None
    timeZone: str | None = None

class EventBase(BaseModel):
    summary: str
    description: str | None = None
    location: str | None = None
    start: EventDateTime
    end: EventDateTime

class EventCreate(EventBase):
    status: str | None = None
    visibility: str | None = None
    transparency: str | None = None

class EventUpdate(BaseModel):
    summary: str | None = None
    description: str | None = None
    location: str | None = None
    start: EventDateTime | None = None
    end: EventDateTime | None = None
    status: str | None = None
    visibility: str | None = None
    transparency: str | None = None

class CalendarEvent(BaseModel):
    id: str
    calendarId: str
    summary: str
    description: str | None = None
    location: str | None = None
    start_datetime: dict
    end_datetime: dict
    status: str
    visibility: str
    transparency: str
    created_at: str
    updated_at: str
