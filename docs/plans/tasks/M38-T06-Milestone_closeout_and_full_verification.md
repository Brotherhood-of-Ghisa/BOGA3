# M38-T06 — Milestone closeout and full verification

- Status: `planned`
- Depends on: `M38-T04-MCP_edit_tools_and_smoke_verification`, `M38-T05-Mobile_Connected_Agents_edit_toggle_and_store_wiring`
- Milestone: `docs/plans/milestones/M38-agent-programme-and-plan-edits.md`
- Areas: cross-stack; UI impact: no

## Objective

Run full milestone verification across all test lanes, ensure quality target compliance (`jest-coverage`, `complexity`, `dependencies`), verify as-built docs, archive task cards, and update milestone status to `completed`.

## Scope

- In:
  - Verify all gates are green across affected stacks (`fast`, `backend`, `frontend-ui`, `mcp-smoke`).
  - Verify quality targets: whole-suite coverage floor (≥80% branches, ≥80% lines), ESLint complexity, and dependency-cruiser validation.
  - Audit as-built specs (`docs/specs/tech/session-planning-contract.md`, `docs/specs/10-api-authn-authz-guidelines.md`) against merged behaviour.
  - Delete completed task cards in `docs/plans/tasks/` and mark M38 completed.
- Out:
  - New feature development.

## Decided

- Full sweep before release; closeout requires measured evidence from `./boga timings`.

## Open — resolve with the user at session start

- None.

## Deliverables and acceptance

1. All required test lanes green with measured timings recorded.
2. Quality targets (`jest-coverage`, `complexity`, `dependencies`) green.
3. Spec docs accurately reflect live production state.
4. M38 task cards archived.

## Specs to update

- `docs/specs/tech/session-planning-contract.md` — verify as-built section.

## Gates

Expected from `./boga test for`:
`fast`, `backend`, `jest-coverage`, `complexity`, `dependencies`
