# Chronos Event Caching

## TL;DR

**Goal**: Instant calendar UI with no duplicate network requests.

**Stack**: IndexedDB (persistent) → Zustand (reactive) → TanStack Query (network)

**Key Principle**: Cache by month, fetch all calendars at once, filter visibility client-side.

---

## Quick Reference

### Key Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `FRESHNESS_WINDOW_MS` | 15 min | How long before re-fetching a cached month |
| `LEASE_TTL_MS` | 30-60 sec | Lock timeout for cross-tab coordination |
| `SCROLL_DEBOUNCE_MS` | 200 ms | Wait for scroll to settle before fetching |
| `MAX_CONCURRENT_FETCHES` | 2-3 | Parallel request limit |
| `DB_NAME` | `chronos-calendar` | IndexedDB database name |

### Key Identifiers

| Key | Format | Example |
|-----|--------|---------|
| `monthKey` | `YYYY-MM` | `2024-03` |
| `eventKey` | `{calendarId}:{eventId}` | `cal123:evt456` |
| `calendarMonthKey` | `{calendarId}:{monthKey}` | `cal123:2024-03` |
| `rangeKey` | `events:{userId}:{start}:{end}:{scope}` | `events:user1:2024-03-01:2024-03-31:all` |

### Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /events?start=&end=&calendar_ids=` | Fetch events for range |
| `GET /google/synced-months` | Get server coverage map |
| `POST /google/calendars/{id}/fetch-range` | Trigger server-side fetch |
| `POST /google/calendars/{id}/sync` | Incremental sync |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        UI Components                         │
│                    (Month/Week/Day views)                    │
└──────────────────────────┬──────────────────────────────────┘
                           │ selectors
┌──────────────────────────▼──────────────────────────────────┐
│                     Zustand Store                            │
│              (in-memory working set + selectors)             │
│                                                              │
│  • eventsByKey: Map<eventKey, Event>                        │
│  • monthToEventKeys: Map<monthKey, Set<eventKey>>           │
│  • fetchStatus: Map<rangeKey, Status>                       │
└──────────────────────────┬──────────────────────────────────┘
                           │ hydrate/persist
┌──────────────────────────▼──────────────────────────────────┐
│                       IndexedDB                              │
│                   (durable cache layer)                      │
│                                                              │
│  Stores:                                                     │
│  • events         - event payloads by eventKey              │
│  • eventMonths    - [monthKey, eventKey] index              │
│  • fetchRegistry  - fetch status + leases                   │
│  • serverCoverage - which months server has synced          │
│  • meta           - userId, schemaVersion                   │
└──────────────────────────┬──────────────────────────────────┘
                           │ fetch (deduped)
┌──────────────────────────▼──────────────────────────────────┐
│                    Fetch Layer                               │
│           (TanStack Query for orchestration)                 │
│                                                              │
│  • ensureMonthLoaded(monthKey)                              │
│  • prefetchMonths(monthKeys)                                │
│  • Two-layer dedupe: in-memory + persistent                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
                      Backend API
```

---

## IndexedDB Schema

### `events` store
```
Key:   eventKey (string)
Value: {
  ...CalendarEvent,
  startMonth: "YYYY-MM",
  endMonth?: "YYYY-MM"
}
```

### `eventMonths` store
```
Key:   [monthKey, eventKey]
Value: { monthKey, eventKey }
```
One entry per month an event overlaps. Multi-day events have multiple entries.

### `fetchRegistry` store
```
Key:   requestKey (string)
Value: {
  status: 'fetched' | 'fetching' | 'error',
  lastFetched?: ISO,
  errorCount?: number,
  lastError?: string,
  retryAfter?: ISO,
  leaseId?: string,
  leaseExpiresAt?: ISO
}
```

### `serverCoverage` store
```
Key:   calendarMonthKey
Value: { synced: boolean, syncedAt?: ISO }
```

### `meta` store
```
Keys: userId, schemaVersion, cacheBuster, lastHydratedAt
```

---

## Month Loading Algorithm

```
ensureMonthLoaded(monthKey):
│
├─► Step 1: Hydrate from IDB (instant, works offline)
│   └─► Read eventMonths[monthKey] → bulk get events → update Zustand
│
├─► Step 2: Check if network needed
│   │
│   │   fetchRegistry[rangeKey].status?
│   │   ├─ 'fetched' + fresh     → DONE
│   │   ├─ 'fetching' + valid lease → WAIT
│   │   ├─ 'error' + retryAfter  → DONE (show error)
│   │   └─ else                  → CONTINUE
│   │
│   └─► Also check: navigator.onLine?
│
├─► Step 3: Ensure server coverage (optional)
│   └─► GET /google/synced-months
│       └─► For missing months: POST /google/calendars/{id}/fetch-range
│
└─► Step 4: Fetch events
    ├─► Acquire lease in fetchRegistry
    ├─► GET /events?start=&end=
    ├─► Persist to IDB (events + eventMonths)
    ├─► Update Zustand from IDB (not from network response)
    └─► Mark fetchRegistry as 'fetched'
```

---

## Dedupe Strategy

### Layer 1: In-Memory (per tab)

```typescript
const pendingRequests = new Map<string, Promise<void>>()

