# M29-T06-Completion_PRs_on_facts — Completed-session PRs read the facts table

- Status: `planned`
- Depends on: `M29-T01-Exercise_session_facts`
- Milestone: `docs/plans/milestones/M29-today-landing-page.md`
- Areas: frontend (session insights read path); UI impact: no visible change

## Objective

The completion screen, the completed-session route and the share preview get
their PR list (`personalRecords`) from the exercise session facts instead of
replaying every earlier session in `deriveSessionPersonalRecords`.

## Scope

- In: `loadCompletedSessionInsights` (`src/session-insights/repository.ts`)
  takes its PRs from `exercise_session_facts` (`pr_e1rm` rows of the session,
  plus each definition's earlier best for `historicalBestEstimatedOneRepMax`);
  Jest.
- Out: the volume and muscle comparisons, which still need the earlier
  sessions' graphs (decide in Open 1 whether they move too); the session view
  (T07); the exercise page and history (T08).

## Decided

- D9 (milestone) and spec 05 "Exercise session facts": the 1RM flag already
  equals `deriveSessionPersonalRecords` on every session, ties in session
  order.
- The visible PR list does not change: same sets, same order (first exercise
  order), same values.

## Open — resolve with the user at session start

1. The exercise volume comparison could read `volume_kg` / `volume_complete`
   from the facts too; the muscle comparison cannot. Move the exercise
   comparison in this PR, or keep loading the history graph for both?
2. Where the single 1RM best-set rule lives (Deliverable 4): moved into
   `src/exercise-calculations` and imported by both sides, or kept only in
   `src/data/exercise-session-facts-derive.ts` with the replay copy deleted?

## Deliverables and acceptance

1. `personalRecords` for a completed session come from the facts table; the
   existing session-insights and completion-screen tests pass unchanged.
2. Jest: the facts-backed list equals `deriveSessionPersonalRecords` on a
   generated history (reuse the T01 generator).
3. Measure `loadCompletedSessionInsights` before and after on the 10× dev
   rich history (T01's harness); record it in the PR body.
4. One implementation of the 1RM best-set rule (eligibility, strictly
   greater, ties in session order). Today it exists twice:
   `pickBestE1rm` in `src/data/exercise-session-facts-derive.ts` and
   `findBestPersonalRecordCandidate` in `src/session-insights/calculations.ts`,
   kept equal only by the differential test in
   `exercise-session-facts.test.ts`. Delete or replace the replay copy here,
   or leave a stated reason and hand it to T07, which then must finish it.

## Specs to update

- `docs/specs/03-technical-architecture.md`: the "pure derived projections"
  row for session insights.

## Gates

Expected from `./boga test for`: `fast` (+ the session-view lane if the
completion screen's flow is touched); before the PR `jest-coverage`,
`complexity` and `dependencies`.
