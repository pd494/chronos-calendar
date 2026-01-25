# Event Sync v2: SSE-Based Streaming Architecture

## Implementation Guide

This document is a comprehensive guide for implementing the new SSE-based event sync system. It explains the current architecture, the problems we're solving, and provides step-by-step guidance for each change.

---

## Part 1: Understanding the Current System

### 1.1 How Authentication Works

Before touching sync, understand how users authenticate:

1. **User clicks "Sign in with Google"** → Frontend calls `supabase.auth.signInWithOAuth()` with PKCE flow
2. **Google OAuth consent** → User grants calendar access (`calendar.events` scope) with `access_type: 'offline'` for refresh tokens
3. **Callback to backend** → `/auth/callback` exchanges code for session, extracts Google OAuth tokens
4. **Token storage** → Google `access_token` and `refresh_token` encrypted with AES-256-GCM using `user_id` as salt, stored in `google_account_tokens` table
5. **Session cookie** → HTTP-only secure cookie set for subsequent requests
6. **Encryption key** → Frontend fetches derived encryption key from `/auth/encryption-key` for client-side operations

**Why this matters for sync**: Every Google Calendar API call needs a valid `access_token`. The backend handles token refresh transparently (15-minute buffer before expiry). If refresh fails (revoked access), the account is marked `needs_reauth`.

### 1.2 How Data Flows Through the System

```
Google Calendar API
       ↓
   Backend (FastAPI)
   - Fetches events via pagination
   - Transforms to internal format
   - Encrypts sensitive fields (summary, description, location)
   - Stores in Supabase `events` table
   - Returns decrypted events to frontend
       ↓
   Frontend
   - Receives events from API response
   - Stores in Dexie (IndexedDB) for offline access
   - LiveQuery subscribes to Dexie changes
   - React components re-render
       ↓
   Background Queue
   - Events marked `pendingSupabaseSync: true`
   - Batched and sent to Supabase
   - Marks as synced or failed
```

**Current problem**: This flow happens via multiple discrete HTTP requests. The UI waits for the entire response before showing anything.

### 1.3 The Current Sync Endpoints (What We're Replacing)

| Endpoint | Purpose | Problem |
|----------|---------|---------|
| `POST /sync` | Full sync for calendars | Blocks until all events fetched |
| `POST /initial-sync` | First-time sync with background full sync | Two-phase but still HTTP request/response |
| `POST /phased-sync` | Viewport-first with background phases | Better UX but complex orchestration |

**Phased sync flow**:
1. Frontend calls `/phased-sync`
2. Backend fetches "viewport" events (±60 days from today)
3. Returns viewport immediately
4. Spawns background tasks for historical + future events
5. Background tasks upsert directly to Supabase
6. Frontend has no visibility into background progress
7. Frontend polls or waits for "background syncing" indicator to disappear

**Problems**:
- User sees events "pop in" unpredictably as background completes
- No streaming feedback during initial sync
- Complex state management (`viewportLoaded`, `isBackgroundSyncing`, `syncedRange`)
- Multiple code paths for different sync scenarios

### 1.4 The Webhook System (What We're Removing)

Google Calendar supports "push notifications" via webhooks:

1. **Watch setup**: Call Google's `/events/watch` endpoint with our webhook URL
2. **Channel creation**: Google returns `channel_id`, `resource_id`, expiration (~7 days)
3. **Store state**: Save channel info in `calendar_sync_state` table
4. **Receive notifications**: Google POSTs to `/calendar/google/webhook` when events change
5. **Trigger sync**: Backend validates webhook token, runs incremental sync
6. **Channel renewal**: Cron job renews expiring channels every 2 days

**Why we're removing it**:
- **Complexity**: Webhook token management, channel renewal cron, verification logic
- **Unreliability**: Webhooks can be delayed, missed, or duplicated
- **Not needed**: With efficient delta sync via `syncToken`, polling every 5 minutes is sufficient
- **Simplification**: SSE + polling achieves same UX with less infrastructure

