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
four planning entities and `sessions.source_plan_id` consistently to SQLite,
Supabase, and every Sync v2 path.

## Scope

### In scope

- Drizzle schema and migrations for `training_programmes`, `session_plans`,
  `session_plan_exercises`, and `session_plan_sets`.
- Nullable `sessions.source_plan_id`, its owner-scoped server FK, and the
  uniqueness guard that permits at most one non-deleted performed session per
  plan.
- Supabase `app_public` tables with owner-scoped composite PK/FKs, checks,
  indexes, owner-immutability protection, timestamps, server receipt time, RLS,
  and explicit grants matching the contract.
- Expand Sync v2 from nine to thirteen entity types and four to five layers:
  push projection/upsert, pull union/projection, cursors, local wire mapping,
  topological selection, FK closure, quarantine classification, dirty counts,
  first-sync/restore, tombstone propagation, and account/dev wipe.
- Schema-drift declarations and fixtures for all new fields and edges.
- Compatibility behavior for an older client receiving a server state that
  contains plan entities, exactly as decided in T01.

### Out of scope

Planner repositories or UI; start-plan materialization; agent permission,
receipts, API routes, or MCP tools.

## Acceptance criteria

1. A clean local database and a clean local Supabase stack expose the exact T01
   schema, constraints, indexes, RLS, grants, and owner-scoped FK graph.
2. `sync-drift --strict` reports thirteen entities, five valid layers, and no
   warning or error. No M22 group or M21 agent-control table enters sync scope.
3. A normal app token can push and pull each planning entity; `anon`, OAuth
   client tokens, and a different owner cannot read or write the rows directly.
4. A round trip preserves programme order, schedule/null schedule, gym and
   exercise references, snapshots, targets, status, provenance, timestamps,
   and tombstones.
5. A server-created complete plan graph drains through pull in FK-safe order to
   an empty client store. Reinstall/first-sync restores the same graph.
6. Local and server deletes converge without orphaning child rows, and the
   account/dev wipe removes all four new entities in FK-safe order.
7. `sessions.source_plan_id` round-trips, rejects a foreign-owner plan, and the
   uniqueness guard prevents duplicate non-deleted performed sessions for one
   source plan.
8. Unknown/new-entity compatibility behaves exactly as T01 decided and has a
   regression test or an explicit coordinated-rollout assertion.
9. Existing nine-entity workout, exercise, stats, and group tests remain green.

## Docs touched (required)

- `docs/specs/03-technical-architecture.md`: record the adopted separate-plan
  graph and materialization boundary once schema lands.
- `docs/specs/05-data-model.md`: add the four sync entities, backlink, fields,
  ownership, FK, and lifecycle inventory.
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
