# Plan: Sync v2 — Client

## Goal

Rebuild the client side of sync from a clean slate to match the v2 design
(`docs/plans/sync-v2/designs/{t2,t4}.md`) against the already-merged plan-1
server. Delete the entire v1 client stack under `apps/mobile/src/sync/`
(`engine.ts`, `outbox.ts`, `bootstrap.ts`, `runtime.ts`, `scheduler.ts`,
`profile-status.ts`, `types.ts`, `index.ts`) plus the v1 `sync_outbox_events` /
`sync_delivery_state` tables and the `enqueueSyncEvent` call paths in every
repo. In their place add: two local-only sync columns (`local_dirty`,
`local_updated_at_ms`) on every entity Drizzle schema; a `deleted_at` column
on the five entity schemas that lack one; a rewritten `sync_runtime_state`
singleton (`pull_cursor`, `last_emitted_ms`, `bootstrap_completed_at`,
`applied_seed_migration_app_version`); the `nowMonotonic()` clock helper
from t2 §8 with the synchronous-persist contract from t2 §8.3; repo
write-path wiring that flips the dirty bit in the same transaction as every
entity write; a new `apps/mobile/src/sync/cycle.ts` implementing t2 §6
(pull → push → re-pull, layered drain per t2 §4.4, batched per t2 §3.4); a
new `apps/mobile/src/sync/scheduler.ts` implementing the t4 §2 four-state
machine (OFFLINE / LONG_TIMEOUT / SHORT_TIMEOUT / RUNNING) with NetInfo as
the sole authority on online state; a background-task path via
`expo-background-task` per t4 §4; and dev-only wipe affordances behind
`isDevMode()`. Plan 2 **assumes a clean local DB on first v2 launch** —
devs, TestFlight testers, and (eventually) production users perform a
one-time manual wipe per `docs/plans/sync-v2-client/manual-wipe.md` (t3
ships the doc; no in-app marker or auto-wipe code exists). Plan 2 ships
against this clean local DB and the fully-deployed plan-1 server. Plan 3
(`docs/plans/sync-v2-launch/`) adds login enforcement, the sync gate, seed
reorder, and the settings sync surface on top.

## Outcomes

When this plan is done end-to-end, all of these are true:

- All v1 sync source files under `apps/mobile/src/sync/` are deleted —
  `engine.ts`, `outbox.ts`, `bootstrap.ts`, `runtime.ts`, `scheduler.ts`,
  `profile-status.ts`, `types.ts`, the v1 surface of `index.ts`. The
  `apps/mobile/src/sync/topo-order.ts` file that plan 1 shipped remains
  untouched. No symbol from the deleted files (`enqueueSyncEvent`,
  `enqueueSyncEvents`, `enqueueSyncEventsTx`, `flushSyncOutbox`,
  `startDefaultSyncScheduler`, `setDefaultSyncCadenceContextFromPathname`,
  `setSyncNetworkOnline`, `recordSyncTransportFailure`, the
  `SyncEventEnvelope` / `SyncIngestRequest` types, etc.) is referenced
  anywhere under `apps/mobile/src/` or `apps/mobile/app/`. The v1 Drizzle
  tables `sync_outbox_events` and `sync_delivery_state` are dropped via a
  new local migration. The `sync_outbox_events` `enum` of v1 event types
  (`upsert / delete / attach / detach / reorder / complete`) and the
  `SYNC_BACKOFF_*` constants no longer exist anywhere in the tree.
- Every entity Drizzle schema (`gyms.ts`, `sessions.ts`,
  `session-exercises.ts`, `exercise-sets.ts`, `exercise-definitions.ts`,
  `exercise-muscle-mappings.ts`, `exercise-tag-definitions.ts`,
  `session-exercise-tags.ts`) declares two new local-only columns —
  `localDirty: integer('local_dirty', { mode: 'boolean' })` default `0` and
  `localUpdatedAtMs: integer('local_updated_at_ms')` default `0` — per t2
  §9.1, with the snake_case / camelCase naming from t2 §9.1 final
  paragraph. `npm run check:sync-drift -- --strict` exits zero against
  the new schemas.
