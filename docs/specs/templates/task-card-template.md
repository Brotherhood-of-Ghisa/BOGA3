---
# Minimal machine-readable task metadata 
task_id: <Milestone ID>-T<Task Sequence>-<Task short name>
milestone_id: "M#"
status: planned
ui_impact: "yes|no"
areas: "docs|frontend|backend|cross-stack"
runtimes: "docs|node|expo|maestro|supabase|deno|sql"
gates_fast: "./scripts/quality-fast.sh <area>|N/A"
gates_slow: "./scripts/quality-slow.sh <area>|N/A"
docs_touched: "comma-separated paths or none"
---

# Filename naming
`docs/tasks/<task-id>.md`

Where `<task-id>` is: `<Milestone ID>-T<Task Sequence>-<Task short name>`

So for example: `M33-T04-Do_Something.md`

# Task Card Template

## Task metadata

- Task ID:
- Title:
- Status: `planned | in_progress | completed | blocked | outdated`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date:
- Session interaction mode: `interactive (default) | non_interactive`

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/<milestone-id>.md`
- Architecture (if relevant): `docs/specs/03-technical-architecture.md`
- Data model (if relevant): `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md` (always load for context; update only when task changes paths/layout/conventions)
- UX standard (UI/UX tasks only; remove for non-UX tasks): `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index (UI/UX tasks only; remove for non-UI tasks): `docs/specs/ui/README.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit:
- Start-of-session sync with `origin/main` completed?: `yes | no | N/A` (explain)
- Parent refs opened in this session (list exact files actually reviewed):
  - `<path>`
- Code/docs inventory freshness checks run (route inventory, UI docs inventory, schema/runtime inventory as applicable):
  - `<check>` - `<result/date>`
- Known stale references or assumptions (must be explicit; write `none` if none):
- Optional helper command (recommended):
  - `./scripts/task-bootstrap.sh <task-card-path>`

## Objective

What this session must accomplish.

## Scope

### In scope

- 

### Out of scope

- 

## UI Impact (required checkpoint)

- UI Impact?: `yes | no`
- If `yes`:
  - keep UI/UX parent references (`docs/specs/08-ux-delivery-standard.md`, `docs/specs/ui/README.md`)
  - keep the `UX Contract` section and fill it before implementation
  - include a tokens/primitives compliance statement in `Docs touched` / implementation notes:
    - what existing tokens/primitives/shared UI components will be reused
    - any justified one-off styling or raw literal exceptions (file + rationale)
  - include a UI docs update plan in `Docs touched` (or explicit no-update rationale only if UI behavior/contracts/inventory truly do not change)
  - include screenshots/artifacts expectations in `Evidence` when required by `docs/specs/08-ux-delivery-standard.md` or task scope; otherwise note they are optional/non-blocking for this task
- If `no`:
  - remove UI-only sections (`UX Contract`, UI-only bullets in `Docs touched`) and note any UI-adjacent impact rationale if helpful

## UX Contract (UI/UX tasks only; remove this entire section for non-UX tasks)

### Key user flows (minimal template)

1. Flow name:
   - Trigger:
   - Steps:
   - Success outcome:
   - Failure/edge outcome:
2. Flow name:
   - Trigger:
   - Steps:
   - Success outcome:
   - Failure/edge outcome:

### Interaction + appearance notes (lightweight; prefer <= 5 bullets)

- 

## Acceptance criteria

1. 
2. 
3. 

UI task acceptance boilerplate (include/adapt when `UI Impact = yes`; remove for non-UI tasks):

4. Screen UI uses documented tokens/primitives/shared components for common buttons/text/layout/list patterns, or records a justified exception.
5. No raw color literals are introduced in screen files unless explicitly allowed by the task and documented with rationale.
6. Relevant `docs/specs/ui/*.md` docs are updated in the same task (or explicit `no update` rationale is recorded in `Docs touched`).
7. `docs/specs/ui/navigation-contract.md` is updated when routes, params/query behavior, redirects, or transitions change.

## Docs touched (required)

- Planned docs/spec files to update and why (list exact paths; write `none` + rationale if no docs/spec changes expected):
  - `<path>` - `<why>`
- For significant cross-cutting behavior changes (for example sync model, auth-gated sync behavior, conflict policy, offline/online semantics, runtime topology, or test-layer expectations), include the relevant project-level docs here:
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
- Rule:
  - milestone/task docs are not substitutes for these project-level docs when behavior or verification expectations become part of the shared project contract
- If `UI Impact = yes`, complete all of the following:
  - Canonical UI docs maintenance trigger map lives in `docs/specs/ui/README.md` (`Maintenance rules`).
  - UI docs update required?: `yes | no`
  - If `yes`, list exact files under `docs/specs/ui/` and why, mapped to that canonical trigger map.
  - If `no`, provide explicit rationale (for example: visual-only spacing tweak within existing documented pattern, no route/component contract change)
  - Tokens/primitives compliance statement (required for UI tasks):
    - Reuse plan:
    - Exceptions (raw literals or screen-local one-offs), if any:
  - UI artifacts/screenshots expectation (required to state for UI tasks):
    - Required by `docs/specs/08-ux-delivery-standard.md` or task scope?: `yes | no`
    - Planned captures/artifacts (if required):
    - If not required, why optional/non-blocking here:
- Authoring rule for UI docs (`docs/specs/ui/**`):
  - keep docs synthetic/overview-first and source-linked
  - do not duplicate detailed props/variants/implementation notes that are better read from source files

## Testing and verification approach (see `docs/specs/02-quality-and-test-gates.md`; `docs/specs/08-ux-delivery-standard.md` for UI tasks)

- Planned checks/commands:
- Standard local gate usage:
  - `./scripts/quality-fast.sh` (default local fast gate; use area-specific form if needed)
  - `./scripts/quality-slow.sh <frontend|backend>` (only when task risk triggers require slow local gates)
- Test layers covered (for example unit / integration / contract / E2E / hosted smoke):
- Execution triggers (`always`, file-change-triggered, milestone closeout, release closeout):
- Slow-gate triggers (required when `quality-slow` may apply; state `N/A` only if truly not applicable):
- Hosted/deployed smoke ownership (required for backend/deployment work; name the owning task if deferred):
- CI/manual posture note (required when CI is absent or partial):
- Notes:

## Implementation notes

- Planned files/areas allowed to change:
- Project structure impact (new paths/conventions or explicit no-structure-change decision):
- Constraints/assumptions:

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh` (or area-specific form, with rationale)
- Standard local slow gate: `./scripts/quality-slow.sh <frontend|backend>` when task risk triggers require it
- If a standard gate is `N/A`, document the reason and list the runtime-specific replacement gate(s).
- Optional closeout validation helper (recommended before handoff): `./scripts/task-closeout-check.sh <task-card-path>`
- Additional gate(s), if any:

## Evidence (see `docs/specs/02-quality-and-test-gates.md`; `docs/specs/08-ux-delivery-standard.md` for UI tasks)

- 
- UI/UX task visual artifacts note (remove for non-UI tasks): list screenshot/capture evidence here when required by `docs/specs/08-ux-delivery-standard.md` or task scope; otherwise record `N/A` + rationale
- Manual verification summary (required when CI is absent/partial):
- Deferred/manual hosted checks summary (owner + trigger timing), if applicable:

## Completion note

- What changed:
- What tests ran:
- What remains:

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Ensure completion note is filled before handoff.
- If the task changed significant cross-cutting behavior, ensure the relevant project-level docs (`03`, `04`, `05`, `06`) were updated in the same session rather than only the milestone/task docs.
- For UI/UX tasks, update the relevant `docs/specs/ui/*.md` files (or record explicit `no update` rationale) and keep entries synthetic/overview-first.
- If significant project-structure changes were made, update `docs/specs/09-project-structure.md` and mention it in completion note.
- Update parent milestone task breakdown/status in the same session.
- Run `./scripts/task-closeout-check.sh <task-card-path>` (or document why `N/A`) before handoff.
