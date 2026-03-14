from pydantic import BaseModel


class EventCompletion(BaseModel):
    google_calendar_id: str
    master_event_id: str
    instance_start: str
    completed: bool
