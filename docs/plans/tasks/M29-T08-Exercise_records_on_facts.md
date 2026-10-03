# M29-T08-Exercise_records_on_facts — Exercise page and history records read the facts table

- Status: `planned`
- Depends on: `M29-T01-Exercise_session_facts`, `M30-T01-Working_set_rule_and_records`
- Milestone: `docs/plans/milestones/M29-today-landing-page.md`
- Areas: frontend (exercise records read path); UI impact: the `Vol` detail
  counts working sets (M30 D4); otherwise none

## Objective

The exercise page's records panel (`src/session-recorder/exercise-records.ts`,
via `useExerciseRecords`) and exercise history's bests
(`src/data/exercise-history.ts`) recompute all-time 1RM, heaviest weight and
best session volume from the exercise's full completed history. Read those
bests from the facts table instead.

## Scope

- In:
  - The all-time records (1RM, top weight, best volume) and where each was set.
  - The current-gym filter and the excluded session being edited.
  - Exercise history's `All-time bests`, including its gym filter (with
    `No gym`).
  - The records panel's `Last`: the newest fact row that passes the filters
    names the session, and only that session's sets are loaded.
  - Jest.
- Out: the per-session list and charts on exercise history, which still read
  sets; the session view (T07); the completion screen (T06).

## Decided

- The facts' metric rules are the ones spec 05 "Exercise session facts" states
  once M30-T01 lands (working sets only), so the values equal the records
  derivation under that rule.
- **Ties across sessions go to the earliest session**, on both the records
  panel and exercise history. Exercise history today keeps the latest session,
  so that changes. Top weight first prefers more reps.
- **The set and the gym** come from joining the best set (`*_set_id`) and the
  session: one query, with weight × reps and the gym name.
- **Best volume** considers only rows with `volume_complete`, as today.
- **The `Vol` record's "N sets"** is the record session's `working_sets`
  (M30 D4).
- Exercise history's `aggregateExerciseHistory` stops taking
  `sessionsAllTime`; the repository supplies the bests. Its pure tests get new
  inputs, with the same expected values (apart from the tie change above).

## Open — resolve with the user at session start

M30-T01 (merged) settled these, which the facts read must keep:

- `Last` is the newest session with a working set: a warm-up-only session is
  skipped. Its set list still shows that session's warm-up lines.
- `LastSession.maxWeight` is the heaviest working set; the collapsed `Max`
  reads it, not `sets`.
- The `Vol` record's "N sets" already counts working sets.
- `ExerciseHistorySessionEntry.estimatedOneRepMax` / `topWeightSet` already
  read working sets only.

Open, added by T07: the session view's live record marker now counts only the
sessions before the viewed one (spec 05, "Live record markers"). The exercise
page's all-time records, opened from a completed edit, still count later
sessions (`excludeSessionId` drops only the edited one). Keep that as an
all-time view, or match T07? Confirm with the user.

## Deliverables and acceptance

1. Records read from the facts table; existing exercise-page and
   exercise-history tests pass unchanged.
2. Jest: records from the facts equal the old derivation on a generated
   history.

## Specs to update

- `docs/specs/ui/ux-rules.md` §14a.4 (records read from the facts; ties go to
  the earliest session) and the `All-time bests` item (exercise history ties).

## Gates

Expected from `./boga test for`: `fast` + `frontend-ui` (the exercise-page
lane); before the PR `jest-coverage`, `complexity` and `dependencies`.
