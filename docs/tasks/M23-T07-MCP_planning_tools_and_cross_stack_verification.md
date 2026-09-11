---
task_id: M23-T07-MCP_planning_tools_and_cross_stack_verification
milestone_id: "M23"
status: planned
ui_impact: "no"
areas: "cross-stack"
runtimes: "node|maestro|supabase|deno"
gates_fast: "./boga test fast; ./boga test mcp-smoke"
gates_slow: "./boga test backend; ./boga test frontend; ./boga test ios-session-plans-e2e"
docs_touched: "services/boga-mcp/README.md, supabase/functions/agent-api/README.md, supabase/README.md, docs/specs/02-quality-and-test-gates.md, docs/specs/06-testing-strategy.md, docs/specs/11-maestro-runtime-and-testing-conventions.md, docs/specs/tech/session-planning-contract.md, scripts/lanes.tsv"
---

# M23-T07 — MCP planning tools and cross-stack verification

## Task metadata

- Task ID: `M23-T07-MCP_planning_tools_and_cross_stack_verification`
- Status: `planned`
- Depends on: `M23-T04`, `M23-T05`, `M23-T06`
- Precedes: `M23-T08`

## Parent references (required)

- Milestone: `docs/specs/milestones/M23-session-planning-and-programmes.md`
- **Contract:** `docs/specs/tech/session-planning-contract.md`
- MCP service: `services/boga-mcp/README.md`
- Agent API: `supabase/functions/agent-api/README.md`
- Maestro: `docs/specs/11-maestro-runtime-and-testing-conventions.md`,
  `apps/mobile/README-maestro.md`
- Testing: `docs/specs/02-quality-and-test-gates.md`,
  `docs/specs/06-testing-strategy.md`

## Objective

Expose the plan capabilities through MCP and prove the complete behavior across
protocol, authorization, database, sync, and mobile UI using stable seam tests
rather than one brittle mega-test.

## Scope

### In scope

- Extend the MCP API client with bounded GET and JSON POST support, response
  validation, request IDs, timeouts, content type, redirects disabled, and
  stable upstream error translation.
- Register:
  - `get_upcoming_session_plans`;
  - `create_session_plan`;
  - `create_training_programme`.
- Strict Zod inputs/outputs and the exact read/write/idempotent/non-destructive/
  closed-world annotations in the contract. No user identity input and no
  arbitrary exercise snapshot text when an owned exercise ID is required.
- Update server instructions and docs from "exactly four read-only tools" to
  seven tools with a separately authorized create-only planning boundary.
- Extend `mcp-smoke` to prove discovery, default denial, permission enable,
  plan/programme creation, receipt replay/conflict, row ownership, no performed
  rows, audit metadata, disable, and revoke.
- Complete the server-created-plan pull fixture in sync integration if T02 left
  only the wire-level seed.
- Add `ios-session-plans-e2e`:
  - isolated local Supabase fixture and simulator state;
  - human one-off create/start and programme create/order;
  - server-seeded agent-provenance plan pulled into the app and started;
  - active-session conflict and required screenshots;
  - lane/trigger registry, fixture ownership, generated gate docs, and test
    strategy/runtime documentation.
- Run and record hosted discovery, permission, create, pull/inspection, retry,
  revocation, and audit smoke after deployment when credentials/environment are
  available; otherwise assign the exact deferred step and trigger to T08.

### Out of scope

A live model invocation; a single MCP-process-to-Maestro orchestration; agent
edit/delete/start; adaptive recommendations; performance/load tests beyond the
repository's bounded contract posture.

## Acceptance criteria

1. Tool discovery exposes exactly the existing four read-only tools plus the
   three named planning tools with correct titles, descriptions, strict schemas,
   and annotations.
2. The MCP client serializes valid bodies, never forwards caller identity,
   preserves the idempotency key, rejects malformed upstream envelopes, and
   maps timeout/auth/permission/validation/conflict/server failures stably.
3. Protocol smoke proves an old/default grant cannot call any plan tool, then
   enables one client and creates one plan plus a multi-session programme.
4. Smoke verifies exact graph ownership/order/targets/provenance, zero new
   performed rows, same-key replay, different-payload conflict, metadata-only
   audit, disable denial, and revoke denial.
5. Sync integration proves a server-created graph pulls in five-layer FK-safe
   order and survives first-sync restore without becoming locally dirty.
6. `ios-session-plans-e2e` proves human create/start, programme ordering,
   server-created plan visibility/start, and active conflict on a real simulator
   against the slot-isolated local backend.
7. The new lane passes twice in one slot without relying on another worktree,
   shared simulator, remote backend, or manual database cleanup.
8. Existing read-only MCP outputs and direct OAuth denial remain unchanged.
9. Spec 02 is regenerated; specs 06/11 describe the lane, fixture, seam
   strategy, and trigger posture; service/backend READMEs are operationally true.
10. Hosted smoke has recorded evidence or a precise T08 owner, environment,
    commands/checks, and release trigger. Local evidence is never presented as
    hosted proof.

## Docs touched (required)

- `services/boga-mcp/README.md`: seven-tool inventory, permission and mutation
  behavior, schemas/examples, and deployment smoke.
- `supabase/functions/agent-api/README.md`, `supabase/README.md`: final route,
  permission, receipt, deployment, and smoke instructions.
- `docs/specs/06-testing-strategy.md`: planning seam strategy and new lane.
- `docs/specs/11-maestro-runtime-and-testing-conventions.md`: fixture and
  server-seeded-plan pattern.
- `docs/specs/02-quality-and-test-gates.md`: regenerate lane matrix and update
  frontend/backend aggregate descriptions.
- `scripts/lanes.tsv` and trigger registry: add the lane and path triggers with
  explicit review of whether MCP/API/schema changes select it.
- `docs/specs/tech/session-planning-contract.md`: MCP/testing as-built pointers.

## Testing and verification approach

- Add MCP server/client unit tests and extend `mcp-smoke`.
- Add/finish server-created pull integration and the isolated Maestro lane.
- Run `./boga test ios-session-plans-e2e` twice, then `./boga test fast`,
  `./boga test backend`, and `./boga test frontend`.
- Run `./boga test for --diff origin/main` and all additional selected lanes.
- Record artifacts and `./boga timings`; never estimate a lane duration.
- Seam evidence must explicitly map protocol→DB, server→client model, and
  client model→UI/start behavior.

## Implementation notes

- MCP holds the user OAuth token only; it never receives the Supabase service
  role.
- Keep mutation annotations `destructiveHint: false`: creation adds reversible
  plan-domain rows but cannot alter performed history. It is still
  `readOnlyHint: false`.
- Hermetic fixture reset may hard-delete only its known fixture users' M23 data
  through a checked owner-scoped helper.

## Evidence

## Completion note

- What changed:
- What tests ran:
- What remains:
