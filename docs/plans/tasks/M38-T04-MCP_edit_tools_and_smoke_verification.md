# M38-T04 — MCP edit tools and smoke verification

- Status: `planned`
- Depends on: `M38-T03-Agent_API_edit_endpoints_and_validation`
- Milestone: `docs/plans/milestones/M38-agent-programme-and-plan-edits.md`
- Areas: backend; UI impact: no

## Objective

Expand `services/boga-mcp/` to expose the new plan and programme edit tools with accurate tool annotations (including `destructiveHint: true` on removals and detaches), API client methods, error propagation, vitest test coverage, and end-to-end `mcp-smoke` validation.

## Scope

- In:
  - Add MCP tools to `services/boga-mcp/src/tools.ts`:
    - `get_programme_detail` (reads programme and plan version tokens)
    - `update_plan_meta`
    - `add_plan_block`
    - `edit_plan_block`
    - `reorder_plan_blocks`
    - `reorder_block_sets`
    - `remove_plan_block` (`destructiveHint: true`)
    - `detach_plan_from_programme` (`destructiveHint: true`)
    - `remove_plan` (`destructiveHint: true`)
    - `update_programme_meta`
    - `reorder_programme_plans`
    - `remove_programme` (`destructiveHint: true`)
  - Update `services/boga-mcp/src/api-client.ts` with PATCH/GET client methods.
  - Wire error handling for `PLAN_EDIT_PERMISSION_REQUIRED` and `PLAN_CONCURRENT_MODIFICATION`.
  - Unit tests in `services/boga-mcp/test/mcp-server.test.ts`.
  - Smoke tests in `services/boga-mcp/scripts/smoke-client.ts` and verify `boga test mcp-smoke`.
- Out:
  - Mobile UI settings toggle (owned by T05).

## Decided

- D7: Destructive tools marked with `destructiveHint: true`; reorder/meta tools marked with `destructiveHint: false`.

## Open — resolve with the user at session start

- None.

## Deliverables and acceptance

1. All new MCP tools registered with correct parameter schemas and annotations.
2. Tools correctly pass `base_version` and forward API errors cleanly to MCP clients.
3. Vitest test suite passes.
4. `boga test mcp-smoke` exercises full plan editing round-trip.

## Specs to update

- None.

## Gates

Expected from `./boga test for`:
`fast`, `mcp-smoke`
