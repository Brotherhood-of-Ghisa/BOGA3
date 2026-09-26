## Objective
Restyle a card.

## Tests

| Gate | Ran? | Result |
| --- | --- | --- |
| fast — `./boga test fast` (lint/typecheck/jest + backend smoke) | ✅ | jest 92/92 green, lint clean |
| slow frontend — `./boga test frontend` (all iOS lanes) | ✅ | 8/8 lanes green |
| slow frontend UI tier — `./boga test frontend-ui` (backend-free iOS lanes) | ✅ | 5/5 lanes green |
| slow backend — `./boga test backend` (auth/RLS + sync-v2 + sync-infra) | ⛔ | N/A — no supabase/** or sync change (trigger table, spec 02) |
| iOS sync e2e — `./boga test ios-sync-e2e` (UI↔server) | ⛔ | N/A — no sync/scheduler/auth-session change |

## Review hard
- Nothing risky.
