# M42-T06 — MCP coach tools and agent API

- Status: `planned`
- Depends on: [M42-T01](M42-T01-Injury_contract_and_sync_schema.md)
- Milestone: [M42](../milestones/M42-injury-and-discomfort-tracking.md)
- Areas: backend, MCP, docs; UI impact: no

## Objective and scope

Expose injury tracking tools to connected AI coaches via MCP (`services/boga-mcp`)
and the Supabase Edge Function agent API, enabling context-aware session
planning and conversational logging of tweaks and discomfort. Follow milestone
D6. This task does not touch mobile UI screens.

## Baseline to verify

Load `docs/specs/10-api-authn-authz-guidelines.md` and
`supabase/functions/agent-api/README.md`. Inspect existing MCP tools in
`services/boga-mcp/src/tools.ts`, client methods in `src/api-client.ts`, and
smoke tests in `test/mcp-server.test.ts`.

## Open — resolve before coding

- Edge Function agent API endpoints:
  - `GET /v1/agent/injuries`: returns active and recent injuries with affected
    muscles, side, pain scores, and contraindications.
  - `POST /v1/agent/injuries`: logs a new injury with idempotency key.
  - `PATCH /v1/agent/injuries/:id`: updates pain score, status, or resolves.
- MCP tool annotations and schemas:
  - `get_active_injuries`: read-only annotations (`destructiveHint: false`,
    `readOnlyHint: true`).
  - `log_injury`: planning mutation annotations (`destructiveHint: false`,
    `readOnlyHint: false`). Enforces enum of 25 seeded `muscle_groups.id` or
    null with clear prompt guidance.
  - `update_injury_status`: mutation annotations.
- Integration with session planning: ensure coaching agents inspect active
  injuries and contraindications before calling `create_session_plan`.

## Deliverables and acceptance

1. Implement agent API routes in `supabase/functions/agent-api/` with OAuth
   grant verification, input validation, and write receipts.
2. Implement MCP tools (`get_active_injuries`, `log_injury`,
   `update_injury_status`) in `services/boga-mcp/src/tools.ts`.
3. Wire API client methods in `services/boga-mcp/src/api-client.ts`.
4. Automated contract tests for agent API routes asserting authentication,
   cross-owner denial, and idempotency.
5. Vitest smoke tests in `services/boga-mcp/test/mcp-server.test.ts` passing
   `boga test mcp-smoke`.

## Gates

Expected from `./boga test for`:
`fast` | `backend` | `mcp-smoke`
