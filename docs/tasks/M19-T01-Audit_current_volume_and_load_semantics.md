---
task_id: M19-T01-Audit_current_volume_and_load_semantics
milestone_id: "M19"
status: planned
ui_impact: "no"
areas: "docs|frontend|backend|cross-stack"
runtimes: "docs|node|supabase"
gates_fast: "./boga test docs-check; ./boga test meta-tests"
gates_slow: "N/A"
docs_touched: "docs/specs/milestones/M19-per-side-muscle-volume.md"
---

# M19-T01-Audit_current_volume_and_load_semantics

## Task metadata

- Task ID: M19-T01-Audit_current_volume_and_load_semantics
- Title: Audit current volume and load semantics
- Status: `planned`
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
- Sync v2 server contract: `docs/specs/tech/sync-v2-server-contract.md`
- Project structure: `docs/specs/09-project-structure.md`

## Context Freshness

- Verified current branch + HEAD commit: authored on `codex/m19-load-mode` from `origin/main` at `ec88290`; verify current branch and HEAD during implementation kickoff.
- Start-of-session sync with `origin/main` completed?: `yes` for card authoring; branch was created from `origin/main` on 2026-07-22. Reverify before edits.
- Parent refs opened in this session:
  - `docs/specs/02-quality-and-test-gates.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/milestones/M19-per-side-muscle-volume.md`
  - `docs/specs/tech/sync-v2-server-contract.md`
- Code/docs inventory freshness checks run:
  - `rg -n "MuscleAnalytics|exercise_muscle_mappings|loadInputMode|weight_value|ExerciseEditor|session-recorder" apps/mobile supabase docs/specs` - broad inventory run on 2026-07-22; rerun focused checks before implementation.
  - `rg --files apps/mobile | rg 'exercise|stats|muscle|session|sync|schema|seed|drizzle|repository|repo'` - candidate local files listed on 2026-07-22.
  - `rg --files supabase` - backend migration/test inventory listed on 2026-07-22.
- Known stale references or assumptions: card authoring did not inspect every matching source file; this task owns a fresh, line-level audit before any implementation task starts.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M19-T01-Audit_current_volume_and_load_semantics.md`

## Objective

Produce the implementation audit for M19 so the later schema, seed, analytics,
UI, and sync tasks change the correct paths and preserve entered-load exercise
history displays while adding per-side muscle analytics.

## Scope

### In scope

- Inventory current local and backend `exercise_definitions` fields, migrations, drift fixtures, and sync field lists.
- Inventory current exercise set volume calculations, muscle analytics aggregation, stats repositories, and history/record display calculations.
- Inventory exercise editor and session recorder weight-input labels and save paths.
- Identify where current behavior treats `exercise_muscle_mappings.weight`, `role`, null mappings, and stabilizers.
- Record any discovered implementation constraints in this card, the M19 milestone, or the dependent task cards.

### Out of scope

- Adding `loadInputMode` schema fields.
- Changing seeded exercise metadata.
- Changing analytics math or UI copy.
- Creating migrations or tests beyond docs validation for the audit note.

## UI Impact

- UI Impact?: `no`
- This is an audit/planning slice. It may identify UI files for later tasks but must not change UI behavior.

## Acceptance criteria

1. Current entered-load volume paths and per-muscle aggregation paths are documented with file references.
2. Current local schema, Supabase schema, Sync v2 push/pull, and drift-check touchpoints for `exercise_definitions` are documented.
3. Current seed metadata and custom exercise create/edit save paths are documented.
4. Current recorder set-row label behavior is documented.
5. Follow-on task cards are updated if the audit finds missing owners or an unsafe task boundary.

## Docs touched

- Planned docs/spec files to update and why:
  - `docs/specs/milestones/M19-per-side-muscle-volume.md` - update only if the audit discovers a product or implementation constraint that changes the milestone contract.
  - `docs/tasks/M19-T02-Add_load_input_mode_schema_and_sync_contract.md` through `docs/tasks/M19-T09-Run_full_feature_gates_and_close_milestone.md` - update only if task boundaries need correction.

## Testing and verification approach

- Planned checks/commands:
  - `./boga test docs-check`
  - `./boga test meta-tests`
  - `./boga test for --diff <range>`
- Test layers covered: docs metadata and task/milestone consistency.
- Execution triggers: always before task closeout.
- Slow-gate triggers: `N/A`; no runtime behavior may change in this audit slice.
- Hosted/deployed smoke ownership: `N/A`; no backend deployment occurs.
- CI/manual posture note: docs gates are local and must be run before closeout.

## Implementation notes

- Planned files/areas allowed to change:
  - `docs/specs/milestones/M19-per-side-muscle-volume.md`
  - `docs/tasks/M19-*.md`
- Project structure impact: none planned.
- Constraints/assumptions: treat the audit as evidence gathering; do not infer load semantics from exercise names at runtime.

## Mandatory verify gates

- Standard local fast gate: `./boga test docs-check`; `./boga test meta-tests`
- Standard local slow gate: `N/A` because this task is docs/audit only.
- Additional gate(s), if any: follow `./boga test for --diff <range>`.

## Evidence

- Fill during implementation.
- Manual verification summary: fill during implementation.

## Completion note

- What changed:
- What tests ran:
- What remains:

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Update parent milestone task breakdown/status in the same session.
- Run `./scripts/task-closeout-check.sh docs/tasks/M19-T01-Audit_current_volume_and_load_semantics.md` or document why `N/A`.
