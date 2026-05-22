# Sync redesign — follow-ups

Items uncovered during the redesign that are out of scope for the current task set but
worth a future pass. Sorted by priority.

## Issue #50 schema dependency map reconciliation

The canonical post-M13 inventory now lives in
[docs/specs/tech/sync-schema-dependency-map.md](../../specs/tech/sync-schema-dependency-map.md).
The earlier fix-sync wave resolved the global-id/backend ownership failure and several
bootstrap/seed issues, but issue #50 still leaves concrete follow-up slices:

1. Local tombstone parity for `gyms`, `session_exercises`, and `exercise_sets`.
2. Explicit decision on implicit local ownership versus local `owner_user_id`.
3. Contract lock for composite edge `entity_id` versus projection row `id`.
4. FK/orphan repair plan for `session_exercises.exercise_definition_id`.
5. Explicit tombstoned-name uniqueness semantics for `exercise_tag_definitions`.
6. CI enforcement for sync/backend/Drizzle checks before risky schema changes.

Do not start a broad "rewrite sync" task without picking one of those slices and its
dependencies.

## Manual hosted-DB reset checklist (one-time, post-redesign)

The sync redesign concludes with a manual hosted Supabase reset that drops the hosted DB
and reapplies all migrations from `main` (so the per-user composite-PK schema replaces the
old broken one). The full canonical procedure now lives in
[RUNBOOK.md → Reset hosted Supabase (clean slate)](../../../RUNBOOK.md). Quick reference:

```bash
# Prereqs (one-time)
supabase login
supabase link --project-ref <your-project-ref>

# 1. Reset (DROPS HOSTED DATA)
supabase db reset --linked --yes

# 2. Re-expose app_public schema
#    Dashboard → Project Settings → API → Exposed schemas
#    Add `app_public` to the list. (NOT done automatically by the reset.)

# 3. Verify
supabase migration list --linked
```

After step 2, smoke-check by signing into the mobile app and confirming the catalog
populates without "schema not exposed" errors.

## Priorities

## P1 — quality gate enforcement

**Question:** when and how do we enforce that all relevant quality gates run before merge?

**Why this matters:** Today the gates are honor-system. T1, T3, T4 merged without anyone
running `quality-slow.sh backend` (which contains the auth-authz, M5 PostgREST, and M13
ingest contract suites). T3 also merged with a missing `_journal.json` entry that
`drizzle-kit check` would have caught. The execution-contract patch (PR #14) made the
expectation explicit, but that's a docs rule, not a runtime enforcement.

**Status:** Today none of the gates are wired into CI for PRs. `.github/workflows/ci.yml`
exists but only covers frontend lint/typecheck/test on `apps/mobile`.

**Decisions needed:**
1. Should `./scripts/quality-fast.sh` (both areas) run on every PR via CI? Cheap; should
   probably be unconditional.
2. Should `./scripts/quality-slow.sh backend` run on PRs touching `supabase/`,
   `apps/mobile/src/sync/`, or the contract doc? It needs a local Supabase stack — CI
   would have to spin one up. Cost: ~minutes per PR. Probably worth it for those paths.
3. Should `./scripts/quality-slow.sh frontend` (Maestro e2e) be CI-enforced or stay manual?
   Highest cost; UI-touching PRs only. Probably manual for now.
4. Does `drizzle-kit check` need a CI step? Quick (sub-second). Should be unconditional —
   would have caught T3's journal omission.

**Suggested ownership:** open a follow-up task once T7 (hosted DB reset) lands. CI changes
shouldn't compete with Wave 3.

## P2 — Drizzle journal/snapshot drift

T2's rebase agent fixed `_journal.json` for entries 10 and 11. But `meta/0010_snapshot.json`
was never created (T3 omitted it; T2's 0011 chains directly to 0006 in the snapshot graph).

**Action:** small follow-up PR to backfill `meta/0010_snapshot.json` and re-link
`meta/0011_snapshot.json`'s `prevId` to point at 0010 instead of 0006. `drizzle-kit
introspect` from a clean main checkout, then commit. Low priority; functional impact zero
(runtime migrator uses a separate hand-maintained bundle).

## P3 — Sequence counter / device id sharing across users on same device

Per the original plan deferral: `device_id` and `nextSequenceInDevice` are singleton on
device. After user A signs out and user B signs in, B's events use the same device_id and
continue A's sequence numbers. Backend tolerates it (per-user sequence space) but it's
messy. Hardening: reset `device_id` and sequence on user switch.

**Issue #50 update:** this is coupled to the local ownership decision. If local storage
remains an implicit single-user projection, user-switch reset/bootstrap and stream reset
must be tested as part of that contract. If local tables gain `owner_user_id`, stream
state should also become owner-scoped or explicitly reset per owner.

## P4 — Cross-device delete propagation for gyms / session_exercises / exercise_sets

Per original plan deferral: these tables have no local `deletedAt` column, so the merge's
`includeRemote: row.deletedAtMs === null` filter drops remote tombstones, and a row deleted
on another device is undeletable from this device's perspective.

**Action when prioritized:** add `deletedAt` to the affected local schemas, drop the merge
filter, ensure the convergence event emits a `delete` for tombstoned rows.

**Issue #50 update:** this is the highest-priority schema rewrite slice. It should be
implemented before restoring stricter local/backend FKs that depend on durable delete
semantics.

## P4a — Composite edge identity contract

`exercise_muscle_mappings` and `session_exercise_tags` currently send a composite
relationship key as `entity_id` while the actual projection row key travels as
`payload.row_id`. This is intentional enough to work, but under-documented enough to be
fragile.

**Action:** lock the contract in `supabase/session-sync-api-contract.md`, add focused
backend/client tests for duplicate attach/detach by pair key and row id, and decide
whether future APIs should expose pair identity or row identity as canonical.

## P4b — Exercise-definition FK restoration / orphan repair

`session_exercises.exercise_definition_id` is nullable locally and no longer FK-enforced on
the backend. That tolerance prevents first-sync ordering failures, but it weakens logged
exercise integrity.

**Action:** after dependency-ordered push tests and local tombstone parity are in place,
decide whether to restore a strict FK/non-null rule. If restored, ship idempotent
migrations with preflight orphan detection, repair/backfill behavior, and tests proving
orphan inserts fail.

## P4c — Tag normalized-name tombstone semantics

`exercise_tag_definitions` uniqueness currently includes tombstoned rows. A deleted tag
name blocks creating a new tag with the same normalized name unless the row is undeleted or
renamed.

**Action:** choose and document the product rule. If reuse after delete is allowed, update
local/backend unique indexes to active-row-only uniqueness and add migration repair tests.

## P5 — Seed version drift across app upgrades

Per original plan deferral: with T8 ("seed once") landed, new seeds in future app versions
will never reach existing installs. New users get the new bundle; existing users keep
their original catalog.

**Action when prioritized:** introduce a `seed_version` per row OR a "seeds present in
bundle but not in local DB → insert (no overwrite)" check.

## P6 — `supabase/hosted-bootstrap-sync.sql` is stale

**Resolved by T7 (PR #17).** File deleted; no callers. README updated to point at
`supabase db push --linked --include-all` as the canonical alternative.

## P7 — Add CI assertion for orphan Drizzle SQL files

Per the sweep agent: `drizzle-kit check` only validates entries in `_journal.json`, so it
can't detect orphan SQL files (a `0010_*.sql` with no journal entry passes). A small CI
script could grep `apps/mobile/drizzle/*.sql` against `_journal.json` and fail on mismatch.
Would have caught T3's omission directly.
