---
task_id: M16-T04-stats-history-muscle-overlay
milestone_id: "M16"
status: planned
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "N/A"
docs_touched: "docs/specs/ui/screen-map.md,docs/specs/ui/ux-rules.md,docs/specs/ui/navigation-contract.md,docs/specs/milestones/M16-muscle-group-calendar-heatmap.md,RUNBOOK.md"
---

# Task Card

## Task metadata

- Task ID: `M16-T04-stats-history-muscle-overlay`
- Title: Stats / History muscle heatmap overlay
- Status: `planned`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-05-28`
- Session interaction mode: `interactive (default)`

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M16-muscle-group-calendar-heatmap.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- AI development playbook: `docs/specs/04-ai-development-playbook.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- Worktree/runtime isolation: `docs/specs/12-worktree-config-and-isolation.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
- UI screen map: `docs/specs/ui/screen-map.md`
- UI route semantics: `docs/specs/ui/ux-rules.md`
- UI navigation contract: `docs/specs/ui/navigation-contract.md`
- UI components catalog: `docs/specs/ui/components-catalog.md`
- Human run/test/debug guide: `RUNBOOK.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit:
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `yes | no | N/A` (explain)
- Parent refs opened in this session:
  - `docs/specs/README.md`
  - `docs/specs/00-product.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/04-ai-development-playbook.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/12-worktree-config-and-isolation.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/ui/navigation-contract.md`
  - `docs/specs/ui/components-catalog.md`
  - `docs/specs/milestones/M16-muscle-group-calendar-heatmap.md`
  - `RUNBOOK.md`
- Code/docs inventory freshness checks run:
  - Confirm `M16-T02` shared analytics API is complete and exported.
  - Confirm `M16-T03` heatmap component is complete and documented.
  - Re-check `apps/mobile/app/(tabs)/stats-history.tsx` for current Stats shell and muscle row structure.
  - Re-check `apps/mobile/app/__tests__/stats-screen.test.tsx` for current route/shell test patterns.
