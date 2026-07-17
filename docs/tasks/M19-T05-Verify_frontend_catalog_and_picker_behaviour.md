---
task_id: M19-T05-Verify_frontend_catalog_and_picker_behaviour
milestone_id: "M19"
status: planned
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo|maestro|docs"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/README.md"
---

# M19-T05-Verify_frontend_catalog_and_picker_behaviour

## Task metadata

- Task ID: M19-T05-Verify_frontend_catalog_and_picker_behaviour
- Title: Verify frontend catalog and picker behaviour
- Status: `planned`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: 2026-07-17
- Session interaction mode: `non_interactive`

## Parent references

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M19-prune-starter-exercise-catalog.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`

## Context Freshness

- Verified current branch + HEAD commit: fill during task kickoff.
- Start-of-session sync with `origin/main` completed?: `N/A` for planned card creation; verify during task kickoff.
- Parent refs opened in this session:
  - `docs/specs/milestones/M19-prune-starter-exercise-catalog.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/ui/README.md`
- Code/docs inventory freshness checks run:
  - Task is planned only; run route/component/test inventory during implementation kickoff.
- Known stale references or assumptions: none recorded at card creation.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M19-T05-Verify_frontend_catalog_and_picker_behaviour.md`

## Objective

Verify that the exercise catalog and recorder picker show the reduced active
catalog, keep user-added exercises visible, and hide suppressed tombstoned rows
by default.

## Scope

### In scope

- Exercise catalog route behavior with the pruned active list.
- Recorder exercise picker behavior with the pruned active list.
- Search/filter behavior for kept, suppressed, and user-added exercises.
- Deleted visibility behavior for suppressed rows if an existing deleted-toggle path exposes them.
- UI tests or Maestro coverage needed by changed route/component behavior.

### Out of scope

- New catalog merge UI.
- New exercise editor features.
- Backend cleanup or sync migration implementation.
- Stale old-client update-required sync messaging; `M19-T07` owns that
  server/client sync state if needed.

## UI Impact

- UI Impact?: `yes`
- This task verifies user-visible list behavior in existing screens and may update UI test fixtures.

## UX Contract

### Key user flows

1. Exercise catalog active list:
   - Trigger: user opens the exercise catalog.
   - Steps: screen loads active exercises from local catalog cache/store.
   - Success outcome: kept seed exercises and user-added exercises are visible; suppressed seed rows are hidden.
   - Failure/edge outcome: empty or error states use existing documented catalog behavior.
2. Recorder exercise picker:
   - Trigger: user adds an exercise while recording a session.
   - Steps: picker loads/searches active exercises.
   - Success outcome: kept seed exercises and user-added exercises are selectable; suppressed seed rows are absent from default results.
   - Failure/edge outcome: no-result search state remains usable and does not imply data loss.

### Interaction + appearance notes

- Reuse existing exercise list controls, rows, filters, and empty states.
- Do not add new visual patterns unless existing behavior breaks with the reduced list.
- Keep deleted visibility behavior consistent with current catalog semantics.

## Acceptance criteria

1. Catalog and picker default views hide suppressed `seed_*` tombstones.
2. User-added exercises remain visible and selectable.
3. Search returns kept exercises and user-added exercises but not suppressed tombstones by default.
4. Screen UI uses documented tokens/primitives/shared components for common buttons/text/layout/list patterns, or records a justified exception.
5. No raw color literals are introduced in screen files unless explicitly allowed by the task and documented with rationale.
6. Relevant `docs/specs/ui/*.md` docs are updated in the same task, or explicit no-update rationale is recorded.
7. `docs/specs/ui/navigation-contract.md` is updated if routes, params/query behavior, redirects, or transitions change.

## Docs touched

- Planned docs/spec files to update and why:
  - `docs/specs/ui/README.md` - inspect maintenance trigger map during implementation.
- UI docs update required?: `no` by default.
- If no, rationale: expected behavior uses existing catalog/picker routes and list semantics; update UI docs only if route/component contracts change.
- Tokens/primitives compliance statement:
  - Reuse plan: existing exercise catalog/list controls and UI primitives.
  - Exceptions: none planned.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md` or task scope?: `yes` if UI behavior or Maestro flows change; otherwise `no`.
  - Planned captures/artifacts: catalog active list and recorder picker if UI changes are made.
  - If not required, why optional/non-blocking here: fixture-only verification does not change visual contract.

## Testing and verification approach

- Planned checks/commands:
  - `./boga test fast`
  - `./boga test frontend`
  - `./boga test for --diff <range>`
- Test layers covered: Jest screen/interaction tests and Maestro frontend gate if screen behavior changes.
- Execution triggers: always before task closeout when UI-facing files or tests change.
- Slow-gate triggers: UI screens/components/navigation changes require frontend gate.
- CI/manual posture note: frontend Maestro gate is local-only and must be run on this machine.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/app/(tabs)/exercise-catalog.tsx` only if behavior needs adjustment
  - existing shared exercise list controls/cache/search tests and fixtures
  - Maestro flows only if user-facing behavior needs device proof
- Project structure impact: none planned.
- Constraints/assumptions: avoid new UI; prefer verifying existing hide-deleted behavior handles tombstones.

## Mandatory verify gates

- Standard local fast gate: `./boga test fast`
- Standard local slow gate: `./boga test frontend`
- Additional gate(s), if any: follow `./boga test for --diff <range>`.

## Evidence

- Fill during implementation.
- UI/UX task visual artifacts note: fill during implementation if UI behavior changes.
- Manual verification summary: fill during implementation.

## Completion note

- What changed:
- What tests ran:
- What remains:

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Update parent milestone task breakdown/status in the same session.
