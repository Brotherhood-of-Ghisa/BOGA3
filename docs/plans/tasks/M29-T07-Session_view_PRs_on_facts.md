# M29-T07-Session_view_PRs_on_facts — Session view PRs read earlier bests from the facts table

- Status: `planned`
- Depends on: `M29-T01-Exercise_session_facts`; run after T06 (both touch
  `src/session-insights/`)
- Milestone: `docs/plans/milestones/M29-today-landing-page.md`
- Areas: frontend (session recorder read path); UI impact: no visible change

## Objective

The session view (active and completed-edit) shows live PRs against each
exercise's best from earlier sessions. Today it reads that best twice:
`loadHistoricalBestsExcluding` (`src/session-recorder/historical-bests.ts`,
recent blocks per exercise) and `loadSessionInsightHistory` (every earlier
session's graph). Read the earlier best from the facts table instead.

## Scope

- In: the historical-best read behind the live PR markers; Jest.
- Out: the volume and muscle comparisons in the session view (they need the
  history graph unless T06 moved the exercise comparison); the completion
  screen (T06); the exercise page (T08).

## Decided

- The earlier best is the max `best_e1rm_kg` of the definition's facts in
  sessions other than the current one. Active sessions have no facts. When
  editing a completed session, exclude its own row.
- No visible change: same markers on the same sets.

## Open — resolve with the user at session start

1. "Earlier" today means every other completed session for
   `loadHistoricalBestsExcluding`, but sessions before this one for
   `loadSessionInsightHistory`. When editing an old completed session, which
   does the live marker use? Pick one rule for both and say so in spec 05.
2. Keep `historicalBestOneRepMax` (pure) for the in-session comparison, or
   fold it into the facts read?

## Deliverables and acceptance

1. The live PR bar reads earlier bests from the facts table; existing
   session-view tests pass unchanged.
2. Jest covers active and completed-edit sessions, and an exercise with no
   earlier facts (no marker).

## Specs to update

- `docs/specs/05-data-model.md` "Exercise session facts" if Open 1 changes
  which sessions count as earlier.

## Gates

Expected from `./boga test for`: `fast` + `frontend-ui` (the session-view
lane); before the PR `jest-coverage`, `complexity` and `dependencies`.
