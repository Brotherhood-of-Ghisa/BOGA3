# M30-T01-Working_set_rule_and_records — The working-set rule, and records that follow it

- Status: `planned`
- Depends on: none
- Milestone: `docs/plans/milestones/M30-working-sets-only-stats.md`
- Areas: frontend (calculation layer, records, PRs, facts); UI impact: yes
  (record and PR values; no layout change)

## Objective

Introduce one shared predicate for "counts toward stats" (M30 D1, D5) and move
every **record, PR and best** onto it:

- the exercise session facts, at rules version 3;
- the completion and share-image PRs;
- the session view's and View Session's record band and baselines;
- the exercise page's records panel and live row highlights;
- exercise history's all-time bests.

A warm-up is never a record or a baseline. Its row keeps its own figures (D3).

## Scope

- In:
  - The predicate in `src/exercise-calculations/`.
  - Removing the dead `includeWarmUps` option (`index.ts`) and its tests.
  - `exercise-session-facts-derive.ts`: bests, volume and PR flags read working
    sets only; no row without a working set (D2); `EXERCISE_SESSION_FACTS_RULES_VERSION = 3`.
  - `src/session-insights/calculations.ts` PR paths:
    `findBestPersonalRecordCandidate`, `deriveExercisePersonalRecord`,
    `deriveSessionPersonalRecords` and `collectHistoricalBestByExerciseDefinition`.
  - `src/session-recorder/historical-bests.ts` / `exercise-block-history.ts`
    bests: the PR baseline.
  - `exercise-records.ts`: records, `Last` and `recordBaselineOf`.
  - The exercise-page row highlight (`exercise-page-model.ts`).
  - `exercise-history.ts` `computeBest`.
  - The rule specs: `ux-rules.md` §5.11 :207, :755 and :761;
    `design-language.md` :318–321; `05-data-model.md` :134 (facts);
    `bodyweight-load-contract.md` :110.
- Out:
  - Volume, heatmap, muscle, comparison, favourite and "done" aggregates (T02).
  - Set-count labels (T03).
  - The agent API (T04).
  - Groups (T05).
  - Moving readers onto the facts (M29-T06–T08).

## Decided

- M30 D1, D3, D5 and D7.
- The kernel's per-set metrics (`calculateSetMetrics`) are unchanged.
- The records panel's `Last` view and its per-set lines keep warm-up rows (D3);
  its 1RM, max and volume summary read working sets only.

## Open — resolve with the user at session start

1. The predicate's name and home. For example, `countsTowardStats(set)` next to
   `isConfirmedPerformedSet`, or `isWorkingSet`. Also whether
   `summarizeExerciseLoad` filters internally, which changes `agent-api` on its
   next deploy (M30 risk "edge-function coupling"), or whether callers filter.
2. Records-panel `Last` when the previous session had only warm-ups on this
   exercise. Under D2 it is not a session for this exercise, so `Last` skips to
   the one before. Confirm.

## Deliverables and acceptance

1. One predicate; every PR, record and best path above uses it. A grep for
   eligibility checks that bypass it in those files comes back empty.
2. Facts rules version 3. The facts' 1RM flags equal
   `deriveSessionPersonalRecords` on a generated history with warm-ups heavier
   than the working sets.
3. Jest: each PR or record surface has a warm-up-heavier-than-working case
   asserting the warm-up is neither the record nor the baseline, and that its
   row figures still render. Existing warm-up tests flip, none are deleted.
4. The specs above state the new rule; `docs-check` passes.

## Specs to update

- `docs/specs/ui/ux-rules.md` §5.11 (the rule itself), :755 and :761.
- `docs/specs/ui/design-language.md` :318–321.
- `docs/specs/05-data-model.md` "Exercise session facts" (eligibility, version 3).
- `docs/specs/tech/bodyweight-load-contract.md` :110.

## Gates

Expected from `./boga test for`: `fast` + `frontend-ui` (the exercise-page and
session-view lanes). Before the PR: `jest-coverage`, `complexity` and
`dependencies`.
