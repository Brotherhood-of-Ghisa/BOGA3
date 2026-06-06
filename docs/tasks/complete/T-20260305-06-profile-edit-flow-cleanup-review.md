---
task_id: T-20260305-06-profile-edit-flow-cleanup-review
milestone_id: "M11"
status: outdated
ui_impact: "yes"
areas: "frontend,docs"
runtimes: "expo,node"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "N/A"
docs_touched: "docs/specs/ui/ux-rules.md,docs/specs/ui/screen-map.md"
---

> **OUTDATED — archived 2026-06-06.** This M11-era cleanup-review (authored
> 2026-03-05) was never actioned and M11 has long shipped. Retained for history
> only; not in flight. Ignore unless explicitly re-opened.

## Task metadata

- Task ID: `T-20260305-06-profile-edit-flow-cleanup-review`
- Title: Review and cleanup unified profile edit flows after view/edit mode simplification
- Status: `outdated`
- Session date: `2026-03-05`
- Session interaction mode: `interactive (default)`

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M11-auth-ui-and-profile-management.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`

## Objective

Run a focused cleanup review of the signed-in profile edit flow to confirm the simplified view/edit UX remains consistent, predictable, and test-covered across success, validation, and failure paths.

## Scope

### In scope

- Verify unified `Edit -> Update` interaction behavior for username, email, and password updates.
- Review and tighten inline feedback behavior for pending-email, validation, and mutation failures.
- Ensure the bottom view-mode action row (`Edit`, danger `Sign Out`) remains stable during loading/updating states.
- Close gaps in Jest coverage for profile edit-mode transitions and edge states.

### Out of scope

- Backend auth model or RLS contract changes.
- New profile features unrelated to existing edit flows.

## UI Impact (required checkpoint)

- UI Impact?: `yes`

## UX Contract

### Key user flows

1. Flow name: View mode to edit mode
   - Trigger: Signed-in user taps `Edit`.
   - Steps: profile switches from read-only rows to editable fields and a single `Update` button.
   - Success outcome: user can submit one consolidated update action.
   - Failure/edge outcome: loading/disabled states still prevent accidental double-submit.
2. Flow name: Unified update submit
   - Trigger: Signed-in user in edit mode taps `Update`.
   - Steps: app applies changed username/email/password fields and renders one inline result card.
   - Success outcome: success feedback is shown and route returns to view mode.
   - Failure/edge outcome: inline error remains on the profile route and edit mode stays available for retry.

### Interaction + appearance notes

- Keep the signed-in profile layout cardless and row-oriented.
- Keep the bottom view-mode action row limited to `Edit` and danger `Sign Out`, and keep edit mode actions limited to `Cancel`/`Update`.
- Keep update inputs hidden in default view mode.
- Keep only one update submit control in edit mode.

## Acceptance criteria

1. Signed-in profile view mode and edit mode transitions are deterministic and test-covered.
2. Username/email/password mutations are executed through one update submit path with inline success/failure messaging.
3. Danger-styled sign-out action remains available and visually distinct in signed-in mode.
4. `npm test -- --runTestsByPath app/__tests__/settings-profile-navigation.test.tsx` passes.

## Docs touched

- `docs/specs/ui/ux-rules.md` - reflect signed-in profile view/edit semantics and unified update feedback behavior.
- `docs/specs/ui/screen-map.md` - update `/profile` key states to include view-mode and edit-mode behavior.

## Testing and verification approach

- Planned checks/commands:
  - `npm test -- --runTestsByPath app/__tests__/settings-profile-navigation.test.tsx`
  - `./scripts/quality-fast.sh frontend`
- Slow-gate triggers:
  - `N/A` for this cleanup review unless runtime-only regressions are observed.
- CI/manual posture note:
  - CI is absent; local Jest + fast frontend gate evidence is required at closeout.

## Evidence

- Capture targeted test output for profile navigation/edit-flow tests.
- Record any residual edge-case risk discovered during cleanup review.

## Completion note (fill at end)

- What changed:
- What tests ran:
- What remains:
