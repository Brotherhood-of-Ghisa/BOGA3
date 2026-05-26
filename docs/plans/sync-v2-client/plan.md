# Plan: Sync v2 — Client (stub)

> **Stub.** Re-invoke the multi-agent-orchestration skill with
> `create multi-agent-orchestration-plan for sync-v2-client at this path`
> to flesh out. This file is the seed: Goal, Outcomes, sketch DAG, sketch
> task list. No `tasks/` subfolder yet.
>
> **Depends on plan 1 (`docs/plans/sync-v2-server/`) being merged** so the
> client engine has a live `sync_push` / `sync_pull` to integrate against.

## Goal

Rebuild the client side of sync from a clean slate to match the v2
design. Delete every file under `apps/mobile/src/sync/`
(`engine.ts`, `outbox.ts`, `bootstrap.ts`, `runtime.ts`, `scheduler.ts`,
`profile-status.ts`, `types.ts`, `index.ts` — survey before deleting in
case files have been added since this plan was authored) along with the
v1 outbox / event-types / sequence-counter code paths. Add the two
local-only sync columns (`local_dirty`, `local_updated_at_ms`) to every
entity Drizzle schema, the `sync_runtime_state` singleton (with
`pull_cursor`, `last_emitted_ms`, `bootstrap_completed_at`), the
`nowMonotonic()` clock helper, the new cycle/scheduler implementation per
t2 §6 and t4, and wire every repo write path to flip the dirty bit. Drop
the local DB on first v2 launch behind a one-shot version marker.

## Outcomes

When this plan is done, all of these are true:

- All v1 sync source files under `apps/mobile/src/sync/` are deleted; no
  symbol from `engine.ts`, `outbox.ts`, or the v1 event types is
  referenced anywhere in `apps/mobile/src/`.
- Every entity Drizzle schema (`gyms.ts`, `sessions.ts`,
  `session-exercises.ts`, `exercise-sets.ts`, `exercise-definitions.ts`,
  `exercise-muscle-mappings.ts`, `exercise-tag-definitions.ts`,
  `session-exercise-tags.ts`) declares two new local-only columns —
  `localDirty: integer('local_dirty', {mode: 'boolean'})` default 0,
  `localUpdatedAtMs: integer('local_updated_at_ms')` default 0 — per t2
  §9.1. The drift checker (plan 1's t2) passes against the new
  registration in `apps/mobile/src/data/schema/sync-extras.json`.
- Every entity schema that didn't already have one gains `deletedAt:
  integer('deleted_at', {mode: 'timestamp_ms'})` per t1 §4.2 (gyms,
  session-exercises, exercise-sets, exercise-muscle-mappings,
  session-exercise-tags).
- The `sync_runtime_state` Drizzle table is rewritten with the columns
  `pull_cursor` (text holding JSON, default `'{}'`), `last_emitted_ms`
  (integer default 0), `bootstrap_completed_at` (integer timestamp_ms
  nullable). v1 columns on this table are dropped. Per t3 §8.2 #3, the
  legacy `seedsAppliedAt` is replaced by
  `applied_seed_migration_app_version` (integer default 0).
- A one-shot version-marker check on app launch detects "v2 boot, local
  DB still on v1 shape" and wipes the local DB (drop + recreate via
  Drizzle migration tree). The marker prevents the wipe from re-running.
- `apps/mobile/src/data/clock.ts` exports `nowMonotonic()` per t2 §8 —
  `max(Date.now(), last_emitted_ms + 1)` — backed by
  `sync_runtime_state.last_emitted_ms` with **synchronous persist in the
  same SQLite transaction** as any entity write that called it (per t2
  §8.3). All repo write paths import and use it.
- Every entity repo's create / update / softDelete / cascade path flips
  `local_dirty = 1` and `local_updated_at_ms = nowMonotonic()` inside
  the same transaction as the data write per t2 §7.2.
- A new `apps/mobile/src/sync/cycle.ts` implements the t2 §6 cycle —
  pull → push → re-pull, layered per t2 §4.4 on the pull side and per
  t2 §3.4 on the push side, drain-to-empty, per-batch commits,
  idempotent on re-run. Push-in-flight race handled per t2 §7.3.
- A new `apps/mobile/src/sync/scheduler.ts` implements the t4 4-state
  machine (OFFLINE / LONG_TIMEOUT / SHORT_TIMEOUT / RUNNING) with
  `SHORT_INTERVAL = 1000ms`, `LONG_INTERVAL = 60_000ms`, NetInfo as the
  sole authority on `online` state. Single `requestSync()` entry point,
  no `reason` parameter. AppState listener routes
  `background → active` to `requestSync()`.
- A background-task path registered via `expo-background-task` wrapping
  iOS `BGAppRefreshTask` runs one cycle outside the four-state machine
  per t4 §4. The Expo config plugin block lands in
  `apps/mobile/app.config.ts` (or wherever app config lives) per t4's
  registration spec.
- Dev-only wipe affordances behind `isDevMode()` (NOT `__DEV__` — per
  the user's memory in this repo) — `wipe-local` resets the local DB
  and re-bootstraps; `wipe-remote-for-me` calls a service-role helper
  RPC (existing or to-be-added).
- Final test card asserts: client compiles; drift checker passes; dirty
  bit flips on every repo write path (one test per entity); scheduler
  debounce + safety-tick behaviour matches t4 §2.2 / §2.3 transition
  tables cell-by-cell; cycle round-trips against the plan-1 server
  (deployed to a Supabase branch); `nowMonotonic()` is monotone across
  app restarts.

## Sketch DAG

```mermaid
graph TD
  t1[t1: delete v1 sync code + v1 schema columns]
  t2[t2: Drizzle schema additions — local-only cols, deleted_at, sync_runtime_state rewrite]
  t3[t3: local-DB-wipe-on-v2-boot version marker]
  t4[t4: nowMonotonic clock helper]
  t5[t5: repo write-path dirty-bit wiring]
  t6[t6: cycle implementation per t2 §6]
  t7[t7: scheduler implementation per t4 4-state machine]
  t8[t8: background-task registration via expo-background-task]
  t9[t9: dev-only wipe affordances behind isDevMode()]
  tFINAL[tFINAL: client end-to-end verification]

  t1 --> t2
  t2 --> t3
  t2 --> t4
  t4 --> t5
  t5 --> t6
  t2 --> t6
  t6 --> t7
  t7 --> t8
  t6 --> t9
  t3 --> tFINAL
  t8 --> tFINAL
  t9 --> tFINAL
```

The mao-planner re-dispatch should size each node against the
~2000-line budget and split if needed (t5 in particular — wiring eight
repos to use `nowMonotonic()` plus the dirty bit may exceed the budget
and likely splits per-repo or per-layer).

## Sketch task list

- t1: delete v1 sync code paths (`engine.ts`, `outbox.ts`,
  `bootstrap.ts`, `runtime.ts`, `scheduler.ts`, `profile-status.ts`,
  `types.ts`, `index.ts`; v1 outbox table; v1 event-type definitions;
  sequence counters; v1 batch envelopes) — deletion-heavy
- t2: Drizzle schema additions (`local_dirty`, `local_updated_at_ms`
  on every entity; `deleted_at` where missing; rewrite
  `sync_runtime_state` with t2 §9.2–§9.3 columns; drop legacy
  `seedsAppliedAt`)
- t3: local-DB-wipe-on-v2-boot version marker (one-shot, gated by
  marker so it never re-runs; marker stored outside the wiped tables,
  likely `expo-secure-store` or a small AsyncStorage flag)
- t4: `nowMonotonic()` clock helper in
  `apps/mobile/src/data/clock.ts` with synchronous-persist contract
  per t2 §8.3
- t5: repo write-path dirty-bit wiring — every create / update /
  softDelete / cascade across the eight entity repos flips
  `local_dirty = 1` and `local_updated_at_ms = nowMonotonic()` in the
  same transaction. **The mao-planner should split this** if it
  exceeds the ~2000-line budget (likely by entity or by repo layer).
- t6: cycle implementation per t2 §6 — pull → push → re-pull, layered
  drain on pull (per-layer cursor in `sync_runtime_state.pull_cursor`),
  `selectPushBatch` batching per t2 §3.4.2, push-in-flight race
  handler per t2 §7.3
- t7: scheduler implementation per t4 — 4-state machine, NetInfo
  subscription, single `requestSync()` entry, AppState listener for
  the foreground edge
- t8: background-task registration — `expo-background-task` wrapper +
  Expo plugin block / Info.plist for `BGAppRefreshTask`
- t9: dev-only wipe affordances behind `isDevMode()`
- tFINAL: client end-to-end verification — client compiles; drift
  checker passes; per-repo dirty-bit tests; scheduler state-table
  tests; cycle round-trips against plan-1 server (deployed to a
  Supabase branch); `nowMonotonic()` monotone across restarts

## Notes for the planner re-dispatch

- The full t2 design at `docs/plans/sync-v2/designs/t2.md` is
  authoritative for every wire-level detail. Cite by section number
  (e.g. "per t2 §7.3").
- The full t4 design at `docs/plans/sync-v2/designs/t4.md` is
  authoritative for the scheduler shape. The 4-state machine is in t4
  §2; the BG-task path is in t4 §4.
- Apply the user's `isDevMode()` rule (not `__DEV__`) — see the
  feedback memory referenced from this repo's user-memory file.
- t5 is the size-risk task — likely splits.
- Plan 2 ships against an empty/wiped local DB (t3 above) and a
  fully-deployed plan-1 server. Plan-3 (`docs/plans/sync-v2-launch/`)
  adds login enforcement, the sync gate, seed reorder, and the
  settings sync surface on top.

## Carry-over from plan 1 (sync-v2-server, merged 2026-05-26)

The planner re-dispatch must treat the following as as-built facts (not
restate them — link `docs/plans/sync-v2-server/plan.md ## Deviations log`
where load-bearing):