- The five entity schemas that did not previously have one
  (`gyms.ts`, `session-exercises.ts`, `exercise-sets.ts`,
  `exercise-muscle-mappings.ts`, `session-exercise-tags.ts`) gain a
  `deletedAt: integer('deleted_at', { mode: 'timestamp_ms' })` column
  (nullable, no default) and a `deletedAtIdx` index per t1 §2 / §4.2.
  Drift-checker's `server_only_columns` exemption for `deleted_at` is
  removed from `apps/mobile/src/data/schema/sync-extras.json` in the same
  PR — leaving the exemption in place would mask future legitimate-column
  regressions — and the drift checker still exits zero after the
  removal.
- The `sync_runtime_state` Drizzle table carries the v2-canonical
  columns: `pullCursor: text('pull_cursor', { mode: 'json' })` default
  `'{}'` (a JSON object keyed by layer index `"0".."3"` per t2 §9.2),
  `lastEmittedMs: integer('last_emitted_ms')` default `0` per t2 §8 /
  §9.3, `bootstrapCompletedAt: integer('bootstrap_completed_at', { mode:
  'timestamp_ms' })` nullable (preserved), and
  `appliedSeedMigrationAppVersion: integer('applied_seed_migration_app_version')`
  default `0` (replaces v1's `seedsAppliedAt` per the stub Outcomes
  note — driven by app version, not wall-clock). The v1-only columns
  (`is_enabled`, `bootstrap_user_id`, `last_bootstrap_error`,
  `last_bootstrap_attempt_at`, `seeds_applied_at`) are dropped — the
  manual wipe means no v1 row data needs preservation, so the
  migration may drop and recreate `sync_runtime_state` in its v2
  shape (or use Drizzle's standard 12-step swap if the tooling
  prefers it). `exercise-catalog-seeds.ts`'s seed marker reads /
  writes are migrated to the new column.
- Manual wipe procedure is documented at
  `docs/plans/sync-v2-client/manual-wipe.md`, covering iOS Simulator
  (Xcode → Device → Erase All Content and Settings, OR delete the
  app from the home screen), Android Emulator (Settings → Apps →
  Clear Storage, OR AVD Manager wipe), physical devices
  (uninstall + reinstall on both iOS and Android), and TestFlight
  (delete the v1 build before installing the v2 build; do NOT
  update in place). **No in-app version marker or auto-wipe code
  exists.** The v2 build assumes a clean local DB; if v1 data is
  present, behaviour is undefined and the user must wipe per the
  documented procedure. A cross-link from `apps/mobile/README.md`
  (or the closest equivalent dev-onboarding doc, builder's choice
  surfaced in the PR body) points devs and reviewers at the
  manual-wipe doc.
- `apps/mobile/src/data/clock.ts` exports `nowMonotonic(): number`
  computing `Math.max(Date.now(), last_emitted_ms + 1)` per t2 §8.
  Persistence is **synchronous within the same SQLite transaction** as
  the entity write that produced the value (t2 §8.3) — fire-and-forget
  is forbidden. A module-scoped in-memory cache mirrors the persisted
  value per t2 §8.4; cold start reads from SQLite. The helper is the
  single source of monotonic time across the app (no parallel
  helpers); the existing session-recorder and seed-loader timestamp
  call sites either migrate to it or remain on `Date.now()` only where
  they do not bump entity `local_updated_at_ms`.
- Every entity repo's create / update / softDelete / cascade path
  flips `local_dirty = 1` and `local_updated_at_ms = nowMonotonic()`
  inside the same Drizzle transaction as the data write, per t2 §7.2.
  The seven repo files under `apps/mobile/src/data/` (`local-gyms.ts`,
  `session-drafts.ts`, `session-list.ts`, `exercise-catalog.ts`,
  `exercise-catalog-seeds.ts`, `exercise-tags.ts`, `exercise-history.ts`)
  all route their writes through the new contract. No repo path
  produces an entity write that leaves `local_dirty = 0`.
