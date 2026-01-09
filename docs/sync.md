# Chronos Event Sync & Caching

A production-level implementation guide for the event caching system.

---

## Part 1: Background & Context

### 1.1 The Problem We're Solving

Calendar apps have a unique data access pattern that makes naive fetching catastrophic:

1. **High-frequency navigation** - Users scroll through months/weeks rapidly, potentially viewing 20+ different time ranges in seconds
2. **Overlapping data needs** - Month view, week view, day view, and sidebar all need events for similar (but not identical) ranges
3. **Multi-calendar complexity** - A user might have 5+ Google calendars, each needing separate API calls
4. **Recurring events** - A single "Weekly standup" can expand into 52+ instances per year

Without caching, a user scrolling from January to December would trigger:
- 12 months × 5 calendars = 60 API calls minimum
- Each call has ~200-500ms latency
- Total: 12-30 seconds of loading for a simple scroll

**Our goal**: Make navigation feel instant (<50ms) while minimizing network requests.

### 1.2 Why Existing Solutions Don't Work

**React Query alone** is insufficient because:
- It caches by query key, which explodes with date ranges
- Memory-only - page refresh loses everything
- No cross-tab coordination

**LocalStorage** is insufficient because:
- 5MB limit (a year of events can exceed this)
- Synchronous API blocks main thread
- No indexing - can't query "events for March" without loading everything

**Service Workers** are overkill because:
- Complex setup for a simple caching need
- Opaque - hard to debug and reason about
- Doesn't solve the indexing problem

### 1.3 Our Solution: Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    React Components                          │
│                 (renders from Zustand)                       │
└──────────────────────────┬──────────────────────────────────┘
                           │ subscribes
┌──────────────────────────▼──────────────────────────────────┐
│                    Zustand Store                             │
│         (in-memory, reactive, fast selectors)                │
└──────────────────────────┬──────────────────────────────────┘
                           │ hydrates from / persists to
┌──────────────────────────▼──────────────────────────────────┐
│                      IndexedDB                               │
│        (durable, survives refresh, indexed queries)          │
└──────────────────────────┬──────────────────────────────────┘
                           │ populated by
┌──────────────────────────▼──────────────────────────────────┐
│                  Quarter Fetcher                             │
│   (parallel calendars, progressive rendering, debounced)     │
└──────────────────────────┬──────────────────────────────────┘
                           │
                    Backend API (asyncio.gather)
                           │
                  Google Calendar API (batched)