1. **Layer→type partition (corrected)**: Layer 0 = `gyms`,
   `exercise_definitions`; Layer 1 = `sessions`,
   `exercise_muscle_mappings`, `exercise_tag_definitions`; Layer 2 =
   `session_exercises`; Layer 3 = `exercise_sets`,
   `session_exercise_tags`. The cycle in t6 walks these in order; the
   per-layer pull cursors in `sync_runtime_state.pull_cursor` index by
   this partition. **Do NOT use the original t1 §7.7 example mapping**
   (it puts `exercise_tag_definitions` in Layer 0 and is structurally
   impossible — see the design's build-wave correction). The as-built
   `apps/mobile/src/sync/topo-order.ts` is authoritative.

2. **`gyms` columns include the M15 carry-over**: `latitude`,
   `longitude`, `coordinate_accuracy_m`, `coordinates_updated_at` are
   part of the v2 `gyms` table (and the client schema already declares
   them). Any push/pull serialisation for `gyms` must include all four
   in `fields`. The push and pull RPCs already do.

3. **RPC signatures and grants**:
   - `app_public.sync_push(entities jsonb default '[]'::jsonb)` —
     named param. Client POSTs `{"entities": [...]}` to
     `/rest/v1/rpc/sync_push`.
   - `app_public.sync_pull(jsonb)` — UNNAMED param. Client POSTs
     `{"layer": N, "cursor": ..., "limit": ...}` to
     `/rest/v1/rpc/sync_pull`.
   - Both are `security invoker` and granted `execute` to
     `authenticated` AND `anon`. The `auth.uid() IS NULL` guard is the
     first statement so an unauthenticated client receives the
     structured `AUTH_REQUIRED` envelope per t2 §2.2 instead of a raw
     PostgREST 42501. The cycle must treat AUTH_REQUIRED as a normal
     error envelope (no-op the cycle, surface to scheduler), NOT as a
     network-level failure.

4. **`sync-extras.json` `server_only_columns` exemption registers
   `deleted_at`**: plan 1's t2 added this exemption because the
   server's `deleted_at` columns exist while the client's were
   intentionally deferred to plan 2. When this plan's t2 (Drizzle
   schema additions) adds the local `deletedAt` columns to the entity
   schemas that lacked them (`gyms`, `session-exercises`,
   `exercise-sets`, `exercise-muscle-mappings`, `session-exercise-tags`),
   the planner must **remove the `server_only_columns` exemption** for
   `deleted_at` in the same PR — leaving it in place would mask future
   regressions of legitimate columns. Re-run the drift checker after
   the removal to confirm it still passes.

5. **`apps/mobile/src/sync/topo-order.ts` already exists on `main`**
   (shipped by plan 1's t2). Plan 2's t6/t7 (cycle, scheduler) IMPORT
   this file; they do NOT redefine the layers. Layer order changes —
   if any — go via a fresh PR that updates the file in lock-step with
   the FK graph; the drift checker enforces consistency.

6. **`local_dirty` / `local_updated_at_ms` exemptions are
   pre-registered**: plan 1 registered both names in
   `sync-extras.json` `local_only_columns` even though the columns
   don't yet exist on the client. When plan 2's t2 adds the columns
   to the Drizzle schemas, the registration just resolves to a no-op
   — no churn needed in `sync-extras.json` for that pair.

7. **Drift-checker tool versions**: the checker uses
   `better-sqlite3@^12.10.0`, `pg@^8.21.0`, `tsx@^4.22.3`. Plan 2's
   t2 (schema additions) should re-run `npm run check:sync-drift --
   --strict` after each schema change to verify the exemption removal
   above doesn't flag a real drift.

## Deviations log

<empty until re-dispatch>