- A new `apps/mobile/src/sync/cycle.ts` implements the t2 §6 cycle —
  pull → push → re-pull, layered per t2 §4.4 on the pull side
  (iterating layers 0→3 from `TOPO_LAYERS` in
  `apps/mobile/src/sync/topo-order.ts`; one cursor per layer in
  `sync_runtime_state.pull_cursor`), per-batch commits per t2 §6.2,
  drain-to-empty per t2 §6.2, idempotent on re-run per t2 §6.2.
  Push-side `selectPushBatch(batchCap = 200)` walks layers in topological
  order per t2 §3.4 and the push-in-flight race is handled per t2 §7.3
  (in-memory `Map<(type, id), sent_at_ms>` snapshot of the batch;
  ack-handler clears `local_dirty` only when `current == sent_at_ms`).
  `AUTH_REQUIRED`, `FK_VIOLATION`, and `INTERNAL` error envelopes from
  t2 §2.2 are handled per the per-code rules there (`AUTH_REQUIRED` is
  a normal cycle error envelope, not a network failure, surfaces to
  the scheduler; `FK_VIOLATION` is non-retriable and dirty bits stay
  set; `INTERNAL` returns to scheduler which arms `LONG_INTERVAL`).
  The wire shape uses the as-built RPC signatures from plan 1's
  Deviations log entries for t3 and t4 (named param `entities` for
  push; unnamed `jsonb` for pull).
- A new `apps/mobile/src/sync/scheduler.ts` implements the t4 §2
  four-state machine (OFFLINE / LONG_TIMEOUT / SHORT_TIMEOUT / RUNNING)
  with `SHORT_INTERVAL = 1000ms` and `LONG_INTERVAL = 60_000ms` per t4
  §2.6, the §2.2 external-input transition table cell-for-cell, the
  §2.3 internal-transition table cell-for-cell, NetInfo as the **sole**
  authority on `go online` / `go offline` per t4 §3.4, and a single
  `requestSync()` entry point with no `reason` parameter per t4 §2.5.
  An `AppState` listener at the sync layer emits `requestSync()` on
  `background → active` only (no-ops on `inactive` transitions and on
  `active → background`) per t4 §1.1.
- A background-task path registered via `expo-background-task` (`@react-native-community/netinfo`,
  `expo-task-manager`, `expo-network` installed alongside) wraps iOS
  `BGAppRefreshTask` per t4 §4. The task body does a one-shot
  `expo-network.getNetworkStateAsync()` pre-flight then runs **one
  cycle directly**, bypassing the four-state machine per t4 §4.4.
  Registration via `BackgroundTask.registerTaskAsync` runs once at app
  init with `minimumInterval: 15` per t4 §4.4. The
  `apps/mobile/app.config.ts` plugins array gains the
  `"expo-background-task"` entry per t4 §4.5. The
  `BGTaskSchedulerPermittedIdentifiers` identifier in
  `TaskManager.defineTask` matches the identifier the plugin writes
  into `Info.plist` (the most common failure mode per t4 §4.5).
- Dev-only wipe affordances behind `isDevMode()` (NOT `__DEV__` per
  `apps/mobile/src/utils/isDevMode.ts`) — a `wipe-local` button that
  resets the local DB and re-bootstraps; a `wipe-remote-for-me` button
  that calls a service-role helper RPC to delete every row owned by
  the current user. Both gated by `isDevMode()` and surfaced on the
  existing Settings screen at `apps/mobile/app/(tabs)/settings.tsx`'s
  dev block.