### 1.5 The Dexie + LiveQuery Pattern

Dexie is IndexedDB wrapper. LiveQuery is reactive subscription to Dexie queries.

**Current flow**:
1. `useEventsLive()` hook subscribes to Dexie `events` table
2. Any `upsertEvents()` call triggers re-render
3. Events appear in UI immediately when inserted into Dexie

**This is the key insight**: We don't need to wait for a full HTTP response. If we insert events into Dexie as they arrive, the UI updates automatically.

### 1.6 The Supabase Background Queue

Located in `lib/supabaseQueue.ts`:

1. Events inserted into Dexie with `pendingSupabaseSync: true`
2. Queue batches up to 50 events
3. Flushes after 2 seconds of idle or when batch is full
4. Maps `google_calendar_id` → Supabase UUID using stored mappings
5. Calls Supabase upsert with retry logic
6. Marks events as synced or failed

**We keep this**: It decouples UI responsiveness from Supabase persistence.

### 1.7 Sync Tokens Explained

Google Calendar API supports incremental sync:

1. **First sync**: Fetch all events, receive `nextSyncToken` at end
2. **Store token**: Save in `calendar_sync_state.sync_token`
3. **Next sync**: Pass `syncToken` param, only changed events returned
4. **Token expiration**: If 410 response, token expired, must full sync
5. **New token**: Each sync returns new `nextSyncToken`

**Critical**: We MUST store the sync token at the end of a complete sync. If we store it mid-pagination, we lose events.

---

## Part 2: The New Architecture

### 2.1 Core Concept: Server-Sent Events (SSE)

SSE is HTTP streaming where server pushes events to client over a single connection:

```
Client opens connection → GET /calendar/sync
Server sends: event: events\ndata: {...}\n\n
Server sends: event: events\ndata: {...}\n\n
...
Server sends: event: complete\ndata: {...}\n\n
Connection closes
```

**Why SSE over WebSockets**:
- Simpler (HTTP, not separate protocol)
- Works through proxies/load balancers
- Built-in reconnection
- One-directional (server → client) which is all we need
- Native browser `EventSource` API

### 2.2 New Data Flow

```
GET /calendar/sync (SSE)
       ↓
   Backend paginated fetch from Google
       ↓
   For each page:
   1. Sort by proximity to today
   2. Yield SSE event with events batch
       ↓
   Frontend EventSource receives batch
       ↓
   Insert into Dexie immediately
       ↓
   LiveQuery triggers UI update
       ↓
   Queue for Supabase (background)
       ↓
   After all pages:
   1. Backend stores sync token
   2. Yields SSE event with sync token
   3. Yields complete event
       ↓
   Frontend stores sync token in Dexie syncMeta
```

**Key difference**: Events appear in UI as each page loads, not after entire sync completes.

### 2.3 Proximity Sorting

Events are sorted by absolute distance from today before streaming:

```
Today = Jan 15
Event A: Jan 15 (distance 0) → first
Event B: Jan 14 (distance 1) → second
Event C: Jan 16 (distance 1) → third
Event D: Jan 10 (distance 5) → later
Event E: Jan 20 (distance 5) → later
```

**Why**: User's most relevant events (today, this week) appear first. Creates perception of fast loading even if total sync takes time.

### 2.4 Single Endpoint Design

One endpoint handles all sync scenarios:

| Scenario | Request | Behavior |
|----------|---------|----------|
| First sync | `GET /calendar/sync?calendar_ids=a,b,c` | Full pagination, stream all events |
| Delta sync | `GET /calendar/sync?calendar_ids=a,b,c&sync_tokens={...}` | Use tokens for incremental fetch |
| Token expired | (410 from Google) | Fallback to full sync for that calendar |

**Why single endpoint**:
- One code path to test and maintain
- Frontend logic simplified
- SSE handles both fast (delta) and slow (full) syncs gracefully

