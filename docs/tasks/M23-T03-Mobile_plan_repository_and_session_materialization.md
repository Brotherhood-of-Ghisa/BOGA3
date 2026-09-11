---
task_id: M23-T03-Mobile_plan_repository_and_session_materialization
milestone_id: "M23"
status: planned
ui_impact: "no"
areas: "frontend"
runtimes: "node|expo"
gates_fast: "./boga test fast"
gates_slow: "./boga test ios-sync-e2e"
docs_touched: "docs/specs/05-data-model.md, docs/specs/09-project-structure.md, docs/specs/tech/session-planning-contract.md"
---

# M23-T03 — Mobile plan repository and session materialization

## Task metadata

- Task ID: `M23-T03-Mobile_plan_repository_and_session_materialization`
- Status: `planned`
- Depends on: `M23-T02`
- Precedes: `M23-T04`, `M23-T05`

## Parent references (required)

- Milestone: `docs/specs/milestones/M23-session-planning-and-programmes.md`
- **Contract:** `docs/specs/tech/session-planning-contract.md`
- Data: `docs/specs/05-data-model.md`
- Current draft/recorder semantics:
  `apps/mobile/src/data/session-drafts.ts`,
  `apps/mobile/src/session-recorder/set-semantics.ts`
- Project structure: `docs/specs/09-project-structure.md`
- Testing: `docs/specs/02-quality-and-test-gates.md`,
  `docs/specs/06-testing-strategy.md`

## Objective

Provide one tested `src/session-planner/` domain API for human planner screens
and synced agent-created rows, including the only supported operation that
turns a plan into an active performed session.

## Scope

### In scope

- Local query/model mapping for upcoming, unscheduled, programme, plan-detail,
  and started-plan reads.
- Transactional create/update/reschedule/reorder/duplicate/delete operations
  for unstarted plans and programmes.
- Shared plan validation/normalization matching T01, with UI-addressable error
  paths and no partial writes.
- `startSessionPlan(planId)`:
  - rejects deleted, malformed, or already-started plans appropriately;
  - detects any current active session before writing;
  - derives deterministic IDs using the contract recipe;
  - snapshots exercises and maps targets into `planned_weight_value`,
    `planned_reps_value`, and `planned_set_type`;
  - leaves actual values blank and uses `performance_status = planned`;
  - sets `sessions.source_plan_id` and transitions the plan to `started` in the
    same local transaction;
  - returns the existing active session on a same-plan retry.
- Repository subscription/invalidation hooks needed by screens, without UI.

### Out of scope

Routes and visual components; agent API/MCP; programme adherence analytics;
changing recorder completion or analytics formulas.

## Acceptance criteria

1. Repository tests cover standalone and programme CRUD, order, schedule/null
   schedule, snapshots, targets, duplicate, tombstone, and started immutability.
2. Validation rejects zero-exercise plans, zero-set exercises, invalid reps,
   negative/invalid weights, unknown set types, duplicate order indexes, and
   contract limit violations without a partial write.
3. Starting a valid plan creates exactly one active session graph with correct
   order, snapshots, gym, provenance backlink, blank actuals, planned targets,
   and dirty/timestamp metadata.
4. An unrelated active session returns the typed active-conflict result and
   leaves both the plan and performed graph unchanged.
5. Repeating Start locally or after hydration returns the same session; two
   independently materialized copies of the same plan produce identical IDs
   and converge under server uniqueness.
6. Started plans cannot be edited or deleted through the repository. Their
   source graph remains unchanged when the performed session is edited.
7. Query tests prove unstarted plans are excluded from existing session-list,
   stats, record, muscle/exercise analytics, and group-domain inputs.
8. A session created from a plan still participates normally once active or
   completed; only the separate plan rows remain excluded.

## Docs touched (required)

- `docs/specs/05-data-model.md`: repository/materialization as-built behavior.
- `docs/specs/09-project-structure.md`: add the `src/session-planner/` owner and
  boundary.
- `docs/specs/tech/session-planning-contract.md`: as-built module/functions,
  transaction behavior, and deviations.

## Testing and verification approach

- Add focused Jest tests alongside `src/session-planner/` and regression tests
  for existing analytics/session/group selectors.
- Before PR: `./boga test fast` and `./boga test ios-sync-e2e`.
- Run `./boga test for --diff origin/main` and any additional lane it selects.
- No screenshots: this task has no screen or component change.

## Implementation notes

- Reuse the app's monotonic clock and transaction helpers; do not create a
  second sync timestamp scheme.
- Keep planner state out of `session-drafts.ts` except for the final performed
  graph that the recorder already understands.
- The repository is the mutation boundary for mobile UI; screens do not issue
  ad-hoc multi-table writes.

## Evidence

## Completion note

- What changed:
- What tests ran:
- What remains:
