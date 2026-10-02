# M29-T08-Exercise_records_on_facts — Exercise page and history records read the facts table

- Status: `planned`
- Depends on: `M29-T01-Exercise_session_facts`
- Milestone: `docs/plans/milestones/M29-today-landing-page.md`
- Areas: frontend (exercise records read path); UI impact: no visible change

## Objective

The exercise page's records panel (`src/session-recorder/exercise-records.ts`,
via `useExerciseRecords`) and exercise history's bests
(`src/data/exercise-history.ts`) recompute all-time 1RM, heaviest weight and
best session volume from the exercise's full completed history. Read those
bests from the facts table instead.

## Scope

- In: the all-time records (1RM, top weight, best volume) and the place each
  was set; Jest.
- Out: the per-session list and charts on exercise history, which still read
  sets; the session view (T07); the completion screen (T06).

## Decided

- The facts' metric rules are the existing ones (spec 05 "Exercise session
  facts"), so the values must not change.

## Open — resolve with the user at session start

1. Record ties. Facts give a tied top weight to more reps and then to session
   order; the records panel and `exercise-history.ts` may pick the earliest or
   latest session on a tie across sessions. Check, and pick one rule.
2. The records panel shows the set (weight × reps) and the gym. The facts hold
   the set id; join the set and session for those, or keep reading them as
   today?
3. Best volume: the facts keep incomplete volumes as known subtotals. Does the
   panel's "best session volume" ignore incomplete sessions as the volume PR
   rule does?

## Deliverables and acceptance

1. Records read from the facts table; existing exercise-page and
   exercise-history tests pass unchanged.
2. Jest: records from the facts equal the old derivation on a generated
   history.

## Specs to update

- `docs/specs/ui/ux-rules.md` §14a.4 only if Open 1 or 3 changes a visible
  rule.

## Gates

Expected from `./boga test for`: `fast` + `frontend-ui` (the exercise-page
lane); before the PR `jest-coverage`, `complexity` and `dependencies`.
