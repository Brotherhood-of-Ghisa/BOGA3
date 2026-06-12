# UX Delivery Standard (v0)

> **Owns:** the UX delivery process, iteration loop, and evidence standard. **Not here:** concrete UI rules and inventories → `docs/specs/ui/`. **Load when:** any UI work.

## Purpose

Define a repeatable, lightweight process for specifying and iterating on UX quality and visual appearance for MVP UI work.

## Scope

Applies to all user-facing mobile UI tasks across screens, components, and cross-screen flows.

## Relationship to the UI docs bundle (`docs/specs/ui/**`)

Use `docs/specs/ui/README.md` as the entrypoint for app-specific UI documentation (screen map, navigation contract, components catalog, app-specific UX rules).

Document boundary:

1. This document (`08`) owns cross-task UX process, task contract expectations, UX quality principles, and reusable UX patterns.
2. `docs/specs/ui/**` owns current app-specific UI reality (routes, navigation behavior, reusable UI component inventory, app-specific semantics/guardrails).
3. UI docs under `docs/specs/ui/**` should stay synthetic/overview-first and source-linked:
   - summarize what exists and why it matters,
   - avoid duplicating source-file prop/API details unless a compact contract summary is needed.
4. If a UI task changes app-specific UI behavior/docs, update the relevant `docs/specs/ui/*.md` files in the same session.
   - Use `docs/specs/ui/README.md` (`Maintenance rules`) as the canonical trigger map for which UI docs to update.
5. Update this document in the same task only when the change affects shared UX process/pattern standards (not just one screen/component implementation).

## UX consistency and pattern management

1. Maintain a living `UX patterns` section in this document.
2. Reuse existing patterns by default before introducing new interaction/visual patterns.
3. If a task introduces a new pattern, updating the `UX patterns` section is required in the same task.
4. If a task intentionally deviates from an existing pattern, record rationale and impact in the task card.

## UX quality principles

1. Clarity first: primary action and primary data should be obvious within 3 seconds.
2. Fast entry: common actions should require minimal taps and minimal context switching.
3. Stable behavior: user actions should produce immediate, predictable feedback.
4. Mobile ergonomics: controls must be thumb-friendly and readable on small screens.
5. Progressive disclosure: advanced/secondary controls should not overwhelm the default path.

## Required task-level UX contract

For UI/UX tasks, include a `UX Contract` section in the task card.  
For non-UX tasks, remove the `UX Contract` section from the task card.

Each UI task card UX contract must include:

1. Key user flows (minimal template):
   - One small block per flow:
     - `Flow name`
     - `Trigger`
     - `Steps`
     - `Success outcome`
     - `Failure/edge outcome`
2. Interaction + appearance notes (lightweight):
   - Keep this compact (prefer <= 5 bullets total).
3. Evidence + completion notes:
   - Fill under the task card `Evidence` and `Completion note` headers.
   - Follow the verification expectations in `docs/specs/02-quality-and-test-gates.md`.

Notes:

1. Keep `Key user flows` as the single source of truth for UX behavior in the task.
2. Do not create separate `Key interactions` or `Required states` sections.
3. If needed, include interaction details and state transitions directly in each flow's `Steps` and outcomes.

## UX patterns

Use this section as the single source of truth for reusable UX patterns.

1. Seeded picker pattern
   - Intent: choose one item from a short static list with low friction.
   - Usage: location and exercise preset selection.
   - Rules: show current value, keep options human-readable, and confirm selection immediately in UI state.
2. Editable list row pattern
   - Intent: rapidly add/update/remove repeated entities in a form-like list.
   - Usage: exercises, sets, and user-added mock locations.
   - Rules: stable row identity, inline edit affordance, and explicit remove action.
3. Destructive action safety pattern
   - Intent: prevent accidental data loss in edit flows.
   - Usage: delete location/exercise/set actions.
   - Rules: clear destructive styling, confirm intent when risk is meaningful, and provide immediate feedback after action.

## Default appearance baseline (MVP)

1. Layout
   - No horizontal scrolling on phone widths.
   - Content remains usable on small phone viewport widths.
   - Preserve spacing rhythm (prefer 8pt-based increments).
2. Typography
   - Body and input text should remain readable without zoom.
   - Titles and section labels should be visually distinct from body text.
3. Touch targets
   - Primary interactive elements must meet mobile tap-target expectations.
   - Destructive actions must be visually distinguishable from primary actions.
4. Feedback
   - Validation errors are shown near relevant fields.
   - Success and destructive outcomes provide explicit confirmation feedback.
5. Accessibility baseline
   - Meaningful accessibility labels for primary controls.
   - Color is not the only channel for errors or destructive intent.

## UX iteration loop (required for UI tasks)

1. Specify:
   - Write the task-level `UX Contract` before implementation.
   - Review existing `UX patterns` and decide whether task reuses or extends patterns.
2. Build smallest slice:
   - Implement only enough UI/state to run the first happy-path check.
3. Visual review pass:
   - Check hierarchy, spacing, and readability on small and large phone layouts.
4. Interaction review pass:
   - Verify add/edit/remove/submit flows and state transitions.
5. Refine:
   - Address top UX issues first (clarity, errors, destructive safety, density).
6. Verify:
   - Run targeted tests, then `npm run lint`, `npm run typecheck`, `npm run test`.
7. Closeout:
   - Record what changed and UX evidence in task completion note.
   - If new patterns were introduced, update the `UX patterns` section in this document.

## Evidence requirements for task closeout

Every completed UI task must provide:

1. Test evidence:
   - At least one happy-path interaction assertion.
   - At least one failure/error-path assertion.
2. Visual evidence:
   - Screenshots or equivalent captures for key happy-path and failure/edge flows covered by task scope.
3. Contract traceability:
   - Brief mapping from `UX Contract` items to implemented behavior/tests.
4. Pattern maintenance evidence:
   - If a new pattern was introduced, include the corresponding update to the `UX patterns` section.

## Stop-ship UX conditions

Do not mark a UI task complete if any are true:

1. Primary user action is ambiguous or requires workaround steps.
2. One or more key user flows in the UX contract are unimplemented.
3. Validation/destructive flows are missing clear user feedback.
4. Required UX evidence is missing from the completion note.
5. Task introduced a new UX pattern without updating `UX patterns`.

## Adoption notes

1. This standard complements `docs/specs/06-testing-strategy.md` and the `AGENTS.md` workflow router.
2. For app-specific UI inventory/navigation/component docs, use `docs/specs/ui/README.md` and the linked UI docs bundle.
3. If a UI task needs exceptions, record them explicitly in that task card with reason and impact.