async function fetchWithDedupe(key: string, fn: () => Promise<void>) {
  const existing = pendingRequests.get(key)
  if (existing) return existing

  const promise = fn().finally(() => pendingRequests.delete(key))
  pendingRequests.set(key, promise)
  return promise
}
```

Handles: Strict Mode double-mounts, multiple components requesting same month.

### Layer 2: Persistent (cross-tab)

Uses `fetchRegistry` with leases:

1. **Acquire**: Set `status='fetching'`, `leaseId`, `leaseExpiresAt`
2. **Complete**: Set `status='fetched'`, clear lease
3. **Error**: Set `status='error'`, `retryAfter`, clear lease
4. **Takeover**: If `leaseExpiresAt < now`, another tab can acquire

Use `BroadcastChannel('chronos-cache')` for cross-tab notifications.

---

## Scroll Behavior & Priority Queue

### Problem: Fast Scrolling

User scrolls from Jan → May, passing Feb/Mar/Apr unfetched:

```
Jan → Feb → Mar → Apr → May (stop)
      ↓     ↓     ↓     ↓
      skip  skip  skip  FETCH
```

Without handling, this triggers 4 concurrent requests. We want 1.

### Solution: Debounce + Priority Queue

```
┌─────────────────────────────────────┐
│         Priority Queue              │
├─────────────────────────────────────┤
│ P0: Visible month (where user is)   │
│ P1: Adjacent months (±1)            │
│ P2: Buffer months (±2)              │
│ P3: Skipped months (fetch later)    │
└─────────────────────────────────────┘

Constraints:
• Debounce: 200ms (wait for scroll to settle)
• Max concurrent: 2-3 requests
• Cancel stale: drop queued requests on new navigation
```

### Scheduler Behavior

| Event | Action |
|-------|--------|
| User scrolls | Reset debounce timer, don't fetch yet |
| Scroll settles (200ms) | Queue visible month at P0 |
| P0 completes | Queue adjacent months at P1 |
| User scrolls again | Cancel pending P1/P2, reset debounce |

### Key Rules

1. **Never fetch passed-by months at same priority as destination**
   - Scrolled Jan→May? May is P0, Feb/Mar/Apr are P3

2. **Adjacent months only after visible loads**
   - Don't prefetch Apr/Jun until May is done

3. **Stale requests are droppable**
   - If user scrolls away before fetch starts, cancel it

4. **Hydrate immediately, fetch lazily**
   - Always show cached data while waiting for debounce

### Validation

- [ ] Fast scroll Jan→Dec → only 1-2 network calls (Dec + adjacent)
- [ ] Scroll, pause, scroll again → intermediate fetches cancelled
- [ ] Passed-by months don't block visible month

---

## File Structure

```
frontend/src/lib/db/
├── open.ts              # DB setup + migrations
├── eventsRepo.ts        # events + eventMonths CRUD
├── fetchRegistryRepo.ts # registry + lease ops
└── metaRepo.ts          # userId, cacheBuster

frontend/src/lib/cache/
├── requestKeys.ts       # rangeKey, coverageKey builders
├── scheduler.ts         # concurrency limits, debounce
└── ensureMonth.ts       # main loading algorithm
```

---

## Common Patterns

### Visibility Toggles

**DO**: Fetch all calendars, filter in selectors
```typescript
const visibleEvents = useMemo(
  () => events.filter(e => visibleCalendarIds.has(e.calendarId)),
  [events, visibleCalendarIds]
)
```

**DON'T**: Include calendar IDs in request key (causes refetch on toggle)

### Month Navigation

**DO**: Hydrate from IDB first, then fetch if stale
```typescript
useEffect(() => {
  hydrateMonthFromIDB(monthKey).then(() => setLoaded(true))
  ensureMonthLoaded(monthKey)
}, [monthKey])
```

**DON'T**: Wait for network before showing cached data

### Multi-Day Events

**DO**: Index into all overlapping months
```typescript
function getOverlapMonths(start: Date, end: Date): string[] {
  const months: string[] = []
  let current = startOfMonth(start)
  while (current <= end) {
    months.push(format(current, 'yyyy-MM'))
    current = addMonths(current, 1)
  }
  return months
}
```

---

## Backend Requirements

### `/events` Must Be Overlap-Correct

Return events where: `eventStart < rangeEnd AND eventEnd > rangeStart`

Not just events whose start falls in range.

### All-Day End Dates Are Exclusive

Google uses exclusive end dates: a 3-day event starting Jan 1 has `end.date = 2024-01-04`.

### Month Format Normalization

Server may return `YYYY-M`. Client normalizes to `YYYY-MM`.

---

## Security Notes

IndexedDB stores **plaintext** event data (titles, descriptions, locations).

**Mitigations**:
- Add "Clear cache" in Settings
- Consider storing only rendering fields (start/end/summary)
- Strong XSS posture (strict CSP)

---

## Validation Checklist

- [ ] Navigate back to cached month → 0 network calls
- [ ] Strict Mode → no double fetches
- [ ] Two tabs same month → only one fetches (lease)
- [ ] Reload → cached months show instantly
- [ ] Visibility toggle → no network calls
- [ ] Offline → cached months display
- [ ] User switch → no data leakage (check `meta.userId`)
- [ ] Fast scroll Jan→Dec → only 1-2 network calls
- [ ] Scroll, pause, scroll again → intermediate fetches cancelled

---

## Implementation Phases

### Phase 1: Foundations
- Month utilities (`YYYY-MM` normalization, overlap computation)
- IDB setup with stores
- Event serialization

### Phase 2: Registry + Dedupe
- `fetchRegistry` CRUD
- Lease acquire/release/takeover
- In-memory promise map

### Phase 3: Event Persistence
- `upsertEvents()` → updates `events` + `eventMonths`
- `loadMonth()` → reads via `eventMonths` index

### Phase 4: Fetch Layer
- `ensureServerCoverage()`
- `fetchMonthRange()` with lease + persist
- Prefetch scheduler

### Phase 5: UI Wiring
- Zustand events store
- Update EventsProvider to hydrate + ensure months
- Visibility selectors

### Phase 6: Validation
- Dev logging for network calls
- Test all edge cases
