# Plan: Sync v2 — Launch (stub)

> **Stub.** Re-invoke the multi-agent-orchestration skill with
> `create multi-agent-orchestration-plan for sync-v2-launch at this path`
> to flesh out. This file is the seed: Goal, Outcomes, sketch DAG, sketch
> task list. No `tasks/` subfolder yet.
>
> **Depends on plans 1 and 2 (`docs/plans/sync-v2-server/`,
> `docs/plans/sync-v2-client/`) being merged** so the schema, RPCs,
> client cycle, and scheduler exist for this plan to layer login,
> sync-gating, and the seed reorder on top.

## Goal

Bring the v2 sync surface to a launchable product. Enforce login-on-start
(no anonymous mode); block app usage until the first sync cycle drains
(per t2 §5's `bootstrap_completed_at` flag); reorder the seeded catalog
loader to run **after** the first sync cycle per t3's bootstrapper
design; switch every entity to soft-delete-only (no hard delete UI path
remains); build the Settings sync-status surface per t4 §5.2's deferred
follow-up; finalise the dev-gated wipe affordances.

## Outcomes

When this plan is done, all of these are true (cross-cutting outcomes
from `docs/plans/sync-v2/plan.md` are restated here in
testable-on-day-of form):

- App routes redirect to a sign-in screen whenever `auth.uid()` is null.
  No anonymous-use path remains. A Maestro flow verifies a launch with
  no session lands on sign-in and does not render any data screens.
- App usage is blocked until `sync_runtime_state.bootstrap_completed_at`
  is non-null. While blocked, a "Setting up your data…" full-screen UI
  renders. On error a retry CTA shows the error message and a single
  Retry button. A Maestro flow verifies: fresh install → sign-in →
  block-screen visible → block-screen dismisses after the first cycle
  completes within 1 minute of foreground.
- The seeded catalog loader (current `seedExerciseCatalog`) runs **only
  after** `bootstrap_completed_at` is set, per t3 §1.1's
  bootstrapper:
  - `rowsPulled := runFirstFullPull()` drains all four layers per t2
    §4.4.
  - `if rowsPulled == 0:` runSeeder() inserts the bundle via the normal
    repo path (rows become `local_dirty = 1` and reach the server on
    the next cycle).
  - `bootstrap_completed_at := now()` set last.
- The seeder NEVER mutates `local_dirty` or `local_updated_at_ms`
  directly — it goes through repo paths that flip them naturally per
  t3 §1.4.
- The `sys_*` → `seed_*` bundle slug rename per t3 §2.3 lands. Bundle
  rows use stable slug IDs (`seed_bench_press`,
  `seed_map_bench_press__chest`, …).
- A bundle-migration mechanism per t3 §7.2 ships:
  `sync_runtime_state.applied_seed_migration_app_version` exists (plan
  2 may already have added the column; this plan adds the runtime
  loop), `BUNDLE_MIGRATIONS` array exists in the bundle module (empty
  for first ship), the runtime invokes pending migrations after the
  bootstrapper per t3 §7.2's `runBundleMigrations` pseudocode.
- `muscle_groups` bootstrap check is extended from "all-or-nothing on
  empty" to "insert any bundle row whose id is not already present
  locally" per t3 §8.2 #8.
- Every entity write path that previously did a hard DELETE now does a
  soft-delete (sets `deleted_at = Date.now()`, flips dirty bit). Local
  readers filter `WHERE deleted_at IS NULL` everywhere. A grep test
  confirms no `db.delete(<entity>)` remains in `apps/mobile/src/` for
  the eight entities (only the dev wipe affordance is allowed).
- The auth-layer sign-out / account-switch path wipes per t3 §6.2 #1–6:
  clears entity tables, resets `bootstrap_completed_at` to null, resets
  `pull_cursor` to `{}`, resets `applied_seed_migration_app_version` to
  0, **preserves** `last_emitted_ms`, **preserves** `muscle_groups`.
- Settings panel exposes a sync-status surface per t4 §5.2's deferred
  follow-up: last successful sync time, dirty count
  (`SELECT count(*) WHERE local_dirty = 1` across the eight tables),
  error state (last cycle's error, if any), network state (NetInfo's
  current `isInternetReachable`). Builds on / replaces v1's
  `profile-status.ts`. (If plan 2 already deleted `profile-status.ts`,
  this plan adds the new surface from scratch.)
- Dev-only wipe affordances behind `isDevMode()`: `wipe-local`,
  `wipe-remote-for-me`. (If plan 2 already shipped these, this plan
  confirms they're correct against the launch state and adds the
  Settings entry-point.)
- **Final test card asserts the end-to-end Outcomes from
  `docs/plans/sync-v2/plan.md`** — every cross-cutting outcome from
  the design wave's plan is exercised here. Specifically:
  1. Reinstalling the mobile app on the same device, then logging in,
     restores all exercises, sessions, sets, gyms, tags within one
     minute of foreground.
  2. Logging in to a fresh second device, with remote data present,
     restores all of the above within the same window.
  3. All v1 sync code paths and v1 server objects are gone
     (cross-checked against plans 1 + 2).
  4. Drift checker passes on the integration branch.
  5. Wipe-local and wipe-remote-for-me work behind `isDevMode()` gate.

## Sketch DAG

```mermaid
graph TD
  t1[t1: login-on-start enforcement + redirect to sign-in]
  t2[t2: sync gate full-screen UI + retry]
  t3[t3: bootstrapper integration — seeder runs after first cycle]
  t4[t4: sys_ → seed_ bundle slug rename]
  t5[t5: bundle migration runtime loop]
  t6[t6: muscle_groups idempotent bootstrap]
  t7[t7: soft-delete everywhere — remove hard-delete paths]
  t8[t8: sign-out / account-switch wipe per t3 §6.2]
  t9[t9: Settings sync-status surface]
  t10[t10: dev-gated wipe affordances]
  tFINAL[tFINAL: launch end-to-end verification]

  t1 --> t2
  t2 --> t3
  t3 --> t4
  t3 --> t5
  t3 --> t6
  t1 --> t8
  t3 --> t9
  t3 --> t10
  t4 --> tFINAL
  t5 --> tFINAL
  t6 --> tFINAL
  t7 --> tFINAL
  t8 --> tFINAL
  t9 --> tFINAL
  t10 --> tFINAL
```

The re-dispatched planner should:

- Size every node against the ~2000-line budget; t7 (soft-delete
  everywhere) may need to split per entity.
- Check whether plan 2 already covered any of t10 (dev wipe
  affordances) and t8 (sign-out wipe — partially in plan 2's `t3:
  local-DB-wipe-on-v2-boot version marker`). If so, this plan's tasks
  reduce to the deltas; clarify the split.

## Sketch task list

- t1: login-on-start enforcement — auth-state guard at the route layer
  redirects to a sign-in screen when `auth.uid()` is null
- t2: sync-gate full-screen UI — block app usage until
  `bootstrap_completed_at` non-null; show "Setting up your data…";
  retry CTA on error
- t3: bootstrapper integration — wire the seeder behind the
  bootstrapper per t3 §1.1; seeder runs only when first-pull returned
  zero rows
- t4: `sys_*` → `seed_*` bundle slug rename per t3 §2.3
- t5: bundle migration runtime loop per t3 §7.2 — invoked after the
  bootstrapper, gated by
  `sync_runtime_state.applied_seed_migration_app_version`. Empty
  `BUNDLE_MIGRATIONS` list for first ship.
- t6: `muscle_groups` idempotent bootstrap per t3 §8.2 #8 — extend the
  existing all-or-nothing seeder to insert-if-not-exists
- t7: soft-delete everywhere — remove every hard-delete path in
  `apps/mobile/src/` for the eight entities (use `deleted_at` only).
  Local readers filter `WHERE deleted_at IS NULL`. **May split** per
  entity if size budget binds.
- t8: sign-out / account-switch wipe per t3 §6.2 — auth-layer responds
  to sign-out with the exact wipe checklist (clear entity rows, reset
  `bootstrap_completed_at`, `pull_cursor`,
  `applied_seed_migration_app_version`; preserve `last_emitted_ms`,
  `muscle_groups`)
- t9: Settings sync-status surface per t4 §5.2 — replaces
  `profile-status.ts` (or builds anew if plan 2 deleted it)
- t10: dev-gated wipe affordances (delta vs plan 2) — Settings
  entry-point, `isDevMode()` gating
- tFINAL: launch end-to-end verification — Maestro flows for each
  outcome above; the five cross-cutting outcomes from
  `docs/plans/sync-v2/plan.md` are the test contract

## Notes for the planner re-dispatch

- **Read `## Carry-over from plan 2` first.** It resolves every "if plan 2
  already did X" hedge in this stub with as-built facts and states the delta
  each sketch task reduces to (t10 → verification; t9 → build anew + add a
  scheduler state accessor; t5 → loop only; t7 incl. `removeTagAssignment`;
  t8 must not reuse the dev-wipe RPC; all server calls use `.schema('app_public')`).
- The cross-cutting outcomes in `docs/plans/sync-v2/plan.md` `## Outcomes`
  are the **launch contract** — the final test card here asserts them
  1:1.
- `docs/plans/sync-v2/designs/t3.md` is authoritative for the
  bootstrapper, slug rename, bundle migration mechanism,
  sign-out-wipe checklist (§6.2), `muscle_groups` extension.
- `docs/plans/sync-v2/designs/t4.md` §5.2 lists the deferred sync-status
  surface and "Sync now" UX — the launch plan picks them up.
- Apply the user's `isDevMode()` rule (not `__DEV__`) on any dev-only
  affordance.
- Maestro / e2e gates from the user-memory file
  (`feedback_run_sim_gates.md`) — run `test:e2e:ios:smoke` +
  `test:e2e:ios:data-smoke` before declaring this plan's PRs done.
- This plan is the last of the three. After tFINAL passes, the design
  wave's `docs/plans/sync-v2/plan.md` outcomes are fully delivered.

## Carry-over from plan 1 (sync-v2-server, merged 2026-05-26)

The planner re-dispatch must treat the following as as-built facts:

1. **`sync_push` and `sync_pull` are granted `execute` to `anon`** in
   addition to `authenticated`. This is load-bearing for plan 3's
   login-gate behaviour: a pre-login app that calls either RPC
   receives the structured `AUTH_REQUIRED` envelope (per t2 §2.2),
   NOT a raw 401. Plan 3's t2 (sync-gate full-screen UI) and t1
   (login-on-start enforcement) must handle the envelope:
   - The cycle returning AUTH_REQUIRED means "not signed in" — route
     the user to the sign-in screen rather than rendering a generic
     error. Treat it as a route signal, not an exception.
   - The sync gate's retry CTA must NOT re-trigger a cycle if the
     latest error envelope is AUTH_REQUIRED (a retry will get the
     same envelope; the user needs to sign in first).

2. **The bootstrap pull walks the corrected layer partition** (Layer
   0: `gyms`, `exercise_definitions`; Layer 1: `sessions`,
   `exercise_muscle_mappings`, `exercise_tag_definitions`; Layer 2:
   `session_exercises`; Layer 3: `exercise_sets`,
   `session_exercise_tags`). Plan 3's t3 (bootstrapper integration)
   inherits this from plan 2's t6 (cycle); no plan-3 task should
   redefine the layers.

3. **`gyms` carries the four M15 location columns** — relevant only
   if plan 3's Settings sync-status surface (t9) ever surfaces
   `gyms`-touching state (e.g. "last known gym"). Otherwise no
   direct impact on plan 3.

4. **`sync_runtime_state.applied_seed_migration_app_version`** —
   plan 2 will add this column. Plan 3's t5 (bundle migration
   runtime loop) consumes it. If plan 2 ships the column but
   doesn't populate the migration loop, plan 3's t5 is responsible
   for the loop only.

5. **Drift checker is live in the slow gate** (plan 1's t2). Any
   plan-3 PR that touches an entity Drizzle schema (unlikely — most
   plan-3 work is UI / auth) must pass `npm run check:sync-drift --
   --strict` before review.

6. **Spec edit landed in `docs/specs/05-data-model.md`**: a "Client
   schema drift rule (Sync v2)" subsection per t1 §8.2. Plan 3's
   PR-time guidance for AI agents should reference it.

## Carry-over from plan 2 (sync-v2-client, merged 2026-06-01)

Plan 2 is fully merged + audited (PASS). The planner re-dispatch must treat
the following as as-built facts and load-bearing constraints. Source of
record: the `sync-v2-client` `## Deviations log` (captured in PR #104; the
plan dir itself was retired in PR #105) and the referenced PRs.

1. **`app_public` schema on EVERY Supabase RPC call — non-obvious, just bit
   plan 2.** The Supabase client (`apps/mobile/src/auth/supabase.ts`) sets no
   default `db.schema`, but the sync RPCs live in `app_public`. `cycle.ts` and
   `dev-affordances.ts` therefore call `client.schema('app_public').rpc(...)`
   (a bare `.rpc()` on the default `public` schema silently never reaches the
   function — the v2 cycle could never sync until tFINAL's real-endpoint test
   caught it). **Any new RPC call plan 3 adds (e.g. t8 account-switch, or a t9
   status query) MUST `.schema('app_public')`.** Match the existing
   `apps/mobile/src/auth/profile.ts` convention.

2. **Dev-wipe affordances ALREADY shipped (plan 2 t9, PR #99) — launch t10
   collapses to a verification delta.** `apps/mobile/src/sync/dev-affordances.ts`
   exports `wipeLocalAndReBootstrap()` + `wipeRemoteForCurrentUser()` (both throw
   synchronously when `!isDevMode()`); both buttons already live in the
   `isDevMode()` block of `app/(tabs)/settings.tsx`; the
   `app_public.dev_wipe_my_data()` RPC (security definer, env-guarded to
   non-prod via `FORBIDDEN_ENV`) is migrated + contract-tested. ⇒ Launch t10 is
   "confirm correct against launch state," not net-new. **Caveat for t8:**
   `dev_wipe_my_data` is non-prod-gated AND is a SERVER delete — t8's
   production sign-out/account-switch wipe must NOT reuse it. t8's wipe is
   LOCAL (clear local entity tables + reset runtime-state per §6.2),
   preserving server data.

3. **Settings sync-status surface (t9): the scheduler has NO production state
   accessor.** `apps/mobile/src/sync/scheduler.ts` exports only
   `startSyncScheduler` / `stopSyncScheduler` / `requestSync` / the four-state
   types / `__getSchedulerStateForTests` (test-only). Plan 3 t9 must ADD a real
   read API (current state, last-cycle error, online projection) or derive
   status from `sync_runtime_state` + the structured log events the scheduler
   emits (`sync_scheduler_transition`, `sync_scheduler_cycle_error`,
   `sync_scheduler_ignored_event`, `sync_scheduler_foreground_sync_requested`,
   `sync_scheduler_start_failed` — via `apps/mobile/src/logging/logEvent.ts`).
   Network state = the scheduler's NetInfo `isInternetReachable` projection;
   dirty count = `SELECT count(*) WHERE local_dirty = 1` across the 8 tables.
   `apps/mobile/src/sync/profile-status.ts` is **deleted** (confirmed) → t9
   builds the surface from scratch (resolves the stub's hedge).

4. **Scheduler wiring failure CRASHES boot (re-throws), not silent-offline.**
   Per owner review (t7, PR #98), `startSyncScheduler` logs at `error` then
   **re-throws** if NetInfo/AppState listener wiring fails — a broken native
   build hard-crashes at boot rather than landing in a recoverable "offline"
   UI state. Plan 3 t1/t2 (login / sync-gate UX) should treat a wiring failure
   as a crash, not a UI error state. (Only triggers on a genuinely broken
   build; healthy builds never throw here.) The `requestSync()` entry point
   takes NO `reason` param (t4 §2.5) — login/gate trigger sync via the same
   parameterless call.

5. **`sync_runtime_state` as-built + seed marker (relevant to t2/t5/t8).**
   Columns: `pull_cursor` (json keyed `"0".."3"`), `last_emitted_ms`,
   `bootstrap_completed_at` (nullable `timestamp_ms`),
   `applied_seed_migration_app_version` (default 0). Singleton row id is
   `PRIMARY_RUNTIME_STATE_ID = 'primary'` (`apps/mobile/src/data/clock.ts`).
   The seed marker was migrated from a timestamp to an app-version integer:
   `apps/mobile/src/data/exercise-catalog-seeds.ts` exports
   `SEED_CATALOG_BUNDLE_VERSION = 1` plus read/write helpers for the marker.
   ⇒ t5 (bundle-migration loop) adds only the `BUNDLE_MIGRATIONS` array + the
   runtime loop (column + marker helpers already exist). t8 (sign-out wipe)
   resets these columns on the `'primary'` row.

6. **`deleted_at` + index on all 8 entities; the cycle already emits it.** The
   soft-delete columns + `deletedAtIdx` exist on every entity schema and the
   cycle's wire serialisation includes `deleted_at`. ⇒ t7 (soft-delete
   everywhere) only needs to (a) flip each hard-delete repo path to set
   `deleted_at = Date.now()` + the dirty bit, and (b) make readers filter
   `WHERE deleted_at IS NULL`. **Known remaining hard delete:**
   `removeTagAssignment` (`session_exercise_tags`, `exercise-tags.ts`) was left
   as a hard `DELETE` by plan 2 t5b (deferred here) — t7 converts it. Grep
   `db.delete(` / `.delete(` across the 8 entities for the rest.

7. **Test-lane + infra conventions (as-built; tFINAL must follow).** Two lanes:
   `test:sync` (fast, infra-free, runs in CI's `npm test`) and `test:sync:infra`
   (Supabase/branch-dependent — cycle round-trip, AUTH_REQUIRED, drift —
   **excluded from CI's fast `npm test`** via `jest.config.js`
   `testPathIgnorePatterns`; **fails hard** when `SUPABASE_BRANCH_URL` /
   `SUPABASE_BRANCH_ANON_KEY` are unset). Jest hang-safety: `testTimeout: 15000`,
   a global inert Supabase mock, and `npm run test:handles` (open-handle guard) —
   never add `--forceExit`. iOS Maestro: the combined `npm run test:e2e:ios:gates`
   runner (one provision/launch/warm/teardown for both flows); sims
   auto-provision + pre-authorize URL schemes AND location. ⇒ Plan 3's
   tFINAL live/round-trip tests (the two-device restore outcomes) go in an
   infra lane like `test:sync:infra` (branch-provisioned, out of CI's fast
   lane), and Maestro flows use `test:e2e:ios:gates`.

8. **Migrations: single baseline + generated bundle.** History is squashed to
   one `apps/mobile/drizzle/0000_living_bucky.sql` baseline; the runtime bundle
   `apps/mobile/drizzle/migrations.generated.ts` is produced by
   `apps/mobile/scripts/bundle-migrations.ts` (chained into `db:generate`).
   Plan 3 is mostly UI/auth and should add NO schema migration (the `sys_*→seed_*`
   rename is bundle DATA, not a migration). If any plan-3 task does add one, it
   appends after the baseline and must re-run `bundle-migrations.ts`.

9. **Durable docs / protocol.** The v1→v2 wipe runbook moved to
   `docs/manual-wipe-v1-to-v2.md` (plan-2 teardown) — reference that path, not
   the retired `docs/plans/sync-v2-client/...`. The mao skill now enforces: no
   ephemeral plan/card/design ids (`t1`, `§`, `docs/plans/...`, plan slug) in
   durable code/comments/tests; coordinator syncs to `main` after every merge;
   agents branch from the latest `origin/main`. Plan 3's builders inherit these.

> **Net effect on the sketch above:** t10 shrinks to verification (item 2); t9
> gains a "add a scheduler state accessor" sub-task (item 3) and builds anew
> (no `profile-status.ts`); t5 adds only the loop (item 5); t7's scope is
> clear incl. `removeTagAssignment` (item 6); t8 must NOT reuse the dev-wipe RPC
> (item 2); all server-touching tasks use `.schema('app_public')` (item 1); the
> live tFINAL tests use an infra lane (item 7). No Goal/Outcome here is
> *invalidated* — these are refinements the planner folds in at re-dispatch.

## Deviations log

<empty until re-dispatch>
