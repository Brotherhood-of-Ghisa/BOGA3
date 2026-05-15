# Sync redesign — follow-ups

Items uncovered during the redesign that are out of scope for the current task set but
worth a future pass. Sorted by priority.

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

## P4 — Cross-device delete propagation for gyms / session_exercises / exercise_sets

Per original plan deferral: these tables have no local `deletedAt` column, so the merge's
`includeRemote: row.deletedAtMs === null` filter drops remote tombstones, and a row deleted
on another device is undeletable from this device's perspective.

**Action when prioritized:** add `deletedAt` to the affected local schemas, drop the merge
filter, ensure the convergence event emits a `delete` for tombstoned rows.

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