### 2.5 SSE Event Protocol

| Event Type | Payload | When |
|------------|---------|------|
| `events` | `{ calendar_id, events: [...], page, total_pages? }` | Each pagination page |
| `progress` | `{ calendar_id, page, events_so_far }` | Progress updates |
| `sync_token` | `{ calendar_id, token }` | After calendar fully synced |
| `error` | `{ calendar_id?, code, message, retryable }` | Errors (partial or fatal) |
| `complete` | `{ total_events, calendars_synced }` | Stream finished |

**Design decisions**:
- `calendar_id` on each event so frontend can handle multi-calendar sync
- `page` number for progress indication
- `sync_token` event separate from `complete` so frontend can store it
- `error` can be per-calendar (continue others) or fatal (stream ends)

---

## Part 3: Backend Implementation Guide

### 3.1 Overview of Changes

**Files to modify**:
- `routers/calendar.py` - Add SSE endpoint, remove old sync endpoints
- `calendar/gcal.py` - Add streaming pagination generator, remove phased functions
- `calendar/helpers.py` - Remove webhook helpers
- `calendar/constants.py` - Remove `PhasedSyncConfig`

**New dependency**: `sse-starlette` for FastAPI SSE support

### 3.2 The SSE Endpoint

Create a new endpoint that returns `EventSourceResponse`:

**Route**: `GET /calendar/sync`

**Query parameters**:
- `calendar_ids` (required): Comma-separated calendar UUIDs
- `sync_tokens` (optional): JSON-encoded object `{ calendar_id: token, ... }`

**Response**: `text/event-stream`

**Flow**:
1. Parse calendar IDs and sync tokens from query params
2. Validate user owns all requested calendars
3. Create async generator that yields SSE events
4. For each calendar:
   - Get sync token from param or fetch from DB
   - Call pagination generator (yields pages)
   - For each page: sort by proximity, yield `events` SSE event
   - After pagination complete: yield `sync_token` event
5. After all calendars: yield `complete` event
6. Return `EventSourceResponse` wrapping the generator

**Error handling**:
- 410 from Google: Clear sync token, restart that calendar's sync
- 401 from Google: Mark account `needs_reauth`, yield error event, continue others
- Network errors: Yield error event with `retryable: true`
- Fatal errors: Yield error event, close stream

### 3.3 Streaming Pagination Generator

Modify `_paginate_events` in `gcal.py` to be an async generator:

**Current**: Returns dict with all events after fetching all pages
**New**: Yields each page's events as they're fetched

The generator should:
1. Build params (time bounds, sync token, etc.)
2. Loop: fetch page, yield events, check for next page token
3. After final page: yield the sync token
4. Caller can process each yield independently

**Why generator**: Allows SSE endpoint to stream events without waiting for full pagination.

### 3.4 Proximity Sort Function

Create a helper that sorts events by distance from today:

**Input**: List of transformed events
**Output**: Sorted list

**Sort key**:
1. Parse event's start datetime (handle all-day dates)
2. Calculate absolute days from today
3. Secondary sort by start time for same-day events

