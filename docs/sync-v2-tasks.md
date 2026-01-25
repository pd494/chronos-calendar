# Sync V2 Tasks

See `docs/sync-v2.md` for full context.

---

## Phase 1: Backend SSE Endpoint ✅

- [x] use fastapi StreamingResponse with async generator
- [x] `gcal.py`: Merged `get_page` into `get_events()` as async generator
- [x] `gcal.py`: Add `proximity_sort_events()` helper
- [x] `routers/calendar.py`: Add `GET /calendar/sync` SSE endpoint with parallel fetching via asyncio.Queue

## Phase 2: Frontend SSE Consumer ✅

- [x] `hooks/useCalendarSync.ts`: Rewrite with EventSource SSE logic
- [x] `contexts/EventsContext.tsx`: Remove phased sync state (syncedRange, viewportLoaded, isBackgroundSyncing)
- [x] `components/calendar/WeekRow.tsx`: Remove syncedRange usage
- N/A: Sync token helpers in lib/db.ts not needed (backend handles sync tokens in calendar_sync_state table)

## Phase 3: Frontend Cleanup ✅

- [x] `api/google.ts`: Old sync functions already removed
- [x] Delete `hooks/useGoogleEvents.ts` (already deleted)
- [x] Delete `hooks/useSync.ts` (already deleted)
- [x] Delete `hooks/useCombinedEvents.ts` (already deleted)

## Phase 4: Backend Cleanup ✅

- [x] `routers/calendar.py`: Old endpoints already removed (only /events, /accounts, /calendars, /sync-status, /refresh-calendars, /process-embeddings, /sync remain)
- [x] `gcal.py`: Old functions already removed (only get_http_client, handle_google_response, get_valid_access_token, refresh_access_token, list_calendars, get_events remain)
- [x] `helpers.py`: Webhook helpers already removed (only transform_events, proximity_sort_events, decrypt_event, format_sse, with_retry, etc. remain)
- [x] `constants.py`: PhasedSyncConfig already removed (only GoogleCalendarConfig remains)