```

| Layer | Responsibility | Why It's Here |
|-------|---------------|---------------|
| Zustand | Reactive rendering | Fast selectors, minimal re-renders |
| IndexedDB | Persistence + indexing | Survives refresh, 100MB+ storage, O(1) month lookups |
| Quarter Fetcher | Network efficiency | Progressive rendering, parallel requests, debounced |

### 1.4 Key Insight: Fetch by Quarter, Cache by Month

**Why quarters (not years)?**
- **Progressive rendering** - First quarter loads in ~150ms, UI starts populating immediately
- **Parallelization** - 4 quarters × 5 calendars = 20 parallel requests (with semaphore)
- **Perceived performance** - User sees data 3x faster than waiting for full year

**Why cache by month?**
- UI queries are month-based (month view, week view)
- O(1) lookups via `monthIndex`
- Multi-day events indexed into all overlapping months

**The principle**: `fetch granularity ≠ cache granularity`

---

## Part 2: Google Calendar API Deep Dive

### 2.1 Optimized Request Parameters

The events.list endpoint accepts several parameters that dramatically affect performance:

**`maxResults=2500`**
- Maximum allowed per page
- Reduces pagination round-trips
- A quarter typically fits in 1-2 pages

**`singleEvents=false`** (critical)
- Returns recurring event masters instead of expanded instances
- A weekly meeting for 1 year = 52 instances with `singleEvents=true`
- Same meeting = 1 master with `singleEvents=false`
- We expand instances client-side using the rrule library
- **Result**: 98% less data for recurring events

**`fields=` partial response** (critical)
- Only request fields needed for rendering
- Full event: ~2KB (includes attachments, conferenceData, creator, organizer, reminders, etc.)
- Minimal event: ~200-400 bytes (id, summary, start, end, recurrence, status, colorId)
- **Result**: 80%+ bandwidth savings

| Events | Without fields | With fields | Savings |
|--------|----------------|-------------|---------|
| 100 | 200KB | 40KB | 80% |
| 1000 | 2MB | 400KB | 80% |
| 5000 | 10MB | 2MB | 80% |

**`timeMin/timeMax`**
- Must be RFC3339 with timezone (e.g., `2024-01-01T00:00:00Z`)
- Returns events that *overlap* the range, not just start within it
- This is correct for calendar rendering (shows events that span into view)

### 2.2 Pagination Strategy

Google Calendar API returns max 2500 events per request. For larger result sets:

**Flow**:
1. First request returns events + `nextPageToken`
2. Subsequent requests include `pageToken` parameter
3. Loop until response has no `nextPageToken`
4. Final response includes `nextSyncToken` (save this!)

**Key design decision**: Backend handles pagination internally. Frontend receives complete quarter data in single response. This simplifies frontend logic and enables atomic IndexedDB writes.

### 2.3 Incremental Sync with syncToken

After initial full fetch, Google provides a `syncToken` that enables delta syncs:

**Full sync (first time)**:
- Fetch all pages for the time range
- Final page includes `nextSyncToken`
- Store token in database per calendar

**Incremental sync (subsequent)**:
- Request with `syncToken` parameter only (no timeMin/timeMax)
- Returns only events changed since last sync
- Includes new, modified, and deleted events (status: "cancelled")
- Response includes new `nextSyncToken` for next sync

**Benefits**:
- 3 changed events instead of 1200 total = 99%+ less data
- Essential for background refresh and real-time updates
- Dramatically reduces API quota usage

**Token invalidation (410 Gone)**:
- Tokens expire after ~7 days or when ACLs change
- Server returns 410 status code
- Must clear local cache and perform full sync
- This is expected behavior, not an error

### 2.4 Rate Limits & Mitigation

**Google's limits** (approximate):
- Per-minute per-user: ~50-100 requests
- Per-minute per-project: ~1000 requests
- Errors: 403 (usageLimits) or 429 (Too Many Requests)

**Mitigation strategies**:

1. **Semaphore** - Limit concurrent Google API calls to 10
   - Prevents burst overwhelming the API
   - Still allows parallelization within limits
   - User with 20 calendars won't trigger rate limits

2. **Exponential backoff** - On 429/403:
   - Wait 1s, retry
   - Wait 2s, retry
   - Wait 4s, retry
   - Add random jitter to prevent thundering herd
   - Max 5 retries before failing

3. **Connection pooling** - Reuse HTTP connections
   - Without pooling: each request = TCP + TLS handshake (~100ms overhead)
   - With pooling: connections stay open, reused for subsequent requests
   - Use httpx.AsyncClient with explicit limits

### 2.5 Parallel Fetching Architecture

**The core insight**: Google API calls are I/O-bound (waiting on network), not CPU-bound. Python's asyncio can handle hundreds of concurrent I/O operations on a single thread.

**Sequential fetching** (naive):
```
Calendar 1: ████████ 300ms
Calendar 2:          ████████ 300ms
Calendar 3:                   ████████ 300ms
Total: 900ms
```

**Parallel fetching** (asyncio.gather):
```
Calendar 1: ████████ 300ms
Calendar 2: ████████ 300ms
Calendar 3: ████████ 300ms
Total: ~350ms (limited by slowest)
```

**Two levels of parallelization**:

1. **Frontend → Backend**: 4 quarter requests in parallel
   - Q1, Q2, Q3, Q4 fetched simultaneously
   - Current quarter prioritized (renders first)
   - As each completes, UI updates progressively

2. **Backend → Google API**: All calendars in parallel per quarter
   - 5 calendars = 5 concurrent requests
   - Semaphore prevents overwhelming Google
   - asyncio.gather with return_exceptions=True for partial failures

**Combined effect**:
- User with 5 calendars, viewing year
- Naive: 4 quarters × 5 calendars × 300ms = 6 seconds sequential
- Optimized: ~400ms (first quarter renders in ~150ms)

---

## Part 3: Frontend Data Flow

### 3.1 Initial Load Sequence

When user opens the app (e.g., March 2025):

**Step 1: Hydrate from IndexedDB** (0-50ms)
- Load all cached events into Zustand store
- Build monthIndex for O(1) lookups
- UI renders immediately with cached data
- User sees calendar populated instantly

**Step 2: Determine needed quarters**
- Current year: 2025 → Q1, Q2, Q3, Q4
- Previous year: 2024 → Q1, Q2, Q3, Q4
- Next year: 2026 → Q1, Q2, Q3, Q4 (maybe just Q1-Q2)

**Step 3: Check what's already cached**
- Look up `fetchedQuarters` in IndexedDB
- Skip quarters already fetched
- Only fetch missing quarters

**Step 4: Fetch missing quarters in parallel**
- Fire all quarter requests simultaneously
- Max 3 concurrent to leave room for other requests
- As each completes: persist to IDB, update Zustand, UI re-renders

**Step 5: Progressive rendering**
- First quarter completes in ~150ms → events appear
- Remaining quarters fill in over next ~300ms
- User perceives instant load

### 3.2 Scroll-Triggered Fetching

When user scrolls to an uncached month:

**Debouncing** (critical):
- User scrolls rapidly: March 2025 → Feb → Jan → Dec 2024 → Nov → Oct
- Without debounce: 6 fetch requests (wasteful)
- With 150ms debounce: wait for scroll to settle, then 1 fetch request

**Flow**:
1. User scrolls, viewport changes
2. Debounce timer starts/resets on each scroll event
3. After 150ms of no scrolling, timer fires
4. Check if current viewport's quarter is cached
5. If not cached, fetch that quarter
6. Fetched quarters skip past months (Oct, Nov) - only fetch where user stopped (Dec 2024)

**Why this works**:
- Fast scrollers only trigger fetch at destination
- Slow scrollers get fetch after brief pause
- Scrolled-past quarters fetched lazily if user returns

### 3.3 IndexedDB Schema Design

**Store: `events`**
- Key: `eventKey` = `${calendarId}:${eventId}`
- Why composite: Google's event.id is only unique within a calendar
- Stores full event payload plus computed `startMonth` and `endMonth`

**Store: `eventMonths`**
- Key: `[monthKey, eventKey]` (compound)
- Purpose: Fast month lookups without scanning all events
- Multi-day events have multiple entries (one per overlapping month)
- Index on `monthKey` for efficient range queries

**Store: `fetchedQuarters`**
- Key: `${year}-Q${quarter}` (e.g., "2024-Q3")
- Tracks which quarters have been fetched
- Enables "is this cached?" check without scanning events

**Store: `syncTokens`**
- Key: `calendarId`
- Stores Google's syncToken per calendar
- Used for incremental sync on background refresh

**Store: `meta`**
- Key: `userId`, `schemaVersion`, `lastHydratedAt`
- `userId`: If different user logs in, wipe entire database
- `schemaVersion`: Handle migrations on version bump

### 3.4 Zustand Store Design

**State**:
- `eventsByKey`: Map for O(1) event lookup by key
- `monthIndex`: Map of monthKey → Set of eventKeys
- `fetchedQuarters`: Set of quarter strings
- `isHydrated`: Boolean for loading state

**Why Map instead of Object**:
- O(1) insertion vs O(n) spread for objects
- Preserves insertion order
- Built-in size property
- Better memory characteristics for large datasets

**Selector pattern**:
- `getEventsForMonth(monthKey)` → looks up in monthIndex, returns events
- Called during render, must be fast
- monthIndex makes this O(1) lookup + O(k) retrieval where k = events in month

**Update pattern**:
- `addEvents(events)` → batch update eventsByKey and monthIndex
- Single state update to minimize re-renders
- Zustand's shallow comparison handles this efficiently

---

## Part 4: Backend Architecture

### 4.1 Quarter Fetch Endpoint

**Endpoint**: `POST /google/fetch-quarter`

**Input**: `{ year: 2024, quarter: 3 }`

**Behavior**:
1. Get all user's calendars from database
2. Compute quarter bounds (Q3 2024 = Jul 1 - Sep 30)
3. Fetch all calendars in parallel using asyncio.gather
4. For each calendar, handle pagination internally
5. Persist events to Supabase (source of truth)
6. Return combined events to frontend for caching

**Output**: `{ events: [...], masters: [...] }`

**Why separate masters?**
- Recurring event masters need special handling
- Frontend expands masters into instances using rrule
- Keeps response structure explicit

### 4.2 Parallel Execution Model

**asyncio.gather for I/O-bound parallelism**:
- All calendar fetches run concurrently
- Event loop switches between tasks while waiting on network
- Single Python thread handles multiple concurrent HTTP requests
- Perfect for I/O-bound workloads like API calls

**Semaphore for rate limiting**:
- Limit concurrent Google API calls to 10
- Prevents overwhelming Google's rate limits
- Additional requests queue behind semaphore
- Still much faster than sequential

**return_exceptions=True for resilience**:
- If one calendar fails, others still return
- Partial results better than total failure
- Log failures, return successful calendars

### 4.3 Supabase as Source of Truth

**Why persist to Supabase?**
- Cross-device sync (same events on phone and laptop)
- AI features need server-side access to events
- Backup if user clears browser data
- Enables sharing and collaboration features

**Write flow**:
1. Fetch from Google API
2. Upsert to Supabase events table
3. Return to frontend for IndexedDB caching

**Read flow (after initial sync)**:
- Frontend reads from IndexedDB (instant)
- Background sync updates Supabase
- IndexedDB refreshed from backend response

### 4.4 syncToken Storage

**Per-calendar storage**:
- Each Google calendar has its own syncToken
- Stored in `calendar_sync_state` table in Supabase
- Used for incremental sync on background refresh

**Token lifecycle**:
1. Full fetch → save returned syncToken
2. Incremental sync → use saved syncToken, save new one
3. Token invalidated (410) → clear token, do full fetch
4. User re-auths → clear all tokens, fresh start

---

## Part 5: Performance Characteristics

### 5.1 Time Complexity

| Operation | Complexity | Notes |
|-----------|------------|-------|
| `getEventsForMonth` | O(1) + O(k) | k = events in month |
| `addEvents` | O(n × m) | n = events, m = avg months per event |
| `hydrateFromIDB` | O(n) | n = total cached events |
| `isQuarterFetched` | O(1) | Single IndexedDB lookup |

### 5.2 Space Complexity

| Store | Size Estimate | Notes |
|-------|---------------|-------|
| events | ~400 bytes/event | With partial response optimization |
| eventMonths | ~50 bytes/link | Events × avg months overlap |
| Zustand | Same as IDB | In-memory mirror |

**Typical user**: 2000 events across 5 years ≈ 1MB total

### 5.3 Network Efficiency Comparison

**Naive approach**:
- User views 12 months: 12 months × 5 calendars × 2KB/event × 200 events = 24MB
- Latency: 60 sequential requests × 300ms = 18 seconds

**Optimized approach**:
- Initial load: 4 quarters × 400 bytes/event × 500 events = 800KB
- Latency: ~400ms (parallel)
- Subsequent navigation: 0ms (from cache)

**Savings**: 96% less bandwidth, 97% less latency

### 5.4 Time-to-First-Render

| Approach | Time-to-first-render | Total load time |
|----------|---------------------|-----------------|
| Year-based, sequential calendars | ~1500ms | ~1500ms |
| Year-based, parallel calendars | ~400ms | ~400ms |
| Quarter-based, parallel | **~150ms** | ~400ms |

The quarter-based approach wins because user sees current quarter immediately while other quarters load in background.

---

## Part 6: Edge Cases & Error Handling

### 6.1 Multi-Day Events

An event from Dec 28, 2024 to Jan 3, 2025 must appear in:
- December 2024 month view
- January 2025 month view
- Both Q4 2024 and Q1 2025 caches

**Solution**: When persisting events, compute all overlapping months using start/end dates. Create eventMonths entry for each. Event appears in both month views correctly.

### 6.2 User Switching

If user A logs out and user B logs in, we must not show A's events to B.

**Solution**: Store userId in IndexedDB meta. On app init, compare stored userId with current user. If different, wipe entire database before hydrating.

### 6.3 Rate Limiting

If Google returns 429 or 403:
- Implement exponential backoff (1s, 2s, 4s, 8s, 16s)
- Add random jitter to prevent thundering herd
- Max 5 retries before surfacing error to user
- Semaphore prevents triggering limits in first place

### 6.4 Offline Support

If user is offline:
- `hydrateFromIDB()` still works - shows cached data
- Quarter fetches fail gracefully - show cached data, queue for retry
- Display offline indicator, don't block UI
- When back online, sync queued quarters

### 6.5 syncToken Invalidation

When Google returns 410 Gone:
- Token has expired or permissions changed
- Clear local cache for that calendar
- Perform fresh full fetch
- Save new syncToken
- This is expected behavior, handle gracefully

### 6.6 Stale Data

Cached data can become stale if:
- Another device modified calendar
- Someone else modified shared calendar
- Recurring event was edited

**Current approach**: Background sync on app focus using syncToken. Incremental sync returns only changes.

**Future enhancement**: WebSocket for real-time updates from Google push notifications.

---

## Part 7: Implementation Phases

### Phase 1: Backend Quarter Endpoint
- Add `POST /google/fetch-quarter` endpoint
- Implement parallel calendar fetching with asyncio.gather
- Add semaphore for rate limiting
- Store syncToken per calendar in Supabase

### Phase 2: IndexedDB Layer
- Set up IDB with events, eventMonths, fetchedQuarters, meta stores
- Implement upsertEvents with month overlap computation
- Implement getEventsForMonth using monthIndex
- Add userId check for user switching

### Phase 3: Zustand Store
- Create events store with Map-based state
- Implement hydrateFromIDB action
- Implement addEvents with monthIndex updates
- Add selectors for month queries

### Phase 4: Quarter Fetcher
- Implement fetchQuarter with deduplication
- Add max concurrent limit (3 quarters)
- Implement queue for excess requests
- Wire up to Zustand and IndexedDB

### Phase 5: Hook & Context Integration
- Create useEventsCache hook
- Implement initial load sequence
- Add debounced scroll handling
- Update EventsContext to use new system

### Phase 6: Incremental Sync
- Add background sync on app focus
- Use stored syncTokens for delta sync
- Handle 410 Gone with full refresh
- Update UI with sync status

---

## Part 8: Testing Checklist

### Functional Tests
- [ ] Initial load fetches ±2 years of quarters
- [ ] Scroll to uncached quarter triggers fetch
- [ ] Scroll to cached quarter shows instantly
- [ ] Fast scroll only fetches destination quarter
- [ ] Multi-day event appears in both months
- [ ] Recurring events expand correctly
- [ ] Visibility toggle filters without refetch
- [ ] Page refresh shows cached data instantly
- [ ] Different user login clears cache
- [ ] syncToken incremental sync works
- [ ] 410 handling triggers full refresh

### Performance Tests
- [ ] Initial hydration < 100ms for 2500 events
- [ ] Time-to-first-render < 200ms
- [ ] Month render < 16ms (60fps)
- [ ] Max 3 concurrent quarter fetches
- [ ] Memory stays under 50MB

### Error Handling Tests
- [ ] Network failure shows error, doesn't crash
- [ ] Rate limit triggers backoff
- [ ] Offline shows cached data
- [ ] Corrupt IndexedDB recovers gracefully

---

## Part 9: Constants Reference

| Constant | Value | Rationale |
|----------|-------|-----------|
| `MAX_CONCURRENT_QUARTERS` | 3 | Leave room for other requests, browser limit is 6 |
| `SCROLL_DEBOUNCE_MS` | 150 | Fast enough to feel responsive, slow enough to avoid spam |
| `GOOGLE_API_SEMAPHORE` | 10 | Well under rate limits, still allows parallelization |
| `MAX_RETRIES` | 5 | Covers most transient failures without infinite loops |
| `INITIAL_YEARS_BACK` | 2 | Most users look at recent history |
| `INITIAL_YEARS_FORWARD` | 2 | Planning ahead is common |
| `FRESHNESS_WINDOW_MS` | 15 min | Balance between fresh data and API usage |