**Edge cases**:
- All-day events: Use the date, treat as midnight
- Recurring masters: Use the DTSTART from recurrence rule
- Missing start: Sort to end (shouldn't happen but be defensive)

### 3.5 Sync Token Storage

After streaming all pages for a calendar, store the sync token:

**Important**: Only store after ALL pages fetched. If we store mid-stream and connection drops, we'd lose events.

**Storage location**: `calendar_sync_state.sync_token`

**Also update**:
- `last_sync_at`: Current timestamp
- `full_sync_complete`: True if this was a full sync (no prior token)

### 3.6 Functions to Remove from gcal.py

| Function | Reason |
|----------|--------|
| `fetch_viewport_events` | Phased concept gone |
| `fetch_future_events` | Phased concept gone |
| `fetch_historical_events` | Phased concept gone |
| `fetch_historical_events_streaming` | Replaced by generator approach |
| `sync_phased` | Phased concept gone |
| `watch_calendar` | Removing webhooks |
| `stop_watch` | Removing webhooks |
| `generate_webhook_token` | Removing webhooks |

### 3.7 Functions to Remove from helpers.py

| Function | Reason |
|----------|--------|
| `update_webhook_state` | Removing webhooks |
| `clear_webhook_state` | Removing webhooks |
| `get_webhook_token_by_channel` | Removing webhooks |
| `get_calendar_by_webhook_channel` | Removing webhooks |
| `get_sync_info_by_channel` | Removing webhooks |
| `get_expiring_channels` | Removing webhooks |
| `has_valid_watch` | Removing webhooks |

### 3.8 Endpoints to Remove from routers/calendar.py

| Endpoint | Function |
|----------|----------|
| `POST /sync` | `sync_calendars` |
| `POST /initial-sync` | `initial_sync` |
| `POST /phased-sync` | `phased_sync` |
| `POST /google/webhook` | `google_webhook` |
| `POST /cron/renew-channels` | `renew_expiring_channels` |

Also remove:
- `_verify_webhook_token` helper
- Response models: `SyncResponse`, `InitialSyncResponse`, `PhasedSyncResponse`, `WebhookResponse`, `ChannelRenewalResult`, `ChannelRenewalResponse`

### 3.9 Endpoints to Keep

| Endpoint | Function | Purpose |
|----------|----------|---------|
| `GET /events` | `list_events` | Query cached events from Supabase |
| `GET /accounts` | `list_google_accounts` | List user's Google accounts |
| `GET /calendars` | `list_google_calendars` | List user's calendars |
| `GET /sync-status` | `get_sync_status` | Check last sync timestamp |
| `POST /accounts/{id}/refresh-calendars` | `refresh_calendars_from_google` | Refresh calendar list from Google |
| `POST /process-embeddings` | `trigger_embedding_processing` | AI embedding processing |

---

## Part 4: Frontend Implementation Guide

### 4.1 Overview of Changes

**Files to modify**:
- `hooks/useCalendarSync.ts` - Complete rewrite for SSE
- `contexts/EventsContext.tsx` - Simplify, remove phased sync state
- `api/google.ts` - Remove old sync functions

**Files to delete**:
- `hooks/useGoogleEvents.ts`
- `hooks/useSync.ts`
- `hooks/useCombinedEvents.ts`

### 4.2 The New useCalendarSync Hook

This hook replaces all sync logic with a single SSE-based approach.

**State**:
- `status`: 'idle' | 'connecting' | 'syncing' | 'error'
- `progress`: `{ eventsLoaded: number, calendarsComplete: number, totalCalendars: number }`
- `error`: Error message if any

**Exposed functions**:
- `sync()`: Start SSE sync
- `cancel()`: Abort current sync

**Internal flow**:
1. Get visible calendar IDs from calendars store
2. Get sync tokens from Dexie `syncMeta` table
3. Build SSE URL with query params
4. Create `EventSource` connection
5. Handle `onmessage` events:
   - `events`: Parse, insert into Dexie via `upsertEvents()`
   - `progress`: Update progress state
   - `sync_token`: Store in Dexie `syncMeta`
   - `error`: Handle error (retry if retryable)
   - `complete`: Close connection, set status idle
6. Handle `onerror`: Reconnect logic with backoff

**EventSource vs fetch**: Use native `EventSource` for automatic reconnection. Alternative is `fetch` with `ReadableStream` for more control, but `EventSource` is simpler.

### 4.3 Handling SSE Events

**On `events` event**:
1. Parse JSON from `event.data`
2. Transform events to Dexie format using existing `calendarEventToDexie()`
3. Mark as `pendingSupabaseSync: true`
4. Call `upsertEvents()` (existing function)
5. LiveQuery automatically updates UI

**On `sync_token` event**:
1. Parse calendar_id and token from data
2. Store in Dexie: `setSyncMeta(\`sync_token:\${calendarId}\`, token)`

**On `error` event**:
1. Parse error details
2. If retryable and under retry limit: schedule retry with backoff
3. If not retryable or max retries: set error state, close connection

**On `complete` event**:
1. Update `lastSyncAt` in Dexie
2. Set status to 'idle'
3. Close EventSource

### 4.4 Sync Token Storage in Dexie

Store tokens in `syncMeta` table with key pattern `sync_token:{calendarId}`:

**Structure**:
```
key: "sync_token:abc123-uuid"
value: "CAESBgoEAEABCAA..." (Google's sync token)
updatedAt: "2024-01-15T10:00:00Z"
```

**On sync start**: Load tokens for requested calendars
**On sync complete**: Update token for each calendar

**Why Dexie not localStorage**: Consistent with other sync state, transactional with events.

### 4.5 Progress Indication

The hook exposes progress state:

```
{
  eventsLoaded: 342,
  calendarsComplete: 1,
  totalCalendars: 3
}
```

**UI can show**:
- "Loading events..." with count
- Progress bar based on calendars complete
- Calendar-specific status in sidebar

**Design choice**: We don't know total pages upfront (Google doesn't tell us), so we can't show "page 3 of 10". We can show events loaded and calendars complete.

