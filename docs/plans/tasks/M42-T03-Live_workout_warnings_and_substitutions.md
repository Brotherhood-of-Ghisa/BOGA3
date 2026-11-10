# M42-T03 — Live workout warnings and substitutions

- Status: `planned`
- Depends on: [M42-T01](M42-T01-Injury_contract_and_sync_schema.md), [M42-T02](M42-T02-Mobile_injury_management_ui.md)
- Milestone: [M42](../milestones/M42-injury-and-discomfort-tracking.md)
- Areas: frontend, session recorder; UI impact: yes

## Objective and scope

Provide real-time injury awareness during active workouts by displaying tiered,
non-blocking alerts on exercises that stress injured muscles/sides, session-level
dismissal to avoid alert fatigue, curated movement substitutions, and 1-tap
abort reasons with injury logging prompts. Follow milestone D1 and D3. This
task does not modify set-level metric calculations or PR history.

## Baseline to verify

Inspect `apps/mobile/src/session-recorder/` (`use-session-view.ts`,
`session-view-model.ts`, `session-lifecycle.ts`), `SessionExerciseCard` in
`apps/mobile/components/session-view/session-exercise-card.tsx`, and
exercise swap sheet in `apps/mobile/components/exercise-page/exercise-swap-sheet.tsx`.
Review `exercise_muscle_mappings` queries in `apps/mobile/src/exercise-catalog/`.

## Open — resolve before coding

- Matching heuristic: when does an exercise trigger a warning?
  - Exercise primary or secondary muscle matches active injury `muscle_group_id`.
  - Side matching: unilateral exercise side matches injury side, or bilateral
    exercise involves an injured side.
- Tiered presentation and dismissal:
  - `acute`: prominent warning banner above set entry stating the injury label,
    days since onset, and pain triggers. Tapping dismiss offers "Dismiss for
    this session" to prevent repeated alerts across remaining sets.
  - `managing` or `monitoring`: compact indicator badge on exercise header
    without intrusive banners to avoid alert fatigue during long rehab cycles.
- Curated substitution logic:
  - Curated replacement catalog for major compound movements (e.g. Barbell Back
    Squat → Box Squat / Leg Press; Barbell Bench Press → Neutral-Grip DB Press;
    Deadlift → Trap Bar / Romanian Deadlift).
  - General fallback: filter exercises by matching primary muscle while
    offering equipment/joint-friendly alternatives (machines, dumbbells),
    leaving final selection in the athlete's control.
- In-session entry points and skip reasons:
  - Exercise card kebab menu includes "Report Discomfort / Injury" launching
    the injury modal from T02.
  - When skipping an exercise, provide 1-tap reason "Discomfort / Injury flare-up"
    with an immediate prompt to log or check in on the injury.

## Deliverables and acceptance

1. Hook in session recorder resolving active injury warnings for all exercises
   in the active session without blocking main thread rendering.
2. Tiered in-workout UI: prominent warning banner for `acute` injuries (with
   "Dismiss for this session") and subtle header badges for `managing` status.
3. Substitution sheet suggesting curated and muscle-matching alternative
   exercises, swapping the block in the active session graph safely.
4. Skip/Abort dialog option recording discomfort as the skip reason with 1-tap
   launch of the injury check-in sheet.
5. In-session exercise kebab menu affordance to report discomfort/injury.
6. Unit and component tests proving warning triggers, side awareness, session
   dismissal state, and safe block replacement.

## Gates

Expected from `./boga test for`:
`fast` | `frontend-ui` (or platform default)
