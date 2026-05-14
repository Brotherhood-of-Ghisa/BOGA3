# Sync redesign — plan

## Context

The user reports sync "completely broken." Root cause: backend schema treats `id text
primary key` as a global namespace on `exercise_definitions` (and the other "user-scoped"
tables), but the mobile app ships seeded exercises with stable shared ids. First user to
sync owns each id; everyone else gets rejected by `raise exception '... belongs to a
different owner'` ([m13:554, 648, 775, 905, 1015, 1169](../../../supabase/migrations/20260306170000_m13_sync_events_ingest_projection.sql#L554)).

The product model is simpler than the implementation assumes: **everything is user-scoped
from day one. Seeds are user-private at install time, indistinguishable from user-created
data.** No system catalog exists on the server. Future group/competition features will be
layered later via a separate `group_id` column or table.

We can drop the database (no data migration). We can drop a meaningful amount of code that
exists to manage the now-nonexistent system/user distinction.

## The new model in one paragraph

Mobile seeds exercises into local DB on install with stable ids; treats them identically to
user-created exercises. Sync pushes them per-user. Backend has composite PKs
`(id, owner_user_id)` so two users can own the same id without conflict. Server stores only
user-owned rows. Bootstrap is a per-user snapshot+merge as today. The "different owner"
error class disappears by construction.

## Cleanups the new model unlocks

- **Six SQL exception branches deleted** from `sync_apply_projection_event` — the "belongs
  to a different owner" case can't happen under composite PKs.
- **Eight redundant unique constraints deleted** (`*_id_owner_unique` on each user-scoped
  table — implied by the composite PK).
- **Two columns deleted** (`originScopeId`, `originSourceId`) and their index — vestigial
  from an abandoned multi-scope design. Touched in ~10 files across schemas, data layer,
  bootstrap convergence, and contract examples.
- **"System catalog" naming removed** from type names (`SystemExerciseDefinitionSeed` →
  `ExerciseDefinitionSeed`), helper names (`seedSystemExerciseCatalog` →
  `seedExerciseCatalog`), and constants. Conceptual cleanup.
- **M14 patch migration folded in** — `set_type` lives in the new clean migration.
- **`origin_scope_id` / `origin_source_id` payload fields** removed from convergence-event
  emission and from contract examples.

Things considered but **don't yield** simplification:
- Bootstrap's wipe-and-merge structure stays (still needed for user-switch on same device).
- The `mergeByKey` `includeRemote: row.deletedAtMs === null` filter stays — `gyms`/
  `session_exercises` have no local `deletedAt` column. Removing requires a deferred schema
  addition.
- Sequence-counter sharing across users on same device — deferred per prior alignment.

## Tasks

### Wave 1 — independent, run in parallel

#### T1 — Backend schema + projection rewrite

**What problem this fixes:** The backend can't accept the same exercise id from two
different users. We change the PK to `(id, owner_user_id)` so each user has their own
keyspace. The "belongs to a different owner" error vanishes because the conflict it was
guarding against can't happen.

**Files:**
- New migration: `supabase/migrations/<next-timestamp>_user_scoped_pk_redesign.sql`
- Existing M5/M12/M13/M14 migrations: leave in place (history). T7 wipes the hosted DB.

**Scope:**
- For each of the eight sync tables (`gyms`, `sessions`, `session_exercises`,
  `exercise_sets`, `exercise_definitions`, `exercise_muscle_mappings`,
  `exercise_tag_definitions`, `session_exercise_tags`): drop and recreate with
  `primary key (id, owner_user_id)`. Drop the `*_id_owner_unique` constraints. Child FKs
  already use composite form — point them at the new PKs.
- Recreate `sync_apply_projection_event`: change every `on conflict (id)` →
  `on conflict (id, owner_user_id)`; delete the six "belongs to a different owner" branches.
- Recreate `sync_events_ingest_impl` and `sync_events_ingest` (logic unchanged).
- Reapply RLS policies, owner-immutable triggers, indexes.

**Reuse:** the entity-event dispatch matrix and payload validation in the existing
projection function — copy verbatim, only the conflict handling changes.

**Acceptance:** migration applies cleanly to fresh local Supabase; `\d+
app_public.exercise_definitions` shows the composite PK; `\df+
app_public.sync_apply_projection_event` definition contains zero "different owner" mentions.

#### T2 — Drop `originScopeId` / `originSourceId`

**What problem this fixes:** These columns exist on `gyms` and `session_exercises`,
hardcoded to `'private'`/`'local'` everywhere. Leftover from an abandoned design with
system-vs-user-scope distinctions. Dead weight.

**Files:**
- Schema: `apps/mobile/src/data/schema/gyms.ts`, `session-exercises.ts`
- New Drizzle migration under `apps/mobile/drizzle/` (sequence after `0006_*`)
- Read/write sites: `local-gyms.ts`, `session-drafts.ts` (5 spots), `bootstrap.ts` (5 spots)
- Contract doc payload examples in `supabase/session-sync-api-contract.md`

**Scope:** remove columns from schema + Drizzle migration; strip from all
readers/writers/payloads; drop `gyms_origin_scope_id_idx`.

**Acceptance:** `git grep -i 'origin_scope\|origin_source\|originScope\|originSource'`
returns no hits in `apps/mobile/`.

#### T3 — Sync runtime hardening (the bootstrap-loop fix)

**What problem this fixes:** Today bootstrap loops indefinitely on certain users/devices —
independent of the schema bug, but compounds it. Four interacting causes, one fix each:

1. **Bug:** Convergence loop ([runtime.ts:339-371](../../../apps/mobile/src/sync/runtime.ts#L339))
   gives up the first time a flush returns anything other than `success` or `idle`. If the
   periodic 60 s scheduler fired first and is still in-flight when bootstrap calls flush,
   the engine returns `in_flight` → bootstrap marks itself `not_converged` → never sets
   `bootstrapCompletedAt`.
   **Fix:** on `in_flight`, wait for the in-flight promise (or short-sleep retry) within
   `maxAttempts`. On `backoff`, return `converged` (queue is in scheduler's hands).

2. **Bug:** Bootstrap re-runs on every Supabase auth event including `TOKEN_REFRESHED`
   ([runtime.ts:407-413](../../../apps/mobile/src/sync/runtime.ts#L407)). With #1 also
   failing, bootstrap re-fires forever.
   **Fix:** in the auth listener, track last-observed user id; only queue a reconcile when
   it changes (sign-in / sign-out / user switch).

3. **Bug:** No cooldown between bootstrap attempts.
   **Fix:** add `lastBootstrapAttemptAt` column to `sync_runtime_state`. In
   `shouldRunBootstrap`, skip if last attempt was within 30 s and user hasn't changed.

4. **Bug:** Scheduler keeps firing during bootstrap, racing for the engine's single
   in-flight slot — creates the `in_flight` collision in #1.
   **Fix:** expose `isBootstrapInProgress()` from `runtime.ts`; scheduler skips ticks while
   bootstrap is running.

**Files:** `apps/mobile/src/sync/runtime.ts` (#1, #2, #3),
`apps/mobile/src/sync/scheduler.ts` (#4), `apps/mobile/src/sync/engine.ts` (add
`isFlushInFlight()` getter), `apps/mobile/src/data/schema/sync-runtime-state.ts` + new
Drizzle migration (#3).

**Reuse:** existing `clearSyncRetryState`, `logEvent`, `bootstrapLocalDataLayer`.

**Acceptance:** new unit tests in `sync-runtime-bootstrap.test.ts` and
`sync-scheduler.test.ts` cover each of the four fixes.

#### T4 — Seed survival after bootstrap wipe

**What problem this fixes:** Bootstrap's merge step does `tx.delete(exerciseDefinitions)`
etc. ([bootstrap.ts:1001-1010](../../../apps/mobile/src/sync/bootstrap.ts#L1001)) and
reinserts only the rows that survived the merge. For a brand-new user with empty remote,
the seed rows get wiped and **nothing puts them back** — the seeder
(`seedSystemExerciseCatalog`) only runs at app launch via
`apps/mobile/src/data/bootstrap.ts:59`, not after a sync wipe. Result: a fresh user can end
up with an empty exercise catalog until they restart the app.

**Fix:** call `seedSystemExerciseCatalog(database, now)` at the end of `applyMergePlanTx`.
Idempotent (`onConflictDoUpdate`). Any seed rows it (re)inserts get picked up by the next
convergence flush — and since the server schema (post-T1) accepts per-user copies, that
flush succeeds.

**Files:** `apps/mobile/src/sync/bootstrap.ts`.

**Acceptance:** extend `sync-reinstall-restore-parity.test.ts` with a "fresh user, empty
remote, after bootstrap" assertion that the local catalog row count equals
`SYSTEM_EXERCISE_DEFINITION_SEEDS.length`.

### Wave 2 — depend on Wave 1, run in parallel as their deps merge

#### T5 — Backend test updates

**Depends on:** T1 merged.

**What problem this fixes:** existing backend tests assert behaviors that no longer hold
(cross-owner rejection). Add coverage for the new positive case (two users, same id).

**Files:** `supabase/tests/` — the ingest contract test script.

**Scope:** new test that users A and B each upsert
`exercise_definitions(id='shared-test-id')` and both succeed; remove the "different owner"
rejection test; verify M5 PostgREST baseline tests still green.

**Acceptance:** the backend ingest contract test script exits 0 against fresh local Supabase.

#### T6 — Documentation updates

**Depends on:** T1 + T3 merged.

**Files:**
- `docs/specs/03-technical-architecture.md` (M13 sync rows)
- `docs/specs/05-data-model.md` (ownership invariants — composite PK; no cross-owner conflict
  path; keep the 3-tuple server-side dedup key as-is, see "On the 3-tuple" below)
- `docs/specs/milestones/M13-simple-backend-sync.md` (scope decisions, protocol baseline)
- `docs/specs/06-testing-strategy.md` (drop cross-owner conflict from required coverage)
- `supabase/session-sync-api-contract.md` (remove `origin_scope_id`/`origin_source_id` from
  payload examples)

**Acceptance:** `git grep -i 'belongs to a different owner\|origin_scope\|system catalog'`
returns no hits in `docs/` or `supabase/session-sync-api-contract.md`.

#### T8 — Seed once, never overwrite; dev reset path

**Depends on:** T3 + T4 merged (touches the same files; cleaner to branch after).

**Runs in parallel with:** T5, T6.

**What problem this fixes.** The current seeder (`seedSystemExerciseCatalog`) runs at every
app launch (via `apps/mobile/src/data/bootstrap.ts:59`) and again after every sync
bootstrap (via T4's call inside `mergeRemoteProjectionIntoLocalState`). It uses
`onConflictDoUpdate`, which:
- Overwrites a user's local rename of a seeded exercise (e.g. user renames "Bench Press"
  → "My Bench"; the next launch reverts it).
- Bumps `updated_at` on every seeded row at every launch + every bootstrap, which
  the next bootstrap merge sees as "local newer than remote" and queues spurious
  convergence events for. Wasteful churn.

The intended product behaviour is **seed once on a truly fresh install, never overwrite
existing rows**. App launches do not re-seed. Bootstrap does not re-seed an
already-populated catalog. Dev workflows get an explicit "reset and re-seed" escape hatch.

**Fix.**

1. **Add a singleton marker.** Add a `seedsAppliedAt: integer({ mode: 'timestamp_ms' })`
   nullable column to `sync_runtime_state` (reuse the existing singleton — don't add a new
   table). New Drizzle migration + bundle entry. Coordinate the migration sequence number
   with whatever T2/T3 land on (currently `m0010`; T8's migration will likely be `m0011`
   or `m0012` depending on merge order — builder picks the next available).

2. **Refactor `seedSystemExerciseCatalog`** in `apps/mobile/src/data/exercise-catalog-seeds.ts`
   into a one-shot:
   - Read the marker first. If non-null, return early. Log nothing (this is the steady-state
     path; not an error).
   - If null, run the existing inserts (you may keep `onConflictDoUpdate` defensively, but
     the marker check should mean conflicts never happen in practice). After successful
     seeding, set `seedsAppliedAt = now` in the same transaction or immediately after.
   - Keep the existing `verifySeededSystemExerciseCatalog` post-check; it now only runs on
     the first-seed path.

3. **Both call sites become idempotent automatically.** Both
   `apps/mobile/src/data/bootstrap.ts:59` (launch-time) and the T4 post-merge call in
   `apps/mobile/src/sync/bootstrap.ts` no longer need conditional logic — the gate inside
   the seeder handles it.

4. **Dev reset surface.** Add a `resetLocalDataAndReseed()` function under
   `apps/mobile/src/data/` (e.g. `apps/mobile/src/data/dev-reset.ts`). It must:
   - Wipe all data tables (gyms, sessions, session_exercises, exercise_sets,
     exercise_definitions, exercise_muscle_mappings, exercise_tag_definitions,
     session_exercise_tags, sync_outbox_events, sync_runtime_state, sync_delivery_state).
   - Reset the `seedsAppliedAt` marker to null.
   - Re-run `seedSystemExerciseCatalog` (which will now run because the marker is null).
   - Be guarded by `__DEV__` (no-op in release builds; throw if called in prod).

   Surface it in one place that's easy to invoke during development. Either:
   - A button on a developer-only screen in the profile area, or
   - A script under `apps/mobile/scripts/` that can be called from a dev tool, or
   - Both.
   Builder picks the simplest surface. Document the chosen surface in the PR body.

5. **Convergence behaviour change.** With the seeder no longer bumping `updated_at` on
   every launch, the merge will not queue spurious convergence events. Verify in tests.

**Acceptance criteria:**
- Test: first launch on empty DB → seeder runs, marker set, catalog populated.
- Test: second launch (marker set) → seeder is a no-op; manual edit to a seeded row
  persists across the launch.
- Test: bootstrap merge with empty remote on an already-seeded local → no convergence
  events queued for unchanged seeded rows.
- Test: bootstrap merge with empty remote on a freshly-reset local (marker null) → seeder
  runs, populates catalog, convergence events queued for the now-fresh seed rows. (T4's
  call site path.)
- Dev reset: smoke-tested manually; PR describes the chosen surface.
- `npm --prefix apps/mobile test` passes.

**Files:**
- `apps/mobile/src/data/exercise-catalog-seeds.ts` — gate + marker write
- `apps/mobile/src/data/schema/sync-runtime-state.ts` — add column
- `apps/mobile/drizzle/<next>_seeds_applied_at.sql` — migration
- `apps/mobile/src/data/migrations/index.ts` — bundle entry
- `apps/mobile/src/data/dev-reset.ts` (new) — dev reset helper
- Surface for dev reset (TBD by builder)
- Tests: extend `local-data-bootstrap.test.ts`, `sync-bootstrap-seed-survival.test.ts`, and
  add a new `seed-once.test.ts` if needed.

**Reuse:** existing seeder body (just guard it), existing migration scaffolding, existing
`bootstrapLocalDataLayer`.

### Wave 3 — sequential cleanup (after merge)

#### T7 — Drop the hosted database, re-run migrations, fix the runbook

**Depends on:** T1, T5, T6 merged.

**Manual operational step**, then commit a runbook update:
- Reset hosted Supabase (Dashboard → Database → Reset, or `supabase db reset --linked
  --yes`).
- Reapply migrations from main.
- Delete `RUNBOOK.md` lines 185-200 (migration history repair workaround); replace with
  short "hosted reset" entry.

**Acceptance:** hosted Supabase shows new schema; `supabase migration list --linked` clean;
`RUNBOOK.md` no longer references the manual repair.

## On the 3-tuple `(owner_user_id, device_id, event_id)`

Wire payload sends `(device_id, batch_id, event_id, ...)` — `owner_user_id` is **never on
the wire**. The backend reads it from the auth JWT.

Server-side dedup uses the 3-tuple. Why all three:
- `event_id` alone isn't unique across the world.
- `(device_id, event_id)` would suffice **if** every device is owned by exactly one user
  forever. Today not enforced — `device_id` is a singleton row in the local DB
  ([outbox.ts:131](../../../apps/mobile/src/sync/outbox.ts#L131)) shared across whoever signs
  in on that phone.
- The third key, `owner_user_id`, namespaces dedup so user A's and user B's events can't
  collide even if a buggy client reuses ids across user-switches.

**Recommendation:** keep the 3-tuple. Cost is one extra column in the dedup index; safety
value is real. Removing it would force fixing the client outbox to wipe on user-switch
(deferred), so cheaper to leave as-is.

## Dependency graph

```
Wave 1 (parallel, independent):
  T1 backend schema   T2 origin cleanup   T3 runtime hardening   T4 seed survival
       │                   │                    │                      │
       ├───────────────────┘                    │                      │
       │                                        │                      │
Wave 2:│   T5 backend tests   T6 docs ←─────────┴──────────────────────┘
       │   (depends T1)       (depends T1, T3)
       └───────┬──────────────────┘
               ↓
Wave 3:   T7 drop hosted DB + runbook update
          (depends T1, T5, T6 merged)
```

## Verification — integrated end-to-end (after all waves)

1. **Two users, same seeded id:** sign in as user A on fresh install, enable sync, observe
   `bench-press-001` lands on server owned by A. Sign out, sign in as user B on same
   device, enable sync, observe `bench-press-001` lands on server owned by B. No errors in
   `app_logs`.
2. **Bootstrap doesn't loop:** sign in once, observe a single `bootstrapCompletedAt` set.
   Wait for or force a `TOKEN_REFRESHED` — confirm no second bootstrap.
3. **Scheduler doesn't race bootstrap:** during sign-in, periodic scheduler is paused;
   after `bootstrapCompletedAt` is set, scheduler resumes.
4. **Fresh-user seed catalog:** after first sign-in on a brand-new install, the local
   exercise catalog matches `SYSTEM_EXERCISE_DEFINITION_SEEDS.length`.
5. **Mobile suite green:** `npm --prefix apps/mobile test`.
6. **Backend contract suite green:** the ingest contract test script in `supabase/tests/`.

## Deferred (per prior alignment)

- Seed version drift across app upgrades.
- User-edit-protection flags on seed rows.
- "Sync only used exercises" optimization.
- Multi-user-on-same-device sequence-counter / device-id hygiene.
- Adding `deletedAt` to `gyms`/`session_exercises` for cross-device delete propagation.

## Open decision

**Cooldown duration in T3.3:** start at 30 s; tune from real `app_logs` data once the loop
stops.