### 4.6 Auto-Sync Triggers

Keep the same triggers but use new sync:

| Trigger | Implementation |
|---------|----------------|
| Manual | User clicks sync button, calls `sync()` |
| Poll | `setInterval` every 5 minutes, calls `sync()` |
| Focus | `window.focus` event, calls `sync()` if stale (>5 min) |
| Initial | On mount, check Dexie count, call `sync()` if needed |

**Remove**: Webhook-triggered sync (webhooks removed)

### 4.7 Simplifying EventsContext

Current `EventsContext` has complex state for phased sync:
- `syncedRange` - Which date range is synced
- `viewportLoaded` - Whether viewport phase complete
- `isBackgroundSyncing` - Whether background phases running

**With SSE, remove all of this**:
- Events stream in sorted by proximity, no "viewport" concept
- Progress is visible via hook state
- No background phases

**Simplified context provides**:
- `events` - From `useEventsLive()` (Dexie LiveQuery)
- `isLoading` - From `useCalendarSync().status === 'connecting'`
- `isSyncing` - From `useCalendarSync().status === 'syncing'`
- `error` - From `useCalendarSync().error`
- `sync` - From `useCalendarSync().sync`
- `progress` - From `useCalendarSync().progress`

### 4.8 Functions to Remove from api/google.ts

| Function | Reason |
|----------|--------|
| `sync()` | Replaced by SSE |
| `syncCalendar()` | Replaced by SSE |
| `syncAllCalendars()` | Replaced by SSE |
| `initialSync()` | Replaced by SSE |
| `phasedSync()` | Replaced by SSE |

**Also remove types**: `SyncResponse`, `InitialSyncResponse`, `PhasedSyncResponse`

### 4.9 Files to Delete

| File | Reason |
|------|--------|
| `hooks/useGoogleEvents.ts` | Was for month-based queries, replaced by LiveQuery |
| `hooks/useSync.ts` | Was React Query wrapper, replaced by new hook |
| `hooks/useCombinedEvents.ts` | Logic consolidated into context |

### 4.10 Keeping useEventsLive

This hook uses Dexie LiveQuery and works perfectly:

1. Subscribes to `db.events.where('calendarId').anyOf(calendarIds)`
2. Returns `{ events, masters, exceptions, isLoading }`
3. Automatically re-renders when Dexie data changes

**No changes needed** - this is the reactive layer that makes SSE work smoothly.

### 4.11 Keeping supabaseQueue

The background queue to Supabase remains unchanged:

1. Events inserted into Dexie with `pendingSupabaseSync: true`
2. Queue batches and flushes to Supabase
3. Marks events as synced

**No changes needed** - decouples UI from persistence.

---

## Part 5: Implementation Order

### Phase 1: Backend SSE Endpoint (No Breaking Changes)

1. Add `sse-starlette` dependency
2. Create streaming pagination generator in `gcal.py`
3. Add proximity sort helper
4. Create new `GET /calendar/sync` SSE endpoint
5. Test endpoint manually with `curl` or EventSource in browser console

**At this point**: Old endpoints still work, new endpoint available for testing.

### Phase 2: Frontend SSE Consumer

1. Create new `useCalendarSync.ts` with SSE logic
2. Add sync token storage to Dexie helpers
3. Update `EventsContext.tsx` to use new hook
4. Test full flow: sign in, sync, see events stream in

**At this point**: App uses new sync, old hooks still exist but unused.

### Phase 3: Cleanup - Frontend

1. Remove old sync functions from `api/google.ts`
2. Delete `useGoogleEvents.ts`
3. Delete `useSync.ts`
4. Delete `useCombinedEvents.ts`
5. Remove unused imports and types

### Phase 4: Cleanup - Backend

1. Remove old sync endpoints from `routers/calendar.py`
2. Remove phased sync functions from `gcal.py`
3. Remove webhook functions from `gcal.py`
4. Remove webhook helpers from `helpers.py`
5. Remove `PhasedSyncConfig` from `constants.py`
6. Remove unused imports

### Phase 5: Database Cleanup (Optional)

1. Consider removing webhook columns from `calendar_sync_state`:
   - `webhook_channel_id`
   - `webhook_resource_id`
   - `webhook_expires_at`
   - `webhook_channel_token`
2. Migration to drop columns (non-breaking, columns just unused)

---

## Part 6: Testing Strategy

### 6.1 Backend Tests

**SSE endpoint tests**:
- Returns `text/event-stream` content type
- Yields events in correct SSE format
- Handles multiple calendars
- Handles sync token for delta sync
- Handles 410 (token expired) gracefully
- Handles 401 (needs reauth) per calendar
- Yields error events appropriately

**Pagination generator tests**:
- Yields each page separately
- Handles empty calendar
- Handles large calendar (many pages)
- Yields sync token at end

**Proximity sort tests**:
- Today's events first
- Handles all-day events
- Handles missing start times
- Handles timezones

### 6.2 Frontend Tests

**useCalendarSync tests**:
- Connects to SSE endpoint
- Handles events message → inserts to Dexie
- Handles sync_token message → stores in Dexie
- Handles error message → sets error state
- Handles complete message → closes connection
- Reconnects on error
- Respects max retries

**Integration tests**:
- Full flow: sync → events appear in UI
- Delta sync: only changed events returned
- Error recovery: retry succeeds

### 6.3 Manual Testing Checklist

- [ ] First sign-in: Events stream in, sorted by date proximity
- [ ] Re-open app: Events load from Dexie instantly, delta sync in background
- [ ] Manual sync: Button triggers sync, progress visible
- [ ] Multiple calendars: All calendars sync, events interleaved
- [ ] Large calendar: Pagination works, no timeout
- [ ] Token expired: Full sync triggered automatically
- [ ] Network error: Retry with backoff
- [ ] Account needs reauth: Error shown, other calendars continue

---

## Part 7: Rollback Plan

If issues arise after deployment:

### Quick Rollback (Frontend)

1. Revert `useCalendarSync.ts` to old version
2. Revert `EventsContext.tsx` to old version
3. Restore deleted hook files from git
4. Restore old functions in `api/google.ts`

**Backend remains unchanged** - old endpoints still exist during Phase 2.

### Full Rollback

1. Revert all frontend changes
2. Remove new SSE endpoint from backend
3. Restore old sync endpoints (if removed)

---

## Part 8: Performance Expectations

### Before (Phased Sync)

- Initial load: 2-5 seconds before any events visible
- Full sync: 10-30 seconds for large calendars
- User sees: Loading spinner → events appear all at once

