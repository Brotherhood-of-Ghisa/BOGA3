# Sync v2 client — end-to-end verification suite

This directory holds the final verification suite for the rebuilt client sync
stack. Each plan-level outcome maps to at least one asserting test here, so a
regression that silently breaks the client sync semantics fails loudly rather
than slipping through. Run the whole suite as a focused lane with:

```
npm run test:sync-v2-final
```

Two of these files exercise a **live** Postgres + PostgREST + RLS endpoint and
read its URL and anon key from `SUPABASE_BRANCH_URL` /
`SUPABASE_BRANCH_ANON_KEY`. When those are unset the two files skip with a clear
message, so the suite stays green in CI where no endpoint is wired. To run them
locally, point those env vars at a deployed Supabase endpoint carrying the sync
server schema and provision the `user_a` auth fixture, then run the lane above
with the vars exported.

## Outcome → test mapping

Each row below restates a plan outcome in plain prose (no plan/card identifiers,
since these files outlive the plan) and names the file that asserts it.

| Plan outcome (prose) | Asserting file |
| --- | --- |
| The previous-generation sync source files are deleted and none of their exported call-site symbols survives anywhere in the app source; the scheduler that ships under the old `scheduler.ts` path is the new four-state machine, not the old engine. | `v1-deletions.test.ts` |
| Every entity Drizzle schema carries the two local-only sync columns and the five schemas that lacked one gain the soft-delete column; the schema-drift checker passes under `--strict`, and the server-only exemption that masked the soft-delete column is removed. | `drift-check.test.ts` |
| Every repo create / update / soft-delete path flips the dirty bit and stamps the monotonic timestamp inside the same transaction as the data write — one check per entity table (eight), including the sibling-reorder case that must dirty both rows. | `dirty-bit-per-entity.test.ts` |
| The foreground scheduler is a total four-state machine walking its external-input and internal-event transition tables cell-by-cell, with network reachability as the sole authority on online/offline (>= 20 cells). | `scheduler-state-table.test.ts` |
| The full sync cycle converges local and server state over a real push → server last-write-wins → pull → local last-write-wins loop: the dirty chain pushes and clears, a wiped client re-pulls everything via the layered drain with advancing per-layer cursors, a no-op re-run moves nothing, and a mid-push in-flight edit keeps that row dirty. | `cycle-round-trip.test.ts` (live endpoint) |
| A missing JWT is a clean error envelope, not a crash: the cycle returns without throwing, dirty bits stay set, and no local row is mutated. | `auth-required-envelope.test.ts` (live endpoint) |
| The monotonic clock helper is strictly increasing, including across a simulated cold start where the next value continues above the persisted high-water mark rather than resetting to the wall clock. | `now-monotonic-cross-restart.test.ts` |
| The one-time local-database wipe is a documented human runbook covering every platform (iOS Simulator, Android Emulator, physical device, TestFlight), and no in-app boot-marker / version-marker auto-wipe module was re-introduced under the data layer. | `manual-wipe-doc-exists.test.ts` |
| The developer-only wipe affordances are gated on the cross-build dev signal (not the metro-only global): hidden when the signal is false, shown when true, and the Settings screen and wipe helper carry no bare metro-only runtime guard. | `dev-affordances-gate.test.tsx` |
| The background-sync task identifier agrees across the handler registration, the schedule registration, and the identifier the Expo plugin writes into the generated plist, and the plugin stays wired in the Expo config. | `bg-task-identifier-match.test.ts` |
| The FK layer partition has a single source of truth: the cycle and scheduler import it and never re-declare or inline a layer array. | `topo-order-imported.test.ts` |
| The quality-gate commands (lint, typecheck, test) are real package scripts, the unit test script is bare jest with no `--forceExit` masking, and the runtime migration wrapper carries no inlined SQL drift. | `all-gates.test.ts` |

## Shared helpers

- `../helpers/in-memory-db.ts` — the shared in-memory SQLite fixture (full
  migrated schema from the generated bundle). Reused, never duplicated.
- `helpers/live-branch.ts` — reads the live-endpoint config from the
  environment, loads the real Supabase client (bypassing the global inert mock),
  and mints a test-user JWT. Clients open no auth-refresh timer, so the
  open-handle guard stays clean.
