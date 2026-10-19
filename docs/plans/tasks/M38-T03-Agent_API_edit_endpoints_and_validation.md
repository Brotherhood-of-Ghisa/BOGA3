# M38-T03 — Agent API edit endpoints and validation

- Status: `planned`
- Depends on: `M38-T02-Service_role_atomic_mutation_RPCs`
- Milestone: `docs/plans/milestones/M38-agent-programme-and-plan-edits.md`
- Areas: backend; UI impact: no

## Objective

Expose the new plan and programme edit routes in `supabase/functions/agent-api/`, enforcing strict token verification, `plan_edit_enabled` permission checks, request schema validation, graph version token emission, and error mapping.

## Scope

- In:
  - Add routes to `supabase/functions/agent-api/`:
    - `PATCH /v1/agent/session-plans/:planId`
    - `PATCH /v1/agent/programmes/:programmeId`
    - `GET /v1/agent/programmes/:programmeId`
  - Update `GET /v1/agent/session-plans` and the new programme GET route to return the full-graph version token (`version_token`).
  - Permission gate: require `plan_edit_enabled = true` on `PATCH` routes; reject disabled clients with `403 PLAN_EDIT_PERMISSION_REQUIRED`.
  - Wire validation of operation payloads and strict JSON schema checks.
  - Idempotency key requirement and header extraction.
  - Mapping database exception tokens (`PLAN_CONCURRENT_MODIFICATION`, `IMMUTABLE_BLOCK_MUTATION`, etc.) to HTTP status codes.
  - Integration tests in `supabase/tests/agent-api-contract.sh`.
- Out:
  - MCP tool definitions (owned by T04).
  - Mobile UI settings toggle (owned by T05).

## Decided

- D5: Distinct permission check for edit; returns `403 PLAN_EDIT_PERMISSION_REQUIRED`.
- D8: Map error tokens cleanly to wire protocol.

## Open — resolve with the user at session start

- None.

## Deliverables and acceptance

1. `PATCH /v1/agent/session-plans/:planId` supports meta, block add/edit/reorder, and plan removal.
2. `PATCH /v1/agent/programmes/:programmeId` supports meta, plan reorder/detach, and programme removal.
3. `GET /v1/agent/programmes/:programmeId` returns programme details and per-plan graph version tokens.
4. Calling PATCH without edit permission returns `403 PLAN_EDIT_PERMISSION_REQUIRED`.
5. Concurrent modification returns `409 PLAN_CONCURRENT_MODIFICATION`.
6. Contract tests in `supabase/tests/agent-api-contract.sh` pass.

## Specs to update

- None.

## Gates

Expected from `./boga test for`:
`backend`, `fast`