### After (SSE Streaming)

- Initial load: ~500ms to first events visible
- Full sync: Same total time, but events stream in progressively
- User sees: Events appearing continuously, most relevant first

### Why Same Total Time But Better UX

Total data transferred is identical. The improvement is **perceived performance**:

1. **First contentful paint**: Events visible almost immediately
2. **Relevant first**: Today's events appear before historical
3. **Progressive**: User can interact while sync continues
4. **No jarring updates**: Events don't "pop in" from background tasks

---

## Part 9: Future Considerations

### Potential Enhancements (Not in Scope)

1. **Partial sync on scroll**: Only sync date ranges user scrolls to
2. **Priority calendars**: Sync primary calendar first
3. **Compression**: Gzip SSE stream for large payloads
4. **Resume**: Store cursor to resume interrupted sync

### Why Not Now

- Current scope is simplification, not new features
- These add complexity we're trying to remove
- Can be added later on simpler foundation

---

## Appendix A: SSE Format Reference

### Event Structure

```
event: <event-type>
data: <json-payload>

```

Note: Two newlines end each event.

### Example Stream

```
event: events
data: {"calendar_id":"abc","events":[...],"page":1}

event: progress
data: {"calendar_id":"abc","page":2,"events_so_far":150}

event: events
data: {"calendar_id":"abc","events":[...],"page":2}

event: sync_token
data: {"calendar_id":"abc","token":"CAESB..."}

event: events
data: {"calendar_id":"def","events":[...],"page":1}

event: sync_token
data: {"calendar_id":"def","token":"CAESx..."}

event: complete
data: {"total_events":342,"calendars_synced":2}

```

---

## Appendix B: Removed Code Reference

### Backend: routers/calendar.py

**Endpoints removed**:
- `POST /sync` → `sync_calendars()`
- `POST /initial-sync` → `initial_sync()`
- `POST /phased-sync` → `phased_sync()`
- `POST /google/webhook` → `google_webhook()`
- `POST /cron/renew-channels` → `renew_expiring_channels()`

**Models removed**:
- `SyncResponse`
- `InitialSyncResponse`
- `PhasedSyncResponse`
- `WebhookResponse`
- `ChannelRenewalResult`
- `ChannelRenewalResponse`

**Helpers removed**:
- `_verify_webhook_token()`

### Backend: calendar/gcal.py

**Functions removed**:
- `fetch_viewport_events()`
- `fetch_future_events()`
- `fetch_historical_events()`
- `fetch_historical_events_streaming()`
- `sync_phased()`
- `watch_calendar()`
- `stop_watch()`
- `generate_webhook_token()`

### Backend: calendar/helpers.py

**Functions removed**:
- `update_webhook_state()`
- `clear_webhook_state()`
- `get_webhook_token_by_channel()`
- `get_calendar_by_webhook_channel()`
- `get_sync_info_by_channel()`
- `get_expiring_channels()`
- `has_valid_watch()`

### Backend: calendar/constants.py

**Classes removed**:
- `PhasedSyncConfig`

### Frontend: api/google.ts

**Functions removed**:
- `googleApi.sync()`
- `googleApi.syncCalendar()`
- `googleApi.syncAllCalendars()`
- `googleApi.initialSync()`
- `googleApi.phasedSync()`

**Types removed**:
- `SyncResponse`
- `InitialSyncResponse`
- `PhasedSyncResponse`

### Frontend: hooks/useCalendarSync.ts

**Entire file rewritten. Old functions removed**:
- `toDexieEvents()`
- `storeDexieEvents()`
- `syncAndStore()`
- `syncBackground()`
- `sync()`
- `hydrate()`
- `hydrateFromSupabase()`
- `phasedViewportSync()`

### Frontend: Files Deleted

- `hooks/useGoogleEvents.ts`
- `hooks/useSync.ts`
- `hooks/useCombinedEvents.ts`
