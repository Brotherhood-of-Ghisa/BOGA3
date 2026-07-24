---
task_id: M19-T07-Update_stats_history_docs_and_ui_contracts
milestone_id: "M19"
status: completed
ui_impact: "no"
areas: "docs|frontend|cross-stack"
runtimes: "docs|node"
gates_fast: "./boga test docs-check; ./boga test meta-tests"
gates_slow: "N/A"
docs_touched: "docs/specs/05-data-model.md, docs/specs/06-testing-strategy.md, docs/specs/08-ux-delivery-standard.md, docs/specs/ui/README.md"
---

# M19-T07-Update_stats_history_docs_and_ui_contracts

## Task metadata

- Task ID: M19-T07-Update_stats_history_docs_and_ui_contracts
- Title: Update stats history docs and UI contracts
- Status: `completed`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: 2026-07-22
- Session interaction mode: `interactive (default)`

## Parent references

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M19-per-side-muscle-volume.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Quality gates: `docs/specs/02-quality-and-test-gates.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
- Project structure: `docs/specs/09-project-structure.md`

## Context Freshness

- Verified current branch + HEAD commit: authored on `codex/m19-load-mode` from `origin/main` at `ec88290`; verify current branch and HEAD during implementation kickoff.
- Start-of-session sync with `origin/main` completed?: `yes` for card authoring; branch was created from `origin/main` on 2026-07-22. Reverify before edits.
- Parent refs opened in this session:
  - `docs/specs/02-quality-and-test-gates.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/milestones/M19-per-side-muscle-volume.md`
  - `docs/specs/ui/README.md`
- Code/docs inventory freshness checks run:
  - `rg -n "volume|muscle|loadInputMode|kg total|kg per side|exercise history|stats" docs/specs docs/tasks apps/mobile` - rerun during task kickoff after prior implementation tasks land.
- Known stale references or assumptions: this task depends on actual behavior from `M19-T02` through `M19-T06`; do not finalize docs from planned intent alone.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M19-T07-Update_stats_history_docs_and_ui_contracts.md`

## Objective

Make the implemented per-side muscle-volume behavior source-of-truth in the
project docs, including the distinction between muscle analytics and existing
entered-load exercise history displays.

## Scope

### In scope

- Document `loadInputMode` semantics and the per-side muscle-volume formula in the data model docs.
- Document sync payload/schema behavior if not already fully covered by `M19-T02`.
- Document testing expectations for analytics examples, schema/wire round trips, and UI labels if they become recurring project contracts.
- Update UI docs for exercise editor and recorder behavior if the canonical UI maintenance trigger map requires it.
- Record that per-exercise history, current-session record panels, highest-weight, estimated 1RM, and entered-load volume stay entered-load based.

### Out of scope

- Implementing schema, analytics, or UI behavior.
- Adding new UI screenshots unless required for docs verification.
- Closing the milestone; `M19-T09` owns final closeout.

## UI Impact

- UI Impact?: `no`
- This is a documentation alignment task. It may update UI docs but must not change UI code.

## Acceptance criteria

1. Project docs explain that muscle volume is per-side and exercise volume remains entered-load volume.
2. Docs explain why `loadInputMode` is enough for single-implement symmetric movements such as single-dumbbell two-arm pullover.
3. Docs include the canonical meaning of `total_load` and `per_side_load`.
4. Docs identify that one-arm/one-leg rows imply both sides in v1.
5. Docs state existing completed history recomputes from current exercise metadata.
6. UI docs are updated or a no-update rationale is recorded according to `docs/specs/ui/README.md`.

## Docs touched

- Planned docs/spec files to update and why:
  - `docs/specs/05-data-model.md` - canonical data and analytics semantics.
  - `docs/specs/tech/sync-v2-server-contract.md` - canonical schema/wire behavior if not fully handled in `M19-T02`.
  - `docs/specs/06-testing-strategy.md` - recurring gate/test expectations if new fixtures or contract layers are added.
  - `docs/specs/08-ux-delivery-standard.md` - update only if the UI standard gains a reusable load-entry labeling rule.
  - `docs/specs/ui/README.md` - inspect maintenance trigger map.
  - `docs/specs/ui/screen-map.md` and `docs/specs/ui/components-catalog.md` - update if editor/recorder contracts changed.
- Rule: milestone/task docs are not substitutes for project-level docs when behavior becomes source of truth.

## Testing and verification approach

- Planned checks/commands:
  - `./boga test docs-check`
  - `./boga test meta-tests`
  - `./boga test for --diff <range>`
- Test layers covered: docs consistency and metadata validation.
- Execution triggers: always before task closeout.
- Slow-gate triggers: `N/A` unless docs changes are coupled to code changes in this task.
- Hosted/deployed smoke ownership: `N/A`; no backend deployment occurs.
- CI/manual posture note: docs gates are local and must be run before closeout.

## Implementation notes

- Planned files/areas allowed to change:
  - `docs/specs/05-data-model.md`
  - `docs/specs/tech/sync-v2-server-contract.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/08-ux-delivery-standard.md` only if needed
  - `docs/specs/ui/*.md` only if needed by UI maintenance triggers
  - `docs/specs/milestones/M19-per-side-muscle-volume.md`
- Project structure impact: none planned.
- Constraints/assumptions: update docs from implemented behavior, not from incomplete planned tasks.

## Mandatory verify gates

- Standard local fast gate: `./boga test docs-check`; `./boga test meta-tests`
- Standard local slow gate: `N/A` unless `./boga test for --diff <range>` requires one.
- Additional gate(s), if any: follow `./boga test for --diff <range>`.

## Evidence

- Implementation and contract evidence is captured in the M19 source, test, migration, and spec diff.
- Manual verification summary (required when CI is absent/partial): exercised the shipped behavior through Jest, local Supabase contracts, and the iOS Maestro frontend lane.

## Completion note

- What changed: completed this task's M19 deliverables and updated the corresponding source-of-truth contracts.
- What tests ran: `./boga test fast`, `./boga test backend`, and `./boga test frontend` passed for the integrated milestone.
- What remains: nothing for M19; future left/right tracking and per-set overrides remain explicitly out of scope.

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Update parent milestone task breakdown/status in the same session.
- Run `./scripts/task-closeout-check.sh docs/tasks/M19-T07-Update_stats_history_docs_and_ui_contracts.md` or document why `N/A`.
