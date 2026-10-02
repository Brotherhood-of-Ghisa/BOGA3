# M30-T05-Group_results_working_sets — Group results ignore warm-ups, from now on

- Status: `planned`
- Depends on: `M30-T01-Working_set_rule_and_records`
- Milestone: `docs/plans/milestones/M30-working-sets-only-stats.md`
- Areas: backend (migrations, `group-eval`), shared `src/groups/`; UI impact: no
  (values only)

## Objective

New and re-evaluated group results count working sets only (M30 D1):

- contract-1 boards (`group_board_counting` / `group_board_compute`);
- contract-2 metric scores and boards: `group_metric_eval_source_graph` does not
  carry `set_type` today, and `scoreGroupPerformance` ignores it;
- records, lead changes and certifications (`group_certify` /
  `group_metric_certify` must not attest a warm-up);
- the group week summary's `exercise_count` (D2).

Existing stored results stay as they are (D6, forward only).

## Scope

- In:
  - A new migration that redefines the functions above.
  - `src/groups/{set-facts,performance-score,metric-evaluation}.ts`.
  - `group-eval` if needed.
  - `groups-contract.md` §2.10–§2.11, §4.7 (:1264) and §11.2 (:2387–2394).
  - Server tests: `groups-week-summary.sh`, `groups-leaderboards.sh`, plus new
    warm-up cases in the boards and certification suites.
- Out:
  - Requeueing, backfilling or voiding existing results (D6).
  - The stream card and friend session values, which are computed on the
    client (T02/T03).

## Decided

- M30 D1, D2 and D6. No requeue loop, no backfill, no mass void.
- `group_set_facts.working` already exists (rules version 4) and is the filter
  input for contract 1.

## Open — resolve with the user at session start

1. Whether `GROUP_EVAL_RULES_VERSION` is bumped. A bump normally drives a
   requeue, which D6 rules out, so say what the version marks instead.
2. What the evaluator emits when re-evaluating a member drops a board value
   held by a warm-up: a lead change, a void with a new reason (`rules`?), or a
   silent board move. A `record` event must never be fabricated, and void
   reasons today are only `edited` and `deleted`.
3. Whether certifying a warm-up is rejected with an error or simply impossible
   because the set has no score.

## Deliverables and acceptance

1. Server tests: a warm-up heavier than every working set never wins a board,
   never makes a record and cannot be certified. Stored pre-change results are
   untouched by the migration.
2. Jest for the shared `src/groups/` changes.
3. `groups-contract.md` states the rule and the forward-only boundary.

## Specs to update

- `docs/specs/tech/groups-contract.md`, the sections listed above.

## Gates

Expected from `./boga test for`: `fast` + `backend` + `groups-api-live` +
`ios-groups-e2e`.
