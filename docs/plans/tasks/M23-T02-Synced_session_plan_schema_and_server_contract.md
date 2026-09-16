---
task_id: M23-T02-Synced_session_plan_schema_and_server_contract
milestone_id: "M23"
status: planned
ui_impact: "no"
areas: "cross-stack"
runtimes: "node|expo|supabase|sql"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test ios-sync-e2e"
docs_touched: "docs/specs/03-technical-architecture.md, docs/specs/05-data-model.md, docs/specs/tech/sync-v2-server-contract.md, docs/specs/tech/session-planning-contract.md, supabase/README.md"
---

# M23-T02 — Synced session-plan schema and server contract

## Task metadata

- Task ID: `M23-T02-Synced_session_plan_schema_and_server_contract`
- Status: `planned`
- Depends on: `M23-T01`
- Precedes: `M23-T03`, `M23-T06`

## Parent references (required)

- Milestone: `docs/plans/milestones/M23-session-planning-and-programmes.md`
- **Contract:** `docs/specs/tech/session-planning-contract.md`
- Data and sync: `docs/specs/05-data-model.md`,
  `docs/specs/tech/sync-v2-server-contract.md`
- AuthZ and backend: `docs/specs/10-api-authn-authz-guidelines.md`,
  `supabase/README.md`
- Testing: `docs/specs/02-quality-and-test-gates.md`,
  `docs/specs/06-testing-strategy.md`

## Objective

Make programmes and session plans first-class local-first data by adding the
four planning entities, `sessions.source_plan_id`, and
`session_exercises.source_plan_exercise_id`, and
`exercise_sets.source_plan_set_id` consistently to SQLite, Supabase, and every
Sync v2 path.

## Scope

### In scope

- Drizzle schema and migrations for `training_programmes`, `session_plans`,
  `session_plan_exercises`, and `session_plan_sets`.
- Nullable `sessions.source_plan_id`, its owner-scoped server FK, and the
  uniqueness guard that permits at most one non-deleted performed session per
  whole-plan start.
- Nullable `session_exercises.source_plan_exercise_id`, its owner-scoped server
  FK, and the uniqueness guard that permits at most one non-deleted performed
  exercise block per source block.
- Nullable `exercise_sets.source_plan_set_id`, its owner-scoped server FK, and
  the uniqueness guard that permits at most one non-deleted performed set per
  source target. Manual sets leave it null, and changing performed
  `order_index` never changes this provenance.
- Database/sync enforcement for the cross-level provenance invariant: a
  source-derived performed set must sit under the card sourced from its plan
  set's parent block; an unsourced card cannot contain source-derived sets,
  while a sourced card may contain null-linked manual sets.
- `session_plan_exercises.progress_status` (`pending | completed | skipped`)
  and nullable resolution timestamp with the contract checks; agent-created
  graphs always begin pending.
- Supabase `app_public` tables with owner-scoped composite PK/FKs, checks,
  indexes, owner-immutability protection, timestamps, server receipt time, RLS,
  and explicit grants matching the contract.
- Expand Sync v2 from ten to fourteen entity types and four to five layers:
  push projection/upsert, pull union/projection, cursors, local wire mapping,
  topological selection, FK closure, quarantine classification, dirty counts,
  first-sync/restore, tombstone propagation, and account/dev wipe.
- Keep `exercise_sets` in L4: its new source-set FK points to
  `session_plan_sets` in L3, so the graph remains fourteen entities/five layers.
- Schema-drift declarations and fixtures for all new fields and edges.
- Compatibility behavior for an older client receiving a server state that
  contains plan entities, exactly as decided in T01.

### Out of scope

Planner repositories or UI; start-plan materialization; agent permission,
receipts, API routes, or MCP tools.

## Acceptance criteria

1. A clean local database and a clean local Supabase stack expose the exact T01
   schema, constraints, indexes, RLS, grants, and owner-scoped FK graph.
2. `sync-drift --strict` reports fourteen entities, five valid layers, and no
   warning or error. No M22 group or M21 agent-control table enters sync scope.
3. A normal app token can push and pull each planning entity; `anon`, OAuth
   client tokens, and a different owner cannot read or write the rows directly.
4. A round trip preserves programme order, schedule/null schedule, gym and
   exercise references, snapshots, targets, block progress/resolution,
   performed set order, session/block/set provenance, timestamps, and
   tombstones.
5. A server-created complete plan graph drains through pull in FK-safe order to
   an empty client store. Reinstall/first-sync restores the same graph.
6. Local and server deletes converge without orphaning child rows, and the
   account/dev wipe removes all four new entities in FK-safe order.
7. All three performed-domain source links round-trip and reject foreign-owner
   parents. Their uniqueness guards prevent duplicate non-deleted performed
   sessions for one whole-plan start, performed exercise blocks for one source
   block, and performed sets for one source target. Reordering performed sets
   changes only their `order_index`; source target order remains unchanged.
   Cross-level mismatches between a source set and the card's source block are
   rejected atomically by direct writes and sync.
8. Unknown/new-entity compatibility behaves exactly as T01 decided and has a
   regression test or an explicit coordinated-rollout assertion.
9. Existing ten-entity workout, exercise, stats, and group tests remain green.

## Docs touched (required)

- `docs/specs/03-technical-architecture.md`: record the adopted separate-plan
  graph and materialization boundary once schema lands.
- `docs/specs/05-data-model.md`: add the four sync entities, all three
  performed-domain source fields, ownership, FK, ordering, and
  block/derived-parent lifecycle inventory.
- `docs/specs/tech/sync-v2-server-contract.md`: update entity/layer counts,
  wire fields, projections, RLS, and compatibility contract.
- `docs/specs/tech/session-planning-contract.md`: add schema/sync as-built
  pointers and any reviewed deviation.
- `supabase/README.md`: add migration and local verification guidance where
  the supported backend path changes.

## Testing and verification approach

- Add/extend local schema, repository migration, sync schema, push, pull,
  clean-room, drift, cross-owner, tombstone, and wipe tests.
- Iterate with targeted schema/sync lanes from `./boga test --list`.
- Before PR: `./boga test fast`, `./boga test backend`, and
  `./boga test ios-sync-e2e`.
- Run `./boga test for --diff origin/main` and record the result.
- Hosted migration/deployment smoke is deferred to T07 after the compatible API
  and MCP layers exist; local backend evidence is mandatory here.

## Implementation notes

- Server schema lands before any production client emits new entity types.
- Do not hand-edit generated schema artifacts when the existing generator owns
  them.
- Service-role agent writes are not a reason to weaken direct table RLS.
- Record measured gate data through the gate runners and report it only via
  `./boga timings`.

## Evidence

## Completion note

- What changed:
- What tests ran:
- What remains:
