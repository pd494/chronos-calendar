---
name: clear-supabase
description: Clear or reset Chronos Supabase data through the Supabase MCP. Use when the user asks to clear, reset, wipe, or drop rows or reset  `chronos`, 
---

# Clear Supabase

Use MCP directly. Do not stop at planning.

## Workflow

1. Resolve the target project.
2. Inspect the current tables in `public`, `auth`, and `storage`.
3. Delete rows from every table.

## Project

Assume `chronos` unless the user explicitly names another project.

For `chronos`, the Supabase project id is `onqttjrakbozonxjinev`.

If there is any ambiguity, call `mcp__supabase__list_projects` first and confirm the target project before mutating anything.

## Constraints

- The MCP SQL connection runs as `postgres`.
- `public` tables are owned by `postgres` and can be dropped with `mcp__supabase__apply_migration`.
- `auth` tables are owned by `supabase_auth_admin` and cannot be dropped through this MCP connection.
- `storage` tables are owned by `supabase_storage_admin` and cannot be dropped through this MCP connection.
- Direct SQL deletes from `storage` metadata tables are blocked by Supabase. Do not try to clear `storage` with raw SQL.
- Use multi-line SQL for Supabase queries.

## Auth Wipe

Use `mcp__supabase__execute_sql` to delete rows from all public tables, but keep the tables intact.


