# Plan: Split fetch-events into Stacked PRs (≤500 LOC each)

## Current State
- **auth-refactor branch**: EXISTS but OUTDATED (missing OAuth state, Vite proxy fixes)
- **fetch-events branch**: Has latest auth improvements + calendar sync (4 commits + uncommitted)
- **Total changes**: ~9500 LOC → need ~19 PRs at 500 LOC each
- **Decision**: Use fetch-events as source for all PRs (auth-refactor is superseded)

## Constraints
- **Maximum 500 LOC per PR** for reviewability
- **Use Graphite CLI** to manage stacked PRs (avoids manual rebasing)

## Final Stack (9 PRs TOTAL - CONSOLIDATED)

```
main
 └─ PR1: auth-stack (~500 LOC) - backend + frontend auth together
     └─ PR2: calendar-backend-core (~492 LOC) - database + gcal client
         └─ PR3: calendar-backend-sync (~490 LOC) - helpers + router
             └─ PR4: frontend-storage (~493 LOC) - indexeddb + recurrence
                 └─ PR5: frontend-realtime (~407 LOC) - stores + sse hooks
                     └─ PR6: calendar-sync-hook (~335 LOC)
                         └─ PR7: calendar-ui (~444 LOC)
                             └─ PR8: todo-refactor (~465 LOC)
                             └─ PR9: chat-feature (NO MERGE)
```

**Merged PRs:**
- Combined backend auth + frontend auth (was 2, now 1)
- Combined calendar database + gcal client (was 2, now 1)
- Combined helpers + router (was 2, now 1)
- Combined indexeddb + recurrence (was 2, now 1)
- Combined stores + sse hooks (was 2, now 1)

## Detailed PR Breakdown (Consolidated)

### PR1: auth-stack (base: main)
**Scope**: Complete auth implementation (backend + frontend)
**Backend**:
- backend/app/routers/auth.py (OAuth state, refresh tokens)
- backend/app/core/encryption.py
- backend/app/core/db_utils.py
- backend/app/core/dependencies.py
- backend/app/config.py
**Frontend**:
- frontend/src/contexts/AuthContext.tsx
- frontend/src/pages/AuthCallback.tsx
- frontend/vite.config.ts
- frontend/src/lib/crypto.ts (updates)
- frontend/src/types/auth.ts
**LOC**: ~500
**Commit**: "feat(auth): Add server-side auth with OAuth state and refresh tokens"

### PR2: calendar-backend-core (base: PR1)
**Scope**: Calendar data layer + Google API client
**Files**:
- backend/app/calendar/db.py (245)
- backend/app/calendar/constants.py (17)
- backend/app/calendar/gcal.py (230)
**LOC**: ~492
**Commit**: "feat(calendar): Add calendar database and Google API client"

### PR3: calendar-backend-sync (base: PR2)
**Scope**: Sync engine + API endpoints
**Files**:
- backend/app/calendar/helpers.py (242)
- backend/app/routers/calendar.py (293)
- backend/app/core/exceptions.py (updates)
- backend/app/main.py (register router)
**LOC**: ~490
**Commit**: "feat(calendar): Add sync engine and API endpoints"

### PR4: frontend-storage (base: PR3)
**Scope**: IndexedDB + recurring event utilities
**Files**:
- frontend/src/lib/db.ts (322)
- frontend/src/lib/recurrence.ts (231)
- frontend/src/lib/eventDisplay.ts (updates)
**LOC**: ~493
**Commit**: "feat(frontend): Add IndexedDB and recurrence utilities"

### PR5: frontend-realtime (base: PR4)
**Scope**: State management + SSE hooks
**Files**:
- frontend/src/stores/sync.store.ts (71)
- frontend/src/stores/accounts.store.ts (72)
- frontend/src/stores/calendars.store.ts (100)
- frontend/src/hooks/useEventsLive.ts (68)
- frontend/src/hooks/useGoogleCalendars.ts (96)
**LOC**: ~407
**Commit**: "feat(frontend): Add sync stores and SSE hooks"

### PR6: calendar-sync-hook (base: PR5)
**Scope**: Sync orchestration
**Files**:
- frontend/src/hooks/useCalendarSync.ts (335)
**LOC**: ~335

### PR7: calendar-ui (base: PR6)
**Scope**: UI components
**Files**:
- frontend/src/components/calendar/CalendarVisibilityPanel.tsx (216)
- frontend/src/components/calendar/CalendarSkeleton.tsx (129)
- frontend/src/components/calendar/SyncButton.tsx (32)
- frontend/src/components/calendar/EventSkeleton.tsx (17)
- Updates to views (~50)
**LOC**: ~444

### PR8: todo-refactor (base: PR7)
**Scope**: Todo components
**Files**:
- frontend/src/components/todo/* (all new components)
**LOC**: ~465

### PR9: chat-feature (base: PR8) - NO MERGE
**Scope**: Chat (reference only)
**Files**:
- backend/app/chat/*
- backend/app/routers/chat.py
**LOC**: ~900

## Execution Steps with Graphite

### Step 0: Install Graphite
```bash
# Install Graphite CLI
brew install withgraphite/tap/graphite

# Or via npm
npm install -g @withgraphite/graphite-cli@stable

# Authenticate
gt auth --token <your-github-token>

# Initialize in repo
cd /Users/prasanthdendukuri/Desktop/chronos-calendar
gt repo init
```

### Step 1: Setup fetch-events
```bash
# Commit uncommitted changes
git checkout fetch-events
git add backend/app/calendar/helpers.py backend/app/routers/auth.py \
        frontend/src/pages/AuthCallback.tsx frontend/vite.config.ts
git commit -m "fix: OAuth state validation and cookie handling"
git push origin fetch-events
```

### Step 2: Create stack with Graphite

```bash
# Start from main
git checkout main
git pull

# PR1: auth-stack
gt branch create auth-stack -m "feat(auth): Add server-side auth with OAuth state and refresh tokens"
# Cherry-pick auth files from fetch-events
git checkout fetch-events -- backend/app/routers/auth.py backend/app/core/encryption.py \
  backend/app/core/db_utils.py backend/app/core/dependencies.py backend/app/config.py \
  frontend/src/contexts/AuthContext.tsx frontend/src/pages/AuthCallback.tsx \
  frontend/vite.config.ts frontend/src/lib/crypto.ts frontend/src/types/auth.ts
git add .
git commit --amend --no-edit
gt stack submit  # Creates PR

# PR2: calendar-backend-core (stacks on PR1)
gt branch create calendar-backend-core -m "feat(calendar): Add calendar database and Google API client"
git checkout fetch-events -- backend/app/calendar/db.py backend/app/calendar/constants.py backend/app/calendar/gcal.py
git add .
git commit --amend --no-edit
gt stack submit

# PR3: calendar-backend-sync
gt branch create calendar-backend-sync -m "feat(calendar): Add sync engine and API endpoints"
git checkout fetch-events -- backend/app/calendar/helpers.py backend/app/routers/calendar.py backend/app/core/exceptions.py
# Update main.py to register calendar router
git add .
git commit --amend --no-edit
gt stack submit

# PR4: frontend-storage
gt branch create frontend-storage -m "feat(frontend): Add IndexedDB and recurrence utilities"
git checkout fetch-events -- frontend/src/lib/db.ts frontend/src/lib/recurrence.ts frontend/src/lib/eventDisplay.ts
git add .
git commit --amend --no-edit
gt stack submit

# PR5: frontend-realtime
gt branch create frontend-realtime -m "feat(frontend): Add sync stores and SSE hooks"
git checkout fetch-events -- frontend/src/stores/ frontend/src/hooks/useEventsLive.ts frontend/src/hooks/useGoogleCalendars.ts
git add .
git commit --amend --no-edit
gt stack submit

# PR6: calendar-sync-hook
gt branch create calendar-sync-hook -m "feat(frontend): Add calendar sync orchestration hook"
git checkout fetch-events -- frontend/src/hooks/useCalendarSync.ts
git add .
git commit --amend --no-edit
gt stack submit

# PR7: calendar-ui
gt branch create calendar-ui -m "feat(ui): Add calendar visibility and loading states"
git checkout fetch-events -- frontend/src/components/calendar/
git add .
git commit --amend --no-edit
gt stack submit

# PR8: todo-refactor
gt branch create todo-refactor -m "refactor(todo): Split todo sidebar into components"
git checkout fetch-events -- frontend/src/components/todo/
git add .
git commit --amend --no-edit
gt stack submit

# PR9: chat-feature (optional, no merge)
gt branch create chat-feature -m "feat(chat): Add chat and embeddings support [DO NOT MERGE]"
git checkout fetch-events -- backend/app/chat/ backend/app/routers/chat.py backend/app/core/cerebras.py
git add .
git commit --amend --no-edit
gt stack submit --draft  # Submit as draft
```

### Step 3: Merge PRs with Graphite auto-sync

When a PR is approved and merged:
```bash
# Graphite automatically updates dependent PRs!
# Just merge on GitHub, then locally:
gt repo sync

# View stack status
gt stack
```

**How Graphite handles parent PR changes**:

Scenario: You make changes to PR1 after creating PR2-PR9.

**Without Graphite**:
```
1. Update PR1 with new commits
2. Manually rebase PR2 onto updated PR1
3. Force push PR2
4. Manually rebase PR3 onto updated PR2
5. Force push PR3
... repeat for all downstream PRs (painful!)
```

**With Graphite**:
```
1. Update PR1 with new commits
2. Run: gt stack restack
   → Graphite automatically rebases PR2-PR9
   → All PRs get updated
3. Run: gt stack submit
   → Push all changes
```

**Benefits**:
- No manual rebasing
- One command to sync entire stack
- Automatic sync when PRs merge
- Clean linear history
- Safe - Graphite handles conflicts

## Verification

Backend PRs (1-3):
```bash
cd backend && ./venv/bin/python -m pytest testing -v
```

Frontend PRs (4-8):
```bash
cd frontend && npm test
```

End-to-end (after PR7):
1. Login
2. Sync calendars
3. Verify events load
4. Check SSE real-time updates