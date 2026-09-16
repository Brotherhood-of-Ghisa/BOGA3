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

# M23-T03 — Mobile plan repository and block materialization

## Task metadata

- Task ID: `M23-T03-Mobile_plan_repository_and_session_materialization`
- Status: `planned`
- Depends on: `M23-T02`
- Precedes: `M23-T04`, `M23-T05`

## Parent references (required)

- Milestone: `docs/plans/milestones/M23-session-planning-and-programmes.md`
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
and synced agent-created rows, including the supported operations that turn a
complete plan or one exercise block into ordinary active-session rows and that
explicitly resolve programme progress. Add the recorder-domain operation needed
to reorder manual and source-derived sets without changing their provenance.

## Scope

### In scope

- Local query/model mapping for upcoming, unscheduled, programme, plan-detail,
  available/attached/resolved blocks, derived parent progress, and next-block
  reads.
- Transactional create/update/reschedule/reorder/duplicate/delete operations
  for eligible plans, programmes, and future unattached blocks.
- Shared plan validation/normalization matching T01, with UI-addressable error
  paths and no partial writes.
- `startSessionPlan(planId)`:
  - rejects deleted, malformed, or fully resolved plans appropriately;
  - detects any current active session before writing;
  - derives deterministic IDs using the contract recipe;
  - materializes every available source block as one sourced exercise row and
    maps targets into `planned_weight_value`, `planned_reps_value`, and
    `planned_set_type`, with `source_plan_set_id` on every copied target;
  - leaves actual values blank and uses `performance_status = planned`;
  - sets `sessions.source_plan_id` without resolving any source block;
  - returns the existing active session on a same-plan retry.
- `addPlanBlockToSession(planExerciseId, targetSessionExerciseId?)`:
  - attaches the source block to the supplied compatible card in the active
    session, or automatically uses exactly one compatible unsourced card;
  - defines automatic compatibility as the same non-null owned
    `exercise_definition_id`; snapshots are display data, not matching keys;
  - returns a typed ambiguity result with candidate card IDs and writes nothing
    when more than one compatible card exists and no target was supplied;
  - creates a sourced card when no compatible card exists, or creates an active
    session from the source plan when none exists;
  - refuses a foreign/deleted/different-exercise target and a target already
    sourced from another plan block; manual sets already on a selected card
    remain unchanged;
  - materializes each planned target with `source_plan_set_id`, while manual
    rows remain null, validates that every source target belongs to the card's
    source block, and never consumes another source block;
  - appends those targets after the card's existing live sets using the next
    dense performed order indexes while preserving source-target order, so
    existing manual warm-ups stay above them by default;
  - uses deterministic created-card/set IDs plus block/set uniqueness guards so
    retries and competing-device writes converge on at most one live attachment.
- General recorder operation
  `reorderSessionExerciseSets(sessionExerciseId, orderedSetIds)`:
  - validates that the list is an exact permutation of the card's live sets and
    rewrites dense performed `order_index` values atomically;
  - preserves set IDs, `source_plan_set_id`, planned and actual values,
    confirmation/performance state, and immutable source-plan ordering;
  - works for active recording and the existing completed-session edit flow,
    for sourced and unsourced cards alike, and survives autosave/hydration.
- `completePlanBlock(planExerciseId)` and `skipPlanBlock(planExerciseId)`:
  - completion requires the live sourced exercise block to contain at least one
    valid confirmed performed set whose `source_plan_set_id` belongs to that
    source block, but never requires target equality; manual sets do not count;
  - skip is valid only without performed work and never creates performed rows;
  - only these explicit operations resolve a block and advance derived
    programme progress; attachment alone leaves it pending.
- Repository subscription/invalidation hooks needed by screens, without UI.

### Out of scope

Routes and visual components; agent API/MCP; programme adherence analytics;
automatic progression/load calculation; changing recorder or analytics
formulas. Set reordering is in scope as an ordering operation, not a calculation
change.

## Acceptance criteria

1. Repository tests cover standalone and programme CRUD, order, schedule/null
   schedule, snapshots, targets, duplicate, tombstone, per-block lifecycle, and
   consumed-block/future-block editability.
2. Validation rejects zero-exercise plans, zero-set exercises, invalid reps,
   negative/invalid weights, unknown set types, duplicate order indexes, and
   contract limit violations without a partial write.
3. Starting a valid complete plan creates exactly one active session graph with
   correct order, snapshots, gym, session/block/set provenance, blank actuals,
   planned targets, and dirty/timestamp metadata; it does not resolve blocks.
4. An unrelated active session returns the typed active-conflict result for
   Start all. Add block attaches to the explicitly selected compatible card,
   automatically uses one unambiguous compatible unsourced card, or creates one,
   while leaving unrelated plan/freeform data unchanged.
5. Add block with no active session creates one using the plan gym. Warm-ups
   already on a compatible squat card remain on that card when planned squat
   sets are added; planned sets added first may later share the card with manual
   warm-ups. Multiple compatible cards return ambiguity without a write.
6. Repeating Start/Add locally or after hydration returns the same materialized
   rows; competing devices produce deterministic created-card/set IDs and
   converge under the server block/set uniqueness guards.
7. Pulling a block leaves it pending. Complete rejects zero performed sets,
   rejects manual-only performed sets, accepts target deviations on a valid
   confirmed source-derived set, and advances the derived next block; Skip
   resolves without creating performed history.
8. Attached/resolved source blocks cannot be edited or deleted through the
   repository. Future unattached blocks may still be edited under T01, and the
   source graph never changes when performed values are edited.
9. Query tests prove planning rows are excluded from existing session-list,
   stats, record, muscle/exercise analytics, and group-domain inputs.
10. A session created from a plan still participates normally once active or
    completed; only the separate plan rows remain excluded.
11. Reordering an exact set permutation persists dense performed order across
    reload, sync, and completed-session editing without changing row identity,
    source links, plan target order, values, or performance state; invalid,
    partial, duplicate, and cross-card lists fail atomically.

## Docs touched (required)

- `docs/specs/05-data-model.md`: repository/materialization as-built behavior.
- `docs/specs/09-project-structure.md`: add the `src/session-planner/` owner and
  boundary.
- `docs/specs/tech/session-planning-contract.md`: as-built module/functions,
  whole-plan/block transactions, compatible-card rules, set reordering,
  resolution behavior, and deviations.

## Testing and verification approach

- Add focused Jest tests alongside `src/session-planner/` and regression tests
  for existing analytics/session/group selectors. Cover warm-ups-first,
  planned-first then warm-up reordering, ambiguity, invalid reorder lists,
  autosave/hydration, and provenance preservation.
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
