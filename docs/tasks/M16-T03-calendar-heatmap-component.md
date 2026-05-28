---
task_id: M16-T03-calendar-heatmap-component
milestone_id: "M16"
status: planned
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "N/A"
docs_touched: "docs/specs/ui/components-catalog.md,docs/specs/ui/ux-rules.md,docs/specs/milestones/M16-muscle-group-calendar-heatmap.md,RUNBOOK.md"
---

# Task Card

## Task metadata

- Task ID: `M16-T03-calendar-heatmap-component`
- Title: Reusable calendar heatmap component
- Status: `planned`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-05-28`
- Session interaction mode: `interactive (default)`
- Required branch: `codex/m16-t03-calendar-heatmap-component`
- Branch/worktree rule: create or switch to the required branch before edits, preferably via `./scripts/worktree-create.sh <branch-name>` from the main checkout. Do not complete this task directly on `main`.

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M16-muscle-group-calendar-heatmap.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- AI development playbook: `docs/specs/04-ai-development-playbook.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- Worktree/runtime isolation: `docs/specs/12-worktree-config-and-isolation.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
- UI components catalog: `docs/specs/ui/components-catalog.md`
- UI route semantics: `docs/specs/ui/ux-rules.md`
- Human run/test/debug guide: `RUNBOOK.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit:
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `yes | no | N/A` (explain)
- Parent refs opened in this session:
  - `docs/specs/README.md`
  - `docs/specs/00-product.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/04-ai-development-playbook.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/12-worktree-config-and-isolation.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/components-catalog.md`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/milestones/M16-muscle-group-calendar-heatmap.md`
  - `RUNBOOK.md`
- Code/docs inventory freshness checks run:
  - Re-check `apps/mobile/components/ui/tokens.ts` before adding heatmap/today color tokens.
  - Re-check existing UI primitive/component placement under `apps/mobile/components/**`.
  - Re-check `docs/specs/ui/components-catalog.md` for component inventory style.
- Known stale references or assumptions (must be explicit; write `none` if none):
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M16-T03-calendar-heatmap-component.md`

## Objective

Build a reusable calendar heatmap component that can render Monday-start daily effort cells with 8 visible week rows, stable bucket colors, today highlighting, and selected-cell interaction.

## Scope

### In scope

- Add a reusable heatmap component under the existing mobile component ownership structure.
- Add pure date-layout helpers if useful for Monday-start week generation and latest-first initial positioning.
- Add heatmap/today semantic tokens before consuming new colors.
- Render labels `Mon Tue Wed Thu Fri Sat Sun`.
- Support neutral zero-effort cells, green positive effort buckets, a light blue today treatment, and selected-cell styling.
- Make all cells tappable with meaningful accessibility labels.
- Add RNTL/unit coverage for layout, rendering states, bucket semantics, today highlight, and selection callback.
- Update UI docs for the reusable component and heatmap semantics.

### Out of scope

- Loading real Stats or daily analytics data.
- Opening the Stats / History overlay.
- Rendering selected-day exercise/set detail.
- Adding new routes, backend, sync, schema, or durable state.

## UI Impact (required checkpoint)

- UI Impact?: `yes`
- Rationale:
  - Adds a reusable visual/interactive component and likely new semantic UI tokens.

## UX Contract

### Key user flows

1. Flow name: Inspect heatmap grid
   - Trigger: A parent surface renders the heatmap with daily effort data.
   - Steps: User sees weekday labels and 8 visible Monday-start week rows.
   - Success outcome: Dates align under the correct weekday columns; effort is readable through neutral/green buckets.
   - Failure/edge outcome: Empty or zero-effort dates remain visible and tappable.
2. Flow name: Select a day
   - Trigger: User taps a date cell.
   - Steps: The component calls the selected-date handler and visually marks the selected cell.
   - Success outcome: Parent surfaces can render details for that date.
   - Failure/edge outcome: Disabled/missing data is not required for v1; zero-effort cells still select normally.

### Interaction + appearance notes

- Use stable 7-column dimensions so labels, cells, and selection do not shift layout.
- Keep bucket normalization stable for the loaded data window.
- Today highlight must remain distinct from selected state and effort bucket.
- Do not introduce raw color literals in `.tsx`; add tokens first if existing tokens are insufficient.
- Keep text compact enough for small phones without horizontal scrolling.

## Acceptance criteria

1. Component renders 7 weekday columns, Monday through Sunday.
2. Component renders 8 visible week rows in its initial viewport when embedded with the planned overlay constraints.
3. Date layout is deterministic across month/year boundaries and Monday/Sunday edges.
4. Cells support neutral zero effort and positive effort buckets.
5. Bucket normalization does not shift while the user scrolls the same loaded history window.
6. Today has a light blue treatment independent of green effort intensity.
7. Selected cell state is visible and accessible.
8. Cell accessibility labels include date and effort context.
9. Tests cover layout, buckets, today highlight, zero-effort cells, and selection callback.
10. Screen/component code uses documented tokens/primitives/shared components or records a justified exception.
11. No raw color literals are introduced in screen/component `.tsx` files unless explicitly allowed with rationale.
12. Relevant `docs/specs/ui/*.md` docs are updated in the same task.

## Docs touched (required)

- `docs/specs/ui/components-catalog.md` - add the reusable heatmap component inventory entry.
- `docs/specs/ui/ux-rules.md` - document heatmap date/bucket/today/selection semantics if not already covered.
- `docs/specs/milestones/M16-muscle-group-calendar-heatmap.md` - update only if the component API changes milestone assumptions.
- `RUNBOOK.md` - review; update only if local run/test/debug commands or artifact paths change.
- UI docs update required?: `yes`
  - Trigger: reusable component inventory and new heatmap semantics.
- Tokens/primitives compliance statement:
  - Reuse plan: existing `uiColors`, `uiSpace`, `uiRadius`, `UiText`/text tokens, and `Pressable` patterns; add semantic tokens for heatmap buckets/today when needed.
  - Exceptions: none planned.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md` or task scope?: `yes`
  - Planned captures/artifacts: rendered populated heatmap, zero/no-effort state, today highlight, and selected date where feasible.
  - If not required, why optional/non-blocking here: `N/A`

## Testing and verification approach

- Planned checks/commands:
  - targeted component/helper tests, for example `cd apps/mobile && npm test -- --runTestsByPath <new-test-file> --runInBand`
  - `./scripts/quality-fast.sh frontend`
  - `git diff --check`
- Standard local gate usage:
  - Frontend fast gate is mandatory.
  - Frontend slow gate is not mandatory unless simulator-dependent visual evidence or Maestro/runtime changes are introduced.
- Test layers covered:
  - pure date-layout/unit tests.
  - RNTL component rendering/interaction tests.
- Execution triggers:
  - always.
- Slow-gate triggers:
  - Run `./scripts/quality-slow.sh frontend` if this task adds Maestro flows, changes native/runtime assumptions, or relies on simulator evidence to satisfy acceptance.
- Hosted/deployed smoke ownership:
  - `N/A`
- CI/manual posture note:
  - Current repo has no CI pipeline; local evidence is required.

## Implementation notes

- Planned files/areas allowed to change:
  - new component under `apps/mobile/components/**`
  - optional pure helper under `apps/mobile/src/**`
  - `apps/mobile/components/ui/tokens.ts` if new semantic color tokens are required.
  - mobile test files under current conventions.
  - `docs/specs/ui/components-catalog.md`
  - `docs/specs/ui/ux-rules.md`
- Project structure impact:
  - No new top-level folders expected.
- Constraints/assumptions:
  - This card may run in parallel with `M16-T02`.
  - Keep component API data-shaped but not tightly coupled to Stats repository internals.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `N/A` unless slow-gate triggers fire.
- Optional closeout validation helper: `./scripts/task-closeout-check.sh docs/tasks/M16-T03-calendar-heatmap-component.md`
- Additional gate(s): `git diff --check`

## Evidence

- UI/UX task visual artifacts note:
  - Record screenshot/capture paths for populated, zero-effort, today, and selected states when feasible.
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
