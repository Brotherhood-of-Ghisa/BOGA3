---
task_id: M24-T02-Live_recorder_muscle_load
milestone_id: "M24"
status: planned
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/screen-map.md, docs/specs/ui/components-catalog.md, docs/specs/ui/ux-rules.md"
---

# M24-T02 — Live recorder muscle load

## Task metadata

- Task ID: `M24-T02-Live_recorder_muscle_load`
- Status: `planned`
- Depends on: `M24-T01`

## Parent references

- Milestone: `docs/plans/milestones/M24-current-session-insights-and-pr-celebration.md`
- UX/UI: `docs/specs/08-ux-delivery-standard.md`,
  `docs/specs/ui/README.md`
- Recorder: `apps/mobile/app/(tabs)/session-recorder.tsx`,
  `apps/mobile/components/session-recorder/`
- Analytics: `apps/mobile/src/data/muscle-analytics.ts`
- Testing: `docs/specs/02-quality-and-test-gates.md`,
  `docs/specs/06-testing-strategy.md`

## Objective

Show a compact, trustworthy session-wide muscle-load signal in the active
recorder as soon as valid confirmed work exists, with detail available without
leaving the workout.

## Scope

### In scope

- Add the compact row above recorder-wide actions and the in-route detail sheet.
- Bind both to current in-memory session state and the shared T01 output.
- Implement absent, populated, partially mapped, unmapped, loading-error/retry,
  and live reversal states.
- Keep set entry, keyboard behavior, autosave, submit validation, and
  completed-edit mode independent from insight availability.

### Out of scope

PR visual changes/sharing, completion presentation, history range changes,
schema/backend/sync work, and fatigue/readiness interpretation.

## UX Contract

### Key user flows

1. **Reveal live muscle load**
   - Trigger: confirm the first valid performed set.
   - Steps: the session-wide row appears and reports contributing muscles plus
     physical performed/working set counts.
   - Success outcome: the user sees immediate feedback without leaving the
     recorder.
   - Failure/edge outcome: before confirmation the row is absent; unmapped work
     shows the explicit unmapped state only after confirmation.
2. **Inspect the session**
   - Trigger: tap `Session muscle load`.
   - Steps: a dismissible sheet lists all contributing muscles with exact values
     and relative bars.
   - Success outcome: the user can understand the current session's distribution
     and return to logging at the same scroll/edit state.
   - Failure/edge outcome: mapping/catalog failure stays in the sheet with Retry
     and never blocks recorder actions.
3. **Reverse performed work**
   - Trigger: edit, unconfirm, or remove a contributing set.
   - Steps: the row and open sheet recompute immediately.
   - Success outcome: stale muscle load is never displayed.
   - Failure/edge outcome: when no valid confirmed set remains, the row and sheet
     close/vanish without extra instructional copy.

### Interaction + appearance notes

- Reuse `UiSurface`, `UiText`, shared buttons, sheet/scrim behavior, spacing,
  type, and semantic color tokens.
- Keep the row outside exercise cards so its session scope is visually clear.
- Bars are decorative, session-relative, and accompanied by exact accessible
  values; color is never the sole signal.
- Preserve recorder scroll position, expanded set, keyboard, and modal state.
- No raw color literals or new navigation route are planned.

## Acceptance criteria

1. All three flows match the milestone contract with RNTL/Jest coverage.
2. No muscle-load UI or prompt exists before the first valid confirmation.
3. Set/muscle/volume values match T01 output and update synchronously with
   recorder mutations.
4. Unmapped and catalog-error states are distinguishable and non-blocking.
5. Sheet dismissal restores the unchanged recorder editing context.
6. Completed-edit mode does not accidentally show a "current session"
   celebration unless the milestone contract explicitly extends it later.
7. Shared tokens/primitives are used and no raw color literal is introduced in
   route/component `.tsx` files.
8. Relevant UI docs are updated with synthetic, source-linked behavior.

## Docs touched

- UI docs update required: **yes**.
  - `docs/specs/ui/screen-map.md`: recorder row/sheet and edge states.
  - `docs/specs/ui/components-catalog.md`: reusable muscle-summary components.
  - `docs/specs/ui/ux-rules.md`: progressive reveal, session scope, and bar
    semantics.
- `docs/specs/ui/navigation-contract.md`: no update expected because the sheet
  is in-route state.
- Tokens/primitives reuse: existing UI surfaces, text, actions, scrim/sheet, and
  semantic colors; exceptions none planned.
- Required captures: pre-confirmation, populated row, open sheet, unmapped,
  error/retry, and reversal on small and large phone viewports.

## Testing and verification approach

- Add focused recorder component/integration coverage.
- Run `./boga test fast` and `./boga test frontend` before PR.
- Extend a recorder Maestro flow or add a focused flow for reveal, inspect,
  dismiss, and reversal.
- Run `./boga test for --diff origin/main`; use only measured gate durations.

## Evidence

## Completion note

- What changed:
- What tests ran:
- What remains:
