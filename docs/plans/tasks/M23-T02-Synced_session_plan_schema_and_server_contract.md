---
task_id: M23-T02-Synced_session_plan_schema_and_server_contract
milestone_id: "M23"
status: in_progress
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
- Expand Sync v2 from twelve to sixteen entity types across five layers:
  push projection/upsert, pull union/projection, cursors, local wire mapping,
  topological selection, FK closure, quarantine classification, dirty counts,
  first-sync/restore, tombstone propagation, and account/dev wipe.
- Position `exercise_sets` and `session_exercise_tags` in L4 alongside
  `body_weight_measurements` (independent root); their parent `session_exercises`
  is in L3 and `session_plan_sets` is in L3; `sessions` and
  `session_plan_exercises` are in L2; `session_plans` is in L1; and
  `training_programmes`, `user_settings`, `gyms`, `exercise_definitions`, and
  `muscle_groups` are in L0.
- Shifting `sessions` (L1->L2), `session_exercises` (L2->L3), and `exercise_sets`
  (L3->L4) in `topo-order.ts` must be accompanied by the client `pull_cursor`
  migration or protocol versioning strategy specified in T01.
- Schema-drift declarations and fixtures for all new fields and edges.
- Compatibility behavior for an older client receiving a server state that
  contains plan entities, exactly as decided in T01.

### Out of scope

Planner repositories or UI; start-plan materialization; agent permission,
receipts, API routes, or MCP tools.

## Acceptance criteria

1. A clean local database and a clean local Supabase stack expose the exact T01
   schema, constraints, indexes, RLS, grants, and owner-scoped FK graph.
2. `sync-drift --strict` reports sixteen entities, five valid layers, and no
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
9. Existing twelve-entity workout, exercise, stats, bodyweight, and group tests
   remain green.

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

- Client schema + migrations: `apps/mobile/src/data/schema/{training-programmes,session-plans,session-plan-exercises,session-plan-sets}.ts`,
  altered `{sessions,session-exercises,exercise-sets}.ts`,
  `apps/mobile/drizzle/0016_nice_blink.sql`,
  `apps/mobile/drizzle/0017_session_plan_cursor_reset.sql`.
- Sync engine: `apps/mobile/src/sync/{topo-order,fk-graph,cycle,account-wipe}.ts` (16 entities, 5 layers).
- Protocol 4: `apps/mobile/src/auth/supabase.ts`, all `supabase/tests/*.sh`, test helpers.
- Server: `supabase/migrations/20261004120000_m23_session_planning.sql`
  (4 tables, 3 provenance columns, cross-level constraint trigger, in-place
  `sync_push`/`sync_pull`/`dev_wipe_my_data` patches, protocol 4).
- New tests: `apps/mobile/__tests__/sync/{pull-cursor-remap,session-plan-entities-round-trip}.test.ts`,
  `supabase/tests/sync-session-plan-contract.sh`.

Rebased onto `origin/main` @ `5e4e9c38` (the branch base was 33 commits stale,
including the Expo SDK 58 / RN 0.88 upgrade). The upstream T01 contract
(PR #477) supersedes the earlier T01 draft and locks the cursor strategy as a
**full reset** (`pull_cursor = {}`) plus a protocol-4 gate rather than an
arithmetic remap; the shipped client migration implements the reset.

## Completion note

- What changed: added the four synced planning entities plus the three
  performed-domain provenance columns and expanded Sync v2 from twelve to
  sixteen entities across five layers (`sessions` L1→L2, `session_exercises`
  L2→L3, `exercise_sets` L3→L4). `require_sync_protocol()` now requires
  protocol 4; upgraded clients reset their per-layer `pull_cursor`
  (`0017_session_plan_cursor_reset`). A deferred constraint trigger rejects a
  source-derived performed set that is not under its card's source block.
  Server CHECK constraints were deliberately not added (v2 §A.1).
- What tests ran (measured via `./boga timings` only): `./boga test fast`
  (2895 passed; the single failure is the pre-existing load-sensitive
  `stats-screen-local-data` timeout, which fails identically on the untouched
  base `5e4e9c38`), `./boga test backend` (green, incl. all 10 sync-v2-e2e
  integration tests, `sync-push-contract` with the new planning graph, and
  `sync-infra` 17/17), `./boga test complexity`, `./boga test dependencies`,
  `./boga test docs-check`. The iOS lanes (`frontend`, `ios-sync-e2e`) cannot
  run on this non-macOS host.
- What remains: iOS lanes on a macOS host; `jest-coverage` (fails identically
  at base on this host); hosted migration/deployment smoke deferred to T07;
  T03 consumes the schema.
