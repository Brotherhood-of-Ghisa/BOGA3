# M42-T03 — Live workout warnings and substitutions

- Status: `planned`
- Depends on: [M42-T01](M42-T01-Injury_contract_and_sync_schema.md), [M42-T02](M42-T02-Mobile_injury_management_ui.md)
- Milestone: [M42](../milestones/M42-injury-and-discomfort-tracking.md)
- Areas: frontend, session recorder; UI impact: yes

## Objective and scope

Provide real-time injury awareness during active workouts by displaying
non-blocking warning banners on exercises that stress injured muscles/sides,
enabling 1-tap movement pattern substitutions, and offering 1-tap abort
reasons when exercises are skipped. Follow milestone D1 and D3. This task
does not modify set-level metric calculations or PR history.

## Baseline to verify

Inspect `apps/mobile/src/session-recorder/` (`use-session-view.ts`,
`session-view-model.ts`, `session-lifecycle.ts`), `SessionExerciseCard` in
`apps/mobile/components/session-view/session-exercise-card.tsx`, and
exercise swap sheet in `apps/mobile/components/exercise-page/exercise-swap-sheet.tsx`.
Review `exercise_muscle_mappings` queries in `apps/mobile/src/exercise-catalog/`.

## Open — resolve before coding

- Matching heuristic: when does an exercise trigger a warning?
  - Exercise primary or secondary muscle matches active injury `muscle_group_id`
    AND injury status is `acute` or `managing`.
  - Side matching: unilateral exercise side matches injury side, or bilateral
    exercise involves an injured side.
- Warning presentation: compact, dismissible alert chip/banner above set entry
  stating the active injury label, days since onset, and pain triggers.
- Substitution logic: filter exercises by matching primary muscle while
  excluding the aggravated movement or equipment (e.g. Barbell Back Squat → Box
  Squat or Leg Press; Barbell Bench Press → Neutral-Grip DB Press).
- Abort / skip reason: when skipping an exercise, provide a 1-tap reason:
  "Discomfort / Injury flare-up".

## Deliverables and acceptance

1. Hook in session recorder resolving active injury warnings for all exercises
   in the active session without blocking main thread rendering.
2. Subtle in-workout warning banner rendered on affected exercise cards.
3. Substitution sheet suggesting alternative exercises that spare the affected
   muscle/side, swapping the block in the active session graph safely.
4. Skip/Abort dialog option recording discomfort as the skip reason.
5. Unit and component tests proving warning triggers, side awareness, and safe
   block replacement.

## Gates

Expected from `./boga test for`:
`fast` | `frontend-ui` (or platform default)
