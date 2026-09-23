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
3. `docs/specs/ui/ai-design-policy.md` owns design-source selection, accepted
   design targets, artifact boundaries, generated-code integration, and visual
   comparison requirements for human- or AI-assisted design work.
4. UI docs under `docs/specs/ui/**` should stay synthetic/overview-first and source-linked:
   - summarize what exists and why it matters,
   - avoid duplicating source-file prop/API details unless a compact contract summary is needed.
5. If a UI task changes app-specific UI behavior/docs, update the relevant `docs/specs/ui/*.md` files in the same session.
   - Use `docs/specs/ui/README.md` (`Maintenance rules`) as the canonical trigger map for which UI docs to update.
6. Update this document in the same task only when the change affects shared UX process/pattern standards (not just one screen/component implementation).

## UX consistency and pattern management

1. Maintain a living `UX patterns` section in this document.
2. Reuse existing patterns by default before introducing new interaction/visual patterns.
3. If a task introduces a new pattern, updating the `UX patterns` section is required in the same task.
4. If a task intentionally deviates from an existing pattern, record rationale and impact in the PR body (Deviations).

## UX quality principles

1. Clarity first: primary action and primary data should be obvious within 3 seconds.
2. Fast entry: common actions should require minimal taps and minimal context switching.
3. Stable behavior: user actions should produce immediate, predictable feedback.
4. Mobile ergonomics: controls must be thumb-friendly and readable on small screens.
5. Progressive disclosure: advanced/secondary controls should not overwhelm the default path.

## Required task-level UX contract

For UI/UX work, write a `UX Contract` before building: in the plan or task
card if the work has one (`docs/plans/`, optional), otherwise in the PR body.
Non-UX work needs none.

For a significant UI task, record the accepted design target defined by
`docs/specs/ui/ai-design-policy.md` beside the UX Contract.

Each UX contract must include:

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
   - Record them in the PR body (Tests / Deviations), with screenshots linked.
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
4. Collapsible summary card pattern
   - Intent: reduce vertical density while retaining the facts needed to identify and compare repeated content.
   - Usage: exercise cards in completed-session detail and a group member's session (`components/groups/friend-session-content.tsx`).
   - Rules: cards start expanded, the title region is a minimum-size accessible toggle, collapse hides detail without changing domain data, and the collapsed state shows only validated summary facts. Actions that require the hidden content to be visible must expand the card.
5. Explicit row confirmation pattern
   - Intent: keep entered/defaulted values separate from the user's assertion that a repeated item was actually completed.
   - Usage: normal and prescribed set rows on the exercise page, for an active or a completed session (`components/exercise-page/set-row.tsx`).
   - Rules: use a dedicated mobile-sized checkbox-like target independent of row editing; show distinct unchecked and checked shapes so color is supplemental; confirm only valid values; allow confirmation to be undone without clearing values; exclude unchecked items from completion metrics; require an explicit discard decision when valid unchecked work would be removed at submit/save; and keep source identity separate from confirmation status (for example, inactive planned rows use a semantic surface and accessible source wording remains available when the shared selected-row surface temporarily overrides it, while the hollow/tick control communicates performance).
6. Stream card pattern
   - Intent: scan other people's recent activity at a glance and drill into one item.
   - Usage: group stream session cards (`components/groups/stream-session-card.tsx`).
   - Rules: a collapsed summary card (pattern 4) with no expand; the whole card is one accessible press target that navigates to the detail; show who, a status pill (text, not color alone — "Training now" or "Completed · duration"), when/where, and the validated summary metrics; newest first; secondary events (joined / left) are lighter rows, not cards.
7. Offline marker pattern
   - Intent: keep cached server data usable offline without hiding that it may be stale.
   - Usage: every group read screen (`components/groups/offline-banner.tsx`).
   - Rules: a warning-surface banner above the content reads `Offline · last updated HH:MM` (local time of the cached payload); cached data stays visible; with no cache, show an offline empty state instead of a spinner; the marker clears on the next successful refresh.
8. Pull-to-refresh pattern
   - Intent: an explicit, familiar refresh for server-backed lists that also refresh automatically.
   - Usage: group lists and screens (`RefreshControl`).
   - Rules: only a user pull shows the spinner; automatic refreshes (focus, polling) stay silent; a failed pull surfaces through the offline marker or the inline error with `Retry`, never a blocking dialog.
9. Online-only write pattern
   - Intent: writes to shared server data either happen now or visibly do not happen — never silently queued.
   - Usage: every group write (`src/groups/use-group-action.ts`, `components/groups/write-notice.tsx`).
   - Rules: refuse before any request when offline; show the failure inline next to the action saying nothing changed; keep the screen's data and form input as they were; no queue, no automatic retry; destructive writes confirm first (pattern 3). Wording and scope: `ui/ux-rules.md` §14.
10. Secondary-source search section pattern
   - Intent: let a search reach items from another source without crowding the default list.
   - Usage: the session view's exercise picker's `From your groups` section and `Groups` toggle (M25-T07; `components/groups/picker-group-section.tsx`).
   - Rules: the default (empty-search) list never shows the secondary source; with search text its matches follow the user's own matches under a labelled section header; a toggle beside the search box narrows the list to the secondary source only (and lists all of it when the search is empty); each row states its relationship to the user's own data in text ("linked: …" / "not linked"), not color alone; picking a row resolves to the user's own item or opens an explicit choice sheet.
11. Record set detail sheet pattern
   - Intent: one place to read and act on a shared record set, wherever it is shown.
   - Usage: stream record cards and full-board rows (M25-T10; `components/groups/record-set-sheet.tsx`).
   - Rules: every surface showing a record set opens the same in-route sheet; the sheet shows the ranked value, the as-logged value when converted, when and where, and the certification state in text; its actions come from one pure rule over my role and my relationship to the set (`recordSetActionsFor`), never from the surface; a surface may offer the sheet's non-destructive primary action inline, sharing the same write state; writes follow pattern 9 and removals confirm (pattern 3); after a write the host re-reads, and the sheet shows the server's returned state meanwhile.
12. In-place row logger pattern
   - Intent: log the next item of a list without leaving it, one-handed, mid-set.
   - Usage: the exercise page's set list (redesign step 4; `components/exercise-page/set-logger.tsx`, `ui/ux-rules.md` §14a).
   - Rules: the open row expands in place into its editor (labelled fields of one height, the commit control on the list's control axis); it opens on the first unfinished row by default, or on a row the user taps, one at a time; entered values are kept as typed (autosave) and stay unconfirmed until the commit control, which is the screen's one primary and is disabled until the values are valid; committing moves the editor to the next unfinished row; a row's state stays in its glyph, which the user can also toggle directly without opening the editor.

12. Read-only link card pattern
   - Intent: summarise one item of a working set (an exercise in the session) and open it, without editing in place.
   - Usage: the session view's exercise cards (redesign step 5; `components/session-view/session-exercise-card.tsx`).
   - Rules: the whole card is one `Card` link with an accessibility label that states the summary (name, done count, record); no controls inside it; editing and removal live on the destination; what is not yet realised renders faded, never hidden; a record earns a band on the card, not a badge on the row.

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
3. If UI work needs exceptions, record them explicitly in the PR body with reason and impact.
