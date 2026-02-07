- dont write commments unless the code is so sophisticated that a user cnat understand without it
- when writing frontend code always read /Users/prasanthdendukuri/Desktop/chronos-calendar/effects.md
- project documentation lives in /Users/prasanthdendukuri/Desktop/chronos-calendar/docs/
- focus on maintanability, security, and idiomatic code without ever "hacking" at solutions that have code smells
- all configuration must come from environment variables, never hardcode or derive config values from other config — if it needs to be configurable, make it a flat env var
- stop writing code in plan mode, it should be conceptual
- dont do overly defensive programming, especially if its secure or trusted routes that are determinsitic
- dont do imports rnadomly, they must always be at the top
- whenver i mention "v1" it means the project named "chronos"
- for supabase queries make them multi line so its readable
- dont include code in plans
- commit messages should be short single-line summaries, put details in PR descriptions not commits
- dont add Co-Authored-By lines to commits, stop adding claude as a coauthor
- never commit or push unless explicitly asked to
- never amend commits, always create new commits
- never post review comments on PRs or github issues, dont comment on github at all

## Running tests

Backend:
```bash
cd backend && ./venv/bin/python -m pytest testing -v
```

Frontend:
```bash
cd frontend && npm test
```

## /reset command

When user says "reset", "clear everything", or "/reset":
1. Clear Supabase tables via SQL (ORDER MATTERS for foreign keys):
   ```sql
   DELETE FROM calendar_sync_state;
   DELETE FROM events;
   DELETE FROM todos;
   DELETE FROM todo_lists;
   DELETE FROM google_calendars;
   ```
2. Clear browser via JavaScript:
   - `indexedDB.deleteDatabase('chronos')`
   - `localStorage.clear()`
   - `sessionStorage.clear()`
3. Call logout API: `fetch('http://localhost:8000/auth/logout', { method: 'POST', credentials: 'include' })`
4. Navigate to /login page