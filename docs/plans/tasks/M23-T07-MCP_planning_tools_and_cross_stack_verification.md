---
task_id: M23-T07-MCP_planning_tools_and_cross_stack_verification
milestone_id: "M23"
status: complete
ui_impact: "yes"
areas: "cross-stack"
runtimes: "node|maestro|supabase|deno"
gates_fast: "./boga test fast; ./boga test mcp-smoke"
gates_slow: "./boga test backend; ./boga test android-data-smoke"
docs_touched: "services/boga-mcp/README.md, supabase/functions/agent-api/README.md, docs/specs/tech/session-planning-contract.md, scripts/triggers.tsv"
---

# M23-T07 — MCP planning tools and cross-stack verification

## Task metadata

- Task ID: `M23-T07-MCP_planning_tools_and_cross_stack_verification`
- Status: `complete`
- Depends on: `M23-T04`, `M23-T05`, `M23-T06`
- Precedes: `M23-T08`

## Parent references (required)

- Milestone: `docs/plans/milestones/M23-session-planning-and-programmes.md`
- **Contract:** `docs/specs/tech/session-planning-contract.md`
- MCP service: `services/boga-mcp/README.md`
- Agent API: `supabase/functions/agent-api/README.md`
- Maestro: `docs/specs/11-maestro-runtime-and-testing-conventions.md`,
  `apps/mobile/README-maestro.md`
- Testing: `docs/specs/02-quality-and-test-gates.md`,
  `docs/specs/06-testing-strategy.md`

## Objective

Expose exact coaching-history reads and plan capabilities through MCP, then
prove the complete behavior across protocol, authorization, database, sync,
and mobile UI using stable seam tests rather than one brittle mega-test.

## Scope

### In scope

- Extend the MCP API client with bounded GET and JSON POST support, response
  validation, request IDs, timeouts, content type, redirects disabled, and
  stable upstream error translation.
- Add the exact, keyset-paginated exercise-history and workout-detail agent API
  routes, and upgrade exercise search/context/recent-workout reads to the
  milestone's complete-filter/exact-aggregate contract before exposing them as
  coaching inputs.
- Register:
  - `get_exercise_history`;
  - `get_workout_detail`;
  - `get_upcoming_session_plans`;
  - `create_session_plan`;
  - `create_training_programme`.
- Strict Zod inputs/outputs and the exact read/write/idempotent/non-destructive/
  closed-world annotations in the contract. No user identity input and no
  arbitrary exercise snapshot text when an owned exercise ID is required.
- Update server instructions and docs from "exactly four read-only tools" to
  nine tools: six read-only tools plus a separately authorized three-tool
  create-only planning boundary.
- Extend `mcp-smoke` to drain exact multi-page exercise/workout history and
  prove discovery, default plan denial, permission enable, pending-only
  plan/programme creation, receipt replay/conflict, row ownership, no performed
  rows, performed provenance links, or resolved blocks, audit metadata,
  disable, and revoke.
- Complete the server-created-plan pull fixture in sync integration if T02 left
  only the wire-level seed.
- Add `session-plan.yaml` Maestro flow executed on Android:
  - testID deep linking via harness (`boga3://maestro-harness?reset=data&teleport=session-plan-new`);
  - plan authoring: title input, exercise picker search, select Barbell Back Squat, add empty set;
  - fill target weight (100 kg) and reps (5);
  - save plan and verify redirect to plan detail;
  - trigger "Start all" and assert active session recorder starts with planned targets.

### Out of scope

A live model invocation; a single MCP-process-to-Maestro orchestration; agent
edit/delete/start; adaptive recommendations; performance/load tests beyond the
repository's bounded contract posture.

## Acceptance criteria

1. Tool discovery exposes exactly the existing four tools plus the two exact-
   history reads and three named planning tools, for nine total, with correct
   titles, descriptions, strict schemas, and annotations.
2. Exercise-history and workout-detail routes/tools drain every qualifying row
   exactly once; search filters have no hidden intermediate cap; exact context
   and workout aggregates are invariant under page size and match shared mobile
   calculation vectors.
3. The MCP client serializes valid bodies, never forwards caller identity,
   preserves the idempotency key, rejects malformed upstream envelopes, and
   maps timeout/auth/permission/validation/conflict/server failures stably.
4. Protocol smoke drains the exact-history tools, proves an old/default grant
   cannot call any plan tool, then enables one client and creates one plan plus
   a multi-session programme whose blocks are all pending.
5. Smoke verifies exact graph ownership/order/targets/provenance, zero new
   performed rows or performed source links, same-key replay, different-payload
   conflict, metadata-only audit, disable denial, and revoke denial.
6. Sync integration proves a server-created graph pulls in sixteen-entity,
   five-layer FK-safe order and survives first-sync restore without becoming
   locally dirty. Session/block/set source fields and performed set ordering
   round-trip independently.
7. Android Maestro flow (`session-plan.yaml`) proves plan creation, target input,
   plan detail presentation, and "Start all" recorder initiation on an Android emulator.
8. Spec 02, 06, triggers, and docs are intact with all budgets passing.

## Evidence

- Agent API contract tests: `supabase/tests/agent-api-contract.sh` passing (keyset pagination, cursors, 404s).
- MCP Unit tests: `./boga test mcp-unit` (13 tests passing, tool definitions, schema, annotations).
- 3-Phase protocol smoke: `./boga test mcp-smoke` passing (default denial, enable, create plan/programme, drain, replay/conflict, revoke denial).
- Sync round-trip test: `apps/mobile/__tests__/sync/session-plan-entities-round-trip.test.ts` (pulls server-created agent-provenance programme and plan graph without becoming locally dirty).
- Android Maestro: `apps/mobile/.maestro/flows/session-plan.yaml` passing in 1m 50s on `BOGA_wt8` emulator.
- Measured timings (`./boga timings`):
  - `agent-api`: 26s
  - `mcp-unit`: 7.2s
  - `mcp-smoke`: 15s
  - `backend-fast`: 1.7m
  - `fast`: passed
  - `complexity`: 18s
  - `dependencies`: 1.6s
  - `jest-coverage`: 1.0m (93.24% stmts, 86.25% branches)

## Completion note

- What changed:
  - Added `getExerciseHistory` and `getWorkoutDetail` to `agent-api`.
  - Added JSON `POST` support with `Idempotency-Key` and timeout to MCP client.
  - Registered all 9 tools in MCP server with strict Zod schemas and annotations.
  - Implemented 3-phase smoke testing in `services/boga-mcp/scripts/smoke-client.ts`.
  - Added sync round-trip test for server-created plans with agent provenance.
  - Created Android Maestro flow `apps/mobile/.maestro/flows/session-plan.yaml` exercising authoring and "Start all".
- What tests ran:
  - `./boga test fast`: PASS
  - `./boga test backend`: PASS
  - `./boga test mcp-unit`: PASS
  - `./boga test mcp-smoke`: PASS
  - `./boga test android-data-smoke`: PASS (session-plan.yaml passed in 1m 50s)
  - Quality targets: `jest-coverage` (86.25% branches), `complexity`, `dependencies` all green.
- What remains:
  - Task 8 (final integration polish & documentation review).

