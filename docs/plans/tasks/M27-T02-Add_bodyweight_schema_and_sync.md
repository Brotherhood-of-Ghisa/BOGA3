---
task_id: M27-T02-Add_bodyweight_schema_and_sync
milestone_id: M27
status: planned
ui_impact: "no"
areas: "cross-stack"
runtimes: "node|expo|supabase|sql"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test ios-sync-e2e"
docs_touched: "docs/specs/05-data-model.md, docs/specs/tech/sync-v2-server-contract.md, docs/specs/tech/bodyweight-load-contract.md"
---

# M27-T02 — Add bodyweight schema and sync

- Status: `planned`
- Depends on: M27-T01.
- Milestone spec: `docs/plans/milestones/M27-bodyweight-load-and-group-comparisons.md`
- Governing decisions: D1–D5, D10.

## Objective and scope

Persist all user-owned inputs needed to reproduce bodyweight calculations after
reinstallation and on another device. Read AGENTS.md, specs 02/03/05/09/10,
the Sync v2/bodyweight contracts and `supabase/README.md`; refresh HEAD and
origin/main at implementation start. Read test-directory READMEs before edits.

## Deliverables and acceptance

1. Add an owner-scoped dated weight measurement entity with kg value,
   measurement time, stable identity, tombstone and normal sync bookkeeping.
   Store explicit units at entry/conversion boundaries; prohibit ambiguous values.
2. Add nullable session B and provenance: source identity/time and origin kind,
   sufficient to explain a manual or later-reading historical estimate. Source
   edits/deletes cannot clear or recalculate a saved snapshot. Avoid a destructive
   source FK action; any FK must satisfy the synced-parent invariant.
3. Add personal coefficient metadata and explicit actual/planned external-load
   modes, with backward-compatible conventional-exercise defaults. Keep entered
   amount/reps separate from derived totals. Final names/types come from T01.
4. Pair SQLite migrations with additive server migrations and normal owner RLS,
   including the OAuth direct-access restriction. Update push/pull types,
   serializers, entity registry, topological layers/cursors, dirty writes, drift
   registration, bootstrap, account wipe and server wipe paths.
5. Define and test omitted-field behaviour for older clients. An old full-row
   writer must not reset a new snapshot/coefficient/load mode just by editing an
   unrelated field. If compatibility requires a minimum version, T12 enforces it
   explicitly before activation; do not assume additive columns alone are safe.
6. Update repository hydration/draft shapes so later tasks cannot accidentally
   drop the new fields during a normal autosave, edit, completion or restore.
7. Record **in sync scope** for these inputs. Group rules/projections and derived
   personal metrics remain outside Sync v2; do not add stored volume/1RM fields.

## Implementation boundaries

Own `src/data/schema`, paired `drizzle`/server migrations, repositories,
`src/sync`, schema drift tooling and contract tests. No new screen or automatic
legacy backfill. T04/T06 decide when a session snapshot is populated.
T12 owns production deployment and hosted smoke; this task supplies its migration
order, rollback/compatibility notes and local evidence.

## Verification and closeout

- Round-trip every new field, nullable legacy rows, tombstones, undelete,
  snapshot source deletion, unit conversion and planned/actual modes.
- Prove cross-user denial and direct OAuth denial, LWW conflicts, wipe/re-pull,
  old-writer preservation and migration upgrade from populated existing data.
- Run `./boga test fast`, `./boga test backend` and `./boga test ios-sync-e2e`;
  add anything required by `./boga test for`. Backend includes `sync-infra` and
  drift; it does not replace the device lane.
- Graduate the data/sync contracts, put evidence in the PR, mark the milestone
  entry complete and delete this card when shipped.
