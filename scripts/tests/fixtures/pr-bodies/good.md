## Objective
Fix the widget.

## Tests

| Gate | Ran? | Result |
| --- | --- | --- |
| fast — `./boga test fast` (lint/typecheck/jest + backend smoke) | ✅ | jest 92/92 green, lint clean |
| slow frontend — `./boga test frontend` (Maestro smoke/data-smoke/auth-profile/sync-e2e) | ⛔ | N/A — no UI change (trigger table, spec 02) |
| slow backend — `./boga test backend` (auth/RLS + sync-v2 + sync-infra) | ⛔ | N/A — no supabase/** or sync change (trigger table, spec 02) |
| iOS sync e2e — `./boga test ios-sync-e2e` (UI↔server) | ⛔ | N/A — no sync/scheduler/auth-session change |

## Review hard
- Nothing risky.