- Known stale references or assumptions (must be explicit; write `none` if none):
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M16-T04-stats-history-muscle-overlay.md`

## Objective

Make Stats / History muscle rows actionable and show an in-route muscle-history overlay containing the new calendar heatmap.

## Scope

### In scope

- Make expanded muscle rows tappable.
- Make collapsed single-muscle family headers tappable for their underlying muscle group.
- Load selected-muscle daily heatmap data from the shared analytics API.
- Render an in-route overlay card titled with the selected muscle, for example `Chest history`.
- Use the reusable heatmap component inside the overlay.
- Support loading, error, populated, empty/no-history, zero-effort date, cell selection, and backdrop dismiss states.
- Keep overlay dismissal read-only and side-effect free for session/exercise/tag/sync data.
- Update UI docs for Stats / History overlay state and actionable muscle-row semantics.

### Out of scope

- Implementing or changing the shared analytics engine.
- Building the reusable heatmap component from scratch.
- Rich selected-day exercise/set detail beyond a minimal selected-date state handoff if `M16-T05` has not landed.
- New routes, route params, backend, sync, schema, or durable selected-muscle preferences.

## UI Impact (required checkpoint)

- UI Impact?: `yes`
- Rationale:
  - The Stats / History screen gains actionable muscle rows and an in-route overlay.

## UX Contract

### Key user flows

1. Flow name: Open muscle history overlay
   - Trigger: User taps an expanded muscle row or a collapsed single-muscle family header.
   - Steps: App selects that muscle, loads daily effort data, and opens an overlay card.
   - Success outcome: Overlay title reflects the muscle and latest weeks are visible first.
   - Failure/edge outcome: Loading and error states appear inside the overlay; backdrop dismiss remains available.
2. Flow name: Browse and select heatmap date
   - Trigger: Overlay is open with heatmap data.
   - Steps: User scrolls older weeks vertically and taps a cell.
   - Success outcome: Selected cell is marked and selected-date state is available for the detail area.
   - Failure/edge outcome: Zero-effort dates are still selectable and show clear no-training feedback if no detail panel exists yet.
3. Flow name: Dismiss overlay
   - Trigger: User taps outside the card or uses any available close affordance.
   - Steps: Overlay closes without navigating away from Stats / History.
   - Success outcome: Stats / History remains in place and no domain data is mutated.
   - Failure/edge outcome: Dismiss works even if heatmap loading fails.

### Interaction + appearance notes

- Overlay card should occupy roughly 75% of screen height with internal vertical scrolling.
- Keep heatmap latest weeks visible first at open.
- Do not add route-level navigation for v1.
- Reuse existing tokens/primitives and overlay scrim tokens.
- Do not introduce fake certification markers.

## Acceptance criteria

1. Expanded muscle rows open the overlay for the tapped muscle group.
2. Collapsed single-muscle family headers open the overlay for their underlying muscle group.
3. Overlay title reflects the selected muscle.
4. Overlay opens in-route, occupies roughly 75% screen height, supports internal vertical scrolling, and dismisses on backdrop press.
5. Heatmap loads from the shared analytics API and starts at latest weeks.
6. Overlay renders loading, error, populated, empty/no-history, and zero-effort selected-date states.
7. Cell selection visibly updates selected state.
8. Overlay dismissal never mutates session, exercise, tag, or sync data.
9. Tests cover row/header tap, overlay open, error state, cell select, empty state, and backdrop dismiss.
10. Screen UI uses documented tokens/primitives/shared components or records a justified exception.
11. No raw color literals are introduced in screen files unless explicitly allowed with rationale.
12. Relevant `docs/specs/ui/*.md` docs are updated in the same task.
13. `docs/specs/ui/navigation-contract.md` is updated only if routes, params, redirects, or transitions change; planned v1 should record no-update rationale.

## Docs touched (required)

- `docs/specs/ui/screen-map.md` - add Stats / History muscle-history overlay state.
- `docs/specs/ui/ux-rules.md` - document actionable muscle-row and overlay semantics.
- `docs/specs/ui/navigation-contract.md` - update only if route/param/navigation behavior changes; otherwise record no-update rationale.
- `docs/specs/milestones/M16-muscle-group-calendar-heatmap.md` - update if overlay behavior changes milestone assumptions.
- `RUNBOOK.md` - review; update only if evidence workflow or commands change.
- UI docs update required?: `yes`
  - Trigger: screen state and interaction semantics change.
- Tokens/primitives compliance statement:
  - Reuse plan: existing `SegmentedChips`, `uiColors`, shared heatmap component, overlay scrim tokens, and current Stats card/list styles where appropriate.
  - Exceptions: none planned.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md` and this task.
  - Planned captures/artifacts: populated overlay, loading or error state if feasible, empty/no-history state, selected cell.
  - If not required, why optional/non-blocking here: `N/A`

## Testing and verification approach

- Planned checks/commands:
  - targeted Stats screen tests, for example `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/stats-screen.test.tsx --runInBand`
  - `./scripts/quality-fast.sh frontend`
  - `git diff --check`
- Standard local gate usage:
  - Frontend fast gate is mandatory.
  - Frontend slow gate is not mandatory unless the implementation adds Maestro flows, changes native/runtime assumptions, or uses simulator evidence as required proof.
- Test layers covered:
  - RNTL UI rendering/interaction.
  - mocked analytics load success/error/empty states.
- Execution triggers:
  - always.
- Slow-gate triggers:
  - Run `./scripts/quality-slow.sh frontend` if simulator-dependent visual evidence is required, Maestro flows change, or runtime-sensitive issues are found.
- Hosted/deployed smoke ownership:
  - `N/A`
- CI/manual posture note:
  - Current repo has no CI pipeline; local evidence is required.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/app/(tabs)/stats-history.tsx`
  - possible Stats overlay/helper component under `apps/mobile/components/**`
  - mobile tests under current conventions.
  - relevant `docs/specs/ui/**`
  - `RUNBOOK.md` only if needed.
- Project structure impact:
  - No new route files expected.
- Constraints/assumptions:
  - Depends on completed `M16-T02` and `M16-T03`.
  - If `M16-T05` has not landed, this task should keep selected-day detail minimal and leave rich details to T05.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `N/A` unless slow-gate triggers fire.
- Optional closeout validation helper: `./scripts/task-closeout-check.sh docs/tasks/M16-T04-stats-history-muscle-overlay.md`
- Additional gate(s): `git diff --check`

## Evidence

- UI/UX task visual artifacts note:
  - Record screenshot/capture paths for populated overlay, selected date, empty/no-history, and error state when feasible.
- Manual verification summary (required when CI is absent/partial):
- Deferred/manual hosted checks summary: `N/A`

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed:
- What tests ran:
- What remains:

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/`.
- Update relevant UI docs and M16 milestone task breakdown/status.
- Record `RUNBOOK.md reviewed (no changes required)` if commands/workflows did not change.