- The final test card asserts each outcome above with an automated
  test. Specifically: the client compiles (`npm run typecheck` clean);
  `npm run check:sync-drift -- --strict` exits zero; one Jest test per
  entity (8 tests) confirms every repo create / update / softDelete
  path flips the dirty bit and bumps `local_updated_at_ms` inside the
  write transaction; one Jest test per cell of the t4 §2.2 / §2.3
  transition tables (≥ 20 cells) confirms the scheduler walks them
  cell-by-cell; an end-to-end Jest cycle test round-trips against the
  plan-1 server deployed to a Supabase branch (push → server LWW →
  pull → local LWW); a test confirms `nowMonotonic()` is strictly
  monotone across simulated app restarts (cold-start reads the
  persisted value from `sync_runtime_state.last_emitted_ms`); and a
  test asserts the manual-wipe doc exists with the required
  sections AND that no in-app marker module was silently
  re-introduced under `apps/mobile/src/data/`.

## What is and isn't wired after plan 2

**Wired by plan 2** (mechanical / non-UX):

- `_layout.tsx` calls `startSyncScheduler()` at boot (t7).
- Scheduler invokes the cycle on NetInfo `online`, on `AppState background → active`, and on cold launch via a single `requestSync()` (t7).
- BG-task runs one cycle from iOS `BGAppRefreshTask` (t8).
- Every repo write flips `local_dirty = 1` and `local_updated_at_ms = nowMonotonic()` (t5a + t5b).
- Dev-only `wipe-local` and `wipe-remote-for-me` affordances live behind `isDevMode()` on the existing Settings screen (t9).

**Not wired by plan 2** (deferred to plan 3 — `docs/plans/sync-v2-launch/`):

- Login-on-start enforcement / redirect to sign-in (plan 3 t1).
- Sync gate full-screen UI blocking app usage until `bootstrap_completed_at` is non-null (plan 3 t2).
- Settings sync-status surface — last successful sync time, dirty count, error, network state (plan 3 t9). Plan 2's t1 deletes the v1 "Backup sync" card from `profile.tsx`; plan 3 adds the new Settings surface.
- Soft-delete-everywhere — every hard-delete path becomes a soft-delete and readers filter `WHERE deleted_at IS NULL` (plan 3 t7).
- Sign-out / account-switch wipe (plan 3 t8).

After plan 2 alone, the app boots, sync runs in the background, repos mark rows dirty correctly, but the user sees no UX feedback about sync state. The v1 "Backup sync" card is gone (t1 deletes it). Plan 3 lands the new UX surface.

## Orchestration

- Status: enabled
- Plan slug (for PR filtering): `sync-v2-client`
- Plan root: `docs/plans/sync-v2-client/`
- Integration branch: `main`
- Host: `github`
- Host access: `mcp` (fall back to `gh` if MCP is unavailable)
- Quality-gate command (default — all client tasks): `./scripts/quality-fast.sh frontend`
  (runs `npm run lint`, `npm run typecheck`, `npm run test` in
  `apps/mobile/`)
- Quality-gate command (schema tasks t2, tFINAL): `./scripts/quality-fast.sh frontend && (cd apps/mobile && npm run check:sync-drift -- --strict)`
- Quality-gate command (tFINAL only — cycle round-trip): the above
  PLUS a Supabase branch deployment so the e2e cycle test has a real
  `sync_push` / `sync_pull` endpoint to call. The deployment is the
  responsibility of the tFINAL builder via the `supabase` MCP / CLI
  (same pattern plan 1's tFINAL used; see
  `docs/plans/sync-v2-server/tasks/tFINAL.md`).
