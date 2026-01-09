from pydantic import BaseModel, Field, model_validator
from typing import Optional, List
from enum import Enum


class Intent(str, Enum):
    SUMMARIZE = "summarize"
    FIND_EVENT = "find_event"
    CREATE_EVENT = "create_event"
    UPDATE_EVENT = "update_event"
    DELETE_EVENT = "delete_event"
    GENERAL_CHAT = "general_chat"


class SortOrder(str, Enum):
    RECENCY = "recency"
    RELEVANCE = "relevance"


class RecurringEditScope(str, Enum):
    THIS = "this"
    FUTURE = "future"
    ALL = "all"


class TemporalContext(BaseModel):
    start: Optional[str] = Field(None, description="ISO 8601 start time (UTC)")
    end: Optional[str] = Field(None, description="ISO 8601 end time (UTC)")
    is_relative: bool = Field(False)
    original_string: Optional[str] = Field(None)

    @model_validator(mode="after")
    def check_timestamps(self):
        if bool(self.start) != bool(self.end):
            raise ValueError("Start and end must both be provided or both missing")
        if self.start and self.end and self.start > self.end:
            raise ValueError("Start must be before end")
        return self


class QueryContext(BaseModel):
    intent: Intent
    confidence: float = Field(0.0)
    temporal_context: Optional[TemporalContext] = None
    search_keywords: List[str] = Field(default_factory=list)
    range_query: bool = Field(False)
    sort_order: SortOrder = Field(SortOrder.RELEVANCE)

    event_title: Optional[str] = None
    event_location: Optional[str] = None
    event_description: Optional[str] = None
    event_is_all_day: Optional[bool] = None
    event_recurrence: Optional[str] = None
    event_duration_minutes: Optional[int] = None
    find_first_free_slot: Optional[bool] = None

    event_attendees_to_add: Optional[List[str]] = None
    event_attendees_to_remove: Optional[List[str]] = None
    event_new_description: Optional[str] = None
    event_new_duration_minutes: Optional[int] = None
    event_time_offset_minutes: Optional[int] = None
    event_make_all_day: Optional[bool] = None
    event_new_visibility: Optional[str] = None
    event_new_title: Optional[str] = None

    recurring_edit_scope: Optional[RecurringEditScope] = None
    target_instance_date: Optional[str] = None

    @model_validator(mode="after")
    def check_range_query(self):
        if self.intent == Intent.SUMMARIZE:
            self.range_query = True
        return self
