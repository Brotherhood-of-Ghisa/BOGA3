# Historical Session Block Append + Effort

Status: planned

## Objective

Update the completed/historical session detail screen so the user can see each
set's effort and append one exercise block at a time into the current session.

## Context

The current completed-session detail screen has a workout-level `Append` action
that appends the entire historical workout as planned target rows. The desired
behavior is lower-granularity: each exercise block on the historical session
screen should expose its own append action.

The session recorder `Past blocks` panel is unrelated to this change and must
remain untouched.

## Scope

### In scope

- Show set `Effort` on `/completed-session/[sessionId]`.
- Move append from the sticky workout-level action bar to each historical
  exercise block/card.
- Extend the completed-session detail read model so each set carries `setType`.
- Add a block-scoped append data API.
- Merge appended planned rows into the first active exercise with the same
  `exerciseDefinitionId`.
- Update focused repository and screen tests.
- Update relevant UI docs for the changed completed-session detail behavior.

### Out of scope

- Schema or sync contract changes.
- Changes to the session recorder `Past blocks` panel.
- Keeping whole-workout append behavior on the completed-session detail screen.
- New route params or new navigation surfaces beyond the existing
  completed-session detail to recorder transition.

## UX Contract

### Key user flows

1. View historical set effort
   - Trigger: user opens a completed session detail screen.
   - Steps: user scans an exercise block's set table.
   - Success outcome: each set row shows `Set`, `Weight`, `Reps`, and `Effort`.
   - Failure/edge outcome: unspecified set type renders as `-`.

2. Append one historical exercise block
   - Trigger: user taps `Append` on a historical exercise block.
   - Steps: app appends that exercise block as planned target rows, then opens
     the session recorder.
   - Success outcome: only the selected exercise block is appended into the
     active session.
   - Failure/edge outcome: append errors remain inline on the detail screen and
     do not navigate away.

### Interaction and appearance notes

- Keep the sticky action bar for session-level actions only: `Edit` and
  `Delete`.
- Put `Append` in the exercise-card header area using the existing
  `SessionContentLayout.renderExerciseHeaderAction` hook.
- Effort labels should match existing set quality labels: `WUp`, `RIR 0`,
  `RIR 1`, `RIR 2`, and `-` for null.
- Reuse existing UI colors/styles in the completed-session detail screen; do not
  introduce raw color literals.

## Implementation Plan

### Completed-session detail UI

- Extend `CompletedSessionDetailSet` with `setType`.
- Populate `setType` from `loadSessionSnapshotById`; fallback fixture data may
  use null values unless a test needs explicit effort labels.
- Render an `Effort` column in the read-only set table.
- Remove the existing workout-level `Append` button from the sticky action bar.
- Add a per-exercise `Append` button via `renderExerciseHeaderAction`.
- Route successful append to `/session-recorder`, preserving the current
  transition.

### Data API

- Add `appendCompletedSessionExerciseAsPlanned(sourceSessionId,
  sourceSessionExerciseId, options?)` to the session draft repository and export
  it through `apps/mobile/src/data/index.ts`.
- Source validation:
  - source session must exist,
  - source session must be `completed`,
  - source exercise id must belong to that source session.
- Append behavior:
  - if no active draft exists, create one using the historical session gym and
    current timestamp;
  - if an active draft exists, preserve its gym and start time;
  - if the active draft already has an exercise with the same
    `exerciseDefinitionId`, append planned rows to the first matching exercise;
  - otherwise create a new planned exercise card;
  - historical sets become planned targets:
    - `weightValue`, `repsValue`, and `setType` are blank/null,
    - `plannedWeightValue`, `plannedRepsValue`, and `plannedSetType` copy the
      historical set,
    - `performanceStatus` is `planned`.

### Docs

- Update `docs/specs/ui/screen-map.md` for completed-session detail behavior.
- Update `docs/specs/ui/navigation-contract.md` if the existing append
  transition wording still describes whole-workout append.
- Update `docs/specs/ui/ux-rules.md` if button placement or historical-session
  detail semantics need to be documented as a UI rule.

## Acceptance Criteria

1. Completed-session detail displays `Effort` for historical sets.
2. The sticky action bar no longer shows workout-level `Append`.
3. Each historical exercise block has an `Append` action.
4. Appending a block appends only that block as planned target rows.
5. Appending into an active session merges by first matching
   `exerciseDefinitionId`.
6. Appending with no active session creates an active session.
7. Append failure feedback stays inline and does not navigate.
8. Recorder `Past blocks` behavior is unchanged.
9. Relevant UI docs are updated in the same implementation session.

## Testing and Verification

Planned checks:

- `./boga test fast`
- `./boga test frontend`

Focused test updates:

- `completed-session-detail-screen.test.tsx`
  - renders the `Effort` column and effort labels,
  - does not render the old workout-level append button,
  - renders one append button per exercise block,
  - calls the block-level append data client with `(sessionId, exerciseId)`,
  - navigates to `/session-recorder` on success,
  - keeps failure feedback inline on error.
- `session-drafts-repository.test.ts`
  - appends only the selected source exercise block,
  - merges planned rows into the first active matching exercise,
  - creates a new planned exercise card when no match exists,
  - rejects non-completed source sessions,
  - rejects source exercise ids not in the source session.

## Assumptions

- "Block" means one `session_exercises` row and its sets on the completed
  session detail screen.
- "Effort" is the user-facing label for `setType` on historical session detail.
- No data-model, migration, backend, or sync changes are required because
  `setType` already exists and is present in session snapshots.

## Evidence

- Not started.

## Completion Note

- What changed: pending.
- What tests ran: pending.
- What remains: implementation pending.