- Builder concurrency cap: 4
- Reviewer concurrency cap: unbounded
- Deviations from default protocol:
  - **No design tasks.** Earlier drafts of this plan included `d1`
    (version-marker storage) and `d2` (`sync_runtime_state`
    migration approach). Both were dropped in favour of the
    manual-wipe procedure documented in t3 — without an in-app
    marker, d1's storage question is moot, and without v1 data to
    preserve, d2's migration question collapses to "drop and
    recreate, or the standard SQLite 12-step swap, whichever
    Drizzle's tooling produces from the schema diff." See `t2.md`
    `Out of scope` for the migration-mechanics note.
  - **t3 is docs-only.** It ships
    `docs/plans/sync-v2-client/manual-wipe.md` and a cross-link
    from `apps/mobile/README.md` (or equivalent). No app code.
    See t3.md.
  - **t5 is split into t5a (Layer 0/1 repos) and t5b (Layer 2/3
    repos)** to keep each PR under the ~2000-line size budget. Each
    half wires the same dirty-bit contract; the split is by entity
    layer per `apps/mobile/src/sync/topo-order.ts`. t6 (cycle) depends
    on **both halves** being merged.
  - **tFINAL requires a live Supabase branch deployment** for the
    cycle round-trip test, declared in this Orchestration block so it
    is not a surprise. The tFINAL card lists the deployment as an
    explicit precondition. Plan 1's tFINAL used the same pattern.
  - **Sim-smoke per task.** Every task PR — t1, t2, t3, t4, t5a,
    t5b, t6, t7, t8, t9, tFINAL — must assert
    `test:e2e:ios:smoke` and `test:e2e:ios:data-smoke` pass locally
    in addition to the fast gate, per the user's "app must ALWAYS
    be in working state" directive (broader than the per-memory
    rule that only binds UI-touching tasks). The PR body's Standard
    checklist line must read
    `sim-smoke + data-smoke pass: YES (built rev: <git sha>)`. The
    user's `feedback_no_dev_global.md` rule (no `__DEV__` literals)
    still applies to t9.

## DAG

```mermaid
graph TD
  t1[t1: delete v1 sync code paths] --> t2
  t2[t2: Drizzle schema additions + sync_runtime_state rewrite] --> t4
  t2 --> t6
  t3[t3: manual-wipe procedure documentation] --> tFINAL
  t4[t4: nowMonotonic clock helper] --> t5a
  t4 --> t5b
  t5a[t5a: write-path dirty-bit wiring — Layer 0/1 repos] --> t6
  t5b[t5b: write-path dirty-bit wiring — Layer 2/3 repos] --> t6
  t6[t6: cycle implementation per t2 §6] --> t7
  t6 --> t9
  t7[t7: scheduler implementation per t4 §2] --> t8
  t8[t8: BG-task registration per t4 §4] --> tFINAL
  t9[t9: dev-only wipe affordances behind isDevMode\(\)] --> tFINAL
  tFINAL[tFINAL: client end-to-end verification]
```

Notes on the DAG:

- **t1 and t3 run in parallel at the front, alongside each other.**
  t1 is pure deletion of v1 code; t3 is a pure documentation task
  with no code dependency on any other task. Both are unblocked
  from plan 1's merge.
- **t2 depends on t1** — t2 ships the v2-shaped Drizzle schemas;
  in a tree that still references v1 code is messy; cleaner to
  delete v1 first.
- **t4 depends on t2** — `nowMonotonic()` persists into
  `sync_runtime_state.last_emitted_ms`, which only exists after t2.
- **t5a / t5b run in parallel after t4** — both call `nowMonotonic()`
  and write the new dirty-bit columns from t2. The split is purely
  size-driven; the contract is identical.
- **t6 depends on t5a + t5b + t2** — the cycle assumes every entity
  write has the dirty bit; both halves must be merged for the cycle's
  invariants to hold against the full dirty stream.
- **t7 → t8** — the BG-task task body runs the same cycle the
  scheduler invokes; t8 wires registration after t7's scheduler is
  in place.
- **t9** runs in parallel with t7 / t8 (depends only on t6).
- **tFINAL is the sink** — depends on t3 (so the manual-wipe doc
  exists and tFINAL can assert it), t8 (so BG-task is registered
  for the round-trip), and t9 (so dev affordances exist for the
  tFINAL test setup paths). t5a / t5b are transitive dependencies
  through t6 → t7 → t8.

## Tasks

- [t1: delete v1 sync code paths](tasks/t1.md) — build
- [t2: Drizzle schema additions + sync_runtime_state rewrite](tasks/t2.md) — build
- [t3: manual-wipe procedure documentation](tasks/t3.md) — build (docs-only)
- [t4: nowMonotonic clock helper](tasks/t4.md) — build
- [t5a: write-path dirty-bit wiring — Layer 0/1 repos](tasks/t5a.md) — build
- [t5b: write-path dirty-bit wiring — Layer 2/3 repos](tasks/t5b.md) — build
- [t6: cycle implementation per t2 §6](tasks/t6.md) — build
- [t7: scheduler implementation per t4 §2](tasks/t7.md) — build
- [t8: BG-task registration per t4 §4](tasks/t8.md) — build
- [t9: dev-only wipe affordances behind isDevMode\(\)](tasks/t9.md) — build
- [tFINAL: client end-to-end verification](tasks/tFINAL.md) — build (final test card)

## Carry-over from plan 1 (sync-v2-server, merged 2026-05-26)

The seven facts below are **as-built on `main`** at the time this plan
was authored. Builders must treat them as load-bearing constraints and
must NOT redefine, restate, or relitigate them. Source of record:
`docs/plans/sync-v2-server/plan.md ## Deviations log` and the
referenced PRs.

1. **Layer→type partition (corrected).** Layer 0 = `gyms`,
   `exercise_definitions`; Layer 1 = `sessions`,
   `exercise_muscle_mappings`, `exercise_tag_definitions`; Layer 2 =
   `session_exercises`; Layer 3 = `exercise_sets`,
   `session_exercise_tags`. The cycle in t6 imports this from
   `apps/mobile/src/sync/topo-order.ts`. Do NOT use t1 §7.7's example
   mapping (it puts `exercise_tag_definitions` in Layer 0 and is
   structurally impossible — see the corrected note in `topo-order.ts`
   and `docs/plans/sync-v2-server/plan.md ## Deviations log` entry for t2).

2. **`gyms` columns include the M15 carry-over.** `latitude`,
   `longitude`, `coordinate_accuracy_m`, `coordinates_updated_at` are
   part of the v2 `gyms` table and the client schema already declares
   them. Push/pull serialisation for `gyms` in t6 must include all four
   in `fields`; the as-built server RPCs already do per the t3 / t4
   Deviations log entries.

3. **RPC signatures and grants.**
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
     PostgREST 42501. The cycle (t6) must treat AUTH_REQUIRED as a
     normal error envelope (no-op the cycle, surface to scheduler),
     NOT as a network-level failure.

4. **`sync-extras.json` `server_only_columns` exemption removal.** Plan
   1's t2 added this exemption registering `deleted_at` as server-only
   while the client schemas lacked it. Plan 2's t2 adds the local
   `deletedAt` columns to the five schemas that lacked them, then
   **removes the exemption** in the SAME PR. Re-running
   `npm run check:sync-drift -- --strict` after the removal must still
   pass.

5. **`apps/mobile/src/sync/topo-order.ts` is authoritative.** Plan 1
   shipped this file via t2. Plan 2's t6 / t7 import from it; they do
   NOT redefine the layers. Any future layer change goes via a fresh
   PR that updates `topo-order.ts` in lock-step with the FK graph; the
   drift checker enforces consistency.

6. **`local_dirty` / `local_updated_at_ms` exemptions are pre-registered.**
   Plan 1 registered both names in `sync-extras.json`'s
   `local_only_columns` even though the columns don't yet exist on the
   client. When plan 2's t2 adds the columns to the Drizzle schemas,
   the registration just resolves to a no-op — no churn needed in
   `sync-extras.json` for that pair.

7. **Drift-checker tool versions.** The checker uses
   `better-sqlite3@^12.10.0`, `pg@^8.21.0`, `tsx@^4.22.3` (already
   installed). Plan 2's t2 should re-run `npm run check:sync-drift --
   --strict` after each schema change to verify the §4 exemption
   removal doesn't flag a real drift.

## Deviations log

<empty until first merge>
