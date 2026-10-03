# M30-T02-Working_set_measures — Volume, heatmaps and usage read working sets only

- Status: `planned`
- Depends on: `M30-T01-Working_set_rule_and_records`
- Milestone: `docs/plans/milestones/M30-working-sets-only-stats.md`
- Areas: frontend (local analytics); UI impact: yes (values only)

## Objective

Every local **measure** other than records reads working sets only, through
T01's predicate:

- volume (session, exercise, muscle, totals) and the volume coverage note;
- daily and weekly heatmaps (exercise and muscle), including whether a
  warm-up-only day makes a cell;
- muscle analytics and failure intensity;
- the completion and session-view comparisons (current, median and P5–P95);
- catalog stats: "done", `Last:`, favourites recency, per-period session
  counts, volume and 1RM;
- the client-side group session metrics (friend session and stream card
  volume).

## Scope

- In:
  - `exercise-analytics.ts`, `muscle-analytics.ts`, `stats.ts` (volume and
    session counts) and `exercise-catalog-stats.ts`.
  - `session-insights/calculations.ts`: comparisons and muscle load.
  - `session-view-model.ts` and `completed-session-detail-model.ts` summary
    volume.
  - `exercise-history.ts` per-session `Vol` (T01 already moved the per-session
    1RM and `Top set`, since the all-time bests read them).
  - `exercise-block-history.ts` aggregates other than the 1RM and top weight
    (T01 moved those: they are the PR baseline). Whether a warm-up-only block
    stays in the list is this task's call (D2).
  - The muscle-load and comparison Jest cases that still assert "warm-ups
    included" (`session-insights.test.ts`, `session-view-model.test.ts`).
  - `groups/session-metrics.ts` volume.
  - `analytics.ts` coverage note ("X of Y working sets").
  - Specs: `ux-rules.md` :180, :809 and the comparison rules;
    `screen-map.md` :216–217; `05-data-model.md` :439;
    `groups-contract.md` :1318–1319 (stream volume).
- Out:
  - Set counts and their labels (T03); this task leaves every count's value
    and label alone.
  - Records and PRs (T01).

## Decided

- M30 D1, D2 and D5.
- A warm-up-only exercise is not done, has no `Last:` and adds no recency (D2).

## Open — resolve with the user at session start

1. Per-exercise and muscle `sessionCount`: whether a session counts only when
   it has a working set for that exercise or muscle (D2 says yes per exercise;
   confirm per muscle).
2. The coverage note's wording once its denominator is working sets.

## Deliverables and acceptance

1. Each listed aggregate ignores warm-ups. Each feature's Jest has a
   warm-up-only and a mixed case.
2. Existing warm-up-inclusive tests flip to the new rule; none are deleted.
3. Values on Progress, exercise history, the completion screen and the session
   view match a hand-computed working-set-only fixture.

## Specs to update

The lines listed under Scope.

## Gates

Expected from `./boga test for`: `fast` + `frontend-ui` (Progress, exercise
history, session view and completion lanes). Before the PR: `jest-coverage`,
`complexity` and `dependencies`.
