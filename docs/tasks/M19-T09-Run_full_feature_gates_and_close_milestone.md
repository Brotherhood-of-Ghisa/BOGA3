---
task_id: M19-T09-Run_full_feature_gates_and_close_milestone
milestone_id: "M19"
status: planned
ui_impact: "no"
areas: "docs|frontend|backend|cross-stack"
runtimes: "docs|node|expo|maestro|supabase|sql"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test frontend"
docs_touched: "docs/specs/milestones/M19-per-side-muscle-volume.md, docs/tasks/M19-*.md"
---

# M19-T09-Run_full_feature_gates_and_close_milestone

## Task metadata

- Task ID: M19-T09-Run_full_feature_gates_and_close_milestone
- Title: Run full feature gates and close milestone
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
  - `docs/specs/tech/sync-v2-server-contract.md`
  - `docs/specs/ui/README.md`
- Code/docs inventory freshness checks run:
  - `rg -n "loadInputMode|load_input_mode|kg total|kg per side|per-side" apps/mobile supabase docs/specs docs/tasks` - run during closeout after all prior M19 tasks land.
  - `./boga test for --diff <range>` - run during closeout to confirm required gates.
- Known stale references or assumptions: this card cannot start until `M19-T02` through `M19-T08` are completed or explicitly marked outdated with rationale.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M19-T09-Run_full_feature_gates_and_close_milestone.md`

## Objective

Run the full required M19 verification set, reconcile docs/task statuses, and
close the milestone only after per-side muscle volume and load-mode semantics
are implemented end to end.

## Scope

### In scope

- Confirm every M19 acceptance criterion is implemented or explicitly deferred with a new follow-up task.
- Run `./boga test for --diff <range>` and follow all triggered gate output.
- Run full feature gates required by this milestone: `fast`, `backend`, and `frontend`.
- Run `./boga timings` after gates complete and report measured durations only.
- Update M19 task statuses and move completed/outdated cards to `docs/tasks/complete/`.
- Update `docs/specs/milestones/M19-per-side-muscle-volume.md` status and completion note when complete.

### Out of scope

- Implementing missing schema, analytics, sync, or UI behavior except for small closeout fixes found by gates.
- Opening a PR unless explicitly requested in the execution session.
- Deploying hosted backend changes.

## UI Impact

- UI Impact?: `no`
- This is a closeout/gate task. It may collect UI artifacts from prior tasks but should not introduce UI changes.

## Acceptance criteria

1. M19 milestone acceptance criteria are checked against source and tests.
2. `./boga test fast` passes.
3. `./boga test backend` passes.
4. `./boga test frontend` passes.
5. `./boga test for --diff <range>` has been run and any additional required gates are green.
6. `./boga timings` is run before reporting gate durations.
7. M19 task cards and milestone status accurately reflect completed, blocked, deferred, or outdated work.

## Docs touched

- Planned docs/spec files to update and why:
  - `docs/specs/milestones/M19-per-side-muscle-volume.md` - set final status and completion note if milestone closes.
  - `docs/tasks/M19-*.md` - update statuses, completion notes, and move completed/outdated cards.
  - Project-level docs touched by prior tasks only if closeout finds a missing source-of-truth update.

## Testing and verification approach

- Planned checks/commands:
  - `./boga test for --diff <range>`
  - `./boga test fast`
  - `./boga test backend`
  - `./boga test frontend`
  - `./boga timings`
- Test layers covered: lint/typecheck/Jest, local Supabase backend contracts, iOS Maestro frontend flows, sync e2e, docs/meta gates through aggregate lanes or explicit commands.
- Execution triggers: always before milestone closeout.
- Slow-gate triggers: M19 includes sync/backend and UI behavior, so backend and frontend gates are required.
- Hosted/deployed smoke ownership: `N/A` unless a later release/deploy task is created.
- CI/manual posture note: local slow gates are required on this machine; do not substitute CI status.

## Implementation notes

- Planned files/areas allowed to change:
  - `docs/specs/milestones/M19-per-side-muscle-volume.md`
  - `docs/tasks/M19-*.md`
  - small source/test/doc fixes directly required to make M19 acceptance criteria true
- Project structure impact: none planned.
- Constraints/assumptions: do not mark milestone complete because gates are partly green; completion requires behavioral acceptance criteria and docs status to agree.

## Mandatory verify gates

- Standard local fast gate: `./boga test fast`
- Standard local slow gate: `./boga test backend`; `./boga test frontend`
- Additional gate(s), if any: `./boga test for --diff <range>` and `./boga timings`.

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
- Run `./scripts/task-closeout-check.sh docs/tasks/M19-T09-Run_full_feature_gates_and_close_milestone.md` or document why `N/A`.
