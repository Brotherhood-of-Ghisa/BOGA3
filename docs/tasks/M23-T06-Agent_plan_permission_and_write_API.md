---
task_id: M23-T06-Agent_plan_permission_and_write_API
milestone_id: "M23"
status: planned
ui_impact: "yes"
areas: "cross-stack"
runtimes: "node|expo|supabase|deno|sql"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test frontend"
docs_touched: "docs/specs/03-technical-architecture.md, docs/specs/05-data-model.md, docs/specs/10-api-authn-authz-guidelines.md, docs/specs/tech/session-planning-contract.md, supabase/README.md, supabase/functions/agent-api/README.md, apps/agent-auth-web/README.md, docs/specs/ui/screen-map.md, docs/specs/ui/components-catalog.md, docs/specs/ui/ux-rules.md"
---

# M23-T06 — Agent plan permission and write API

## Task metadata

- Task ID: `M23-T06-Agent_plan_permission_and_write_API`
- Status: `planned`
- Depends on: `M23-T01`, `M23-T02`
- Parallel with: `M23-T04`, `M23-T05`
- Precedes: `M23-T07`

## Parent references (required)

- Milestone: `docs/specs/milestones/M23-session-planning-and-programmes.md`
- **Contract:** `docs/specs/tech/session-planning-contract.md`
- Agent boundary: `docs/specs/milestones/M21-boga-mcp-virtual-coach.md`,
  `supabase/functions/agent-api/README.md`
- AuthZ: `docs/specs/10-api-authn-authz-guidelines.md`,
  `supabase/README.md`
- UX and UI: `docs/specs/08-ux-delivery-standard.md`,
  `docs/specs/ui/README.md`
- Testing: `docs/specs/02-quality-and-test-gates.md`,
  `docs/specs/06-testing-strategy.md`

## Objective

Add a default-denied, current-grant-bound permission for each connected coach
and three safe agent API routes that can read the upcoming queue or atomically
create plan graphs, while keeping performed workout tables unreachable.

## Scope

### In scope

- Migration for `public.agent_plan_permissions`:
  - owner/client key, current OAuth grant timestamp, enabled flag, timestamps,
    checks, indexes, owner cleanup, RLS, and explicit grants;
  - normal app owner read/write only when `client_id` is absent;
  - no `anon` or direct OAuth access.
- Migration for service-role-only `public.agent_plan_write_receipts`, with the
  contract key, payload hash, bounded result, timestamps, uniqueness, RLS, and
  no training payload.
- Service-role-only atomic SQL functions for one plan and one whole programme,
  with owner/reference checks and all-or-nothing writes.
- Extend `agent-api` with bounded `GET /v1/agent/session-plans`,
  `POST /v1/agent/session-plans`, and `POST /v1/agent/programmes`.
- Live token and grant validation followed by matching permission/grant
  generation, strict JSON/content-type/query validation, identity-input
  rejection, idempotency replay/conflict, stable envelopes, rate bounds, and
  metadata-only audit.
- Connected Agents data hook and per-client toggle **Allow this coach to create
  plans**, including disclosure of upcoming-plan reads, optimistic state only
  where safe, error recovery, revocation interaction, and accessibility.
- Keep the OAuth consent surface truthful: the base OAuth grant remains
  read-only; plan access is a separate in-app authorization.

### Out of scope

MCP tool registration (`M23-T07`); agent edits/deletes/starts; direct agent
database access; a custom OAuth application scope; hosted recommendation logic.

## UX Contract

### Key user flows

1. **Enable one coach**
   - Trigger: open a connected agent and turn on plan creation.
   - Success outcome: the named client can read upcoming plans and create new
     ones; other clients remain disabled.
   - Failure/edge outcome: the control returns to its server state and shows a
     clear retryable error.
2. **Disable or revoke**
   - Trigger: turn permission off or revoke the grant.
   - Success outcome: the next agent request is denied; revocation also clears
     or invalidates the permission generation.
   - Failure/edge outcome: revocation remains the security-critical action and
     does not falsely report success.
3. **Reconnect the same client**
   - Trigger: authorize the client after revocation.
   - Success outcome: plan access is off until the person explicitly enables
     the new grant.

### Interaction + appearance notes

- Name the connected client and explain both capabilities near the toggle:
  viewing the upcoming queue and creating plans/programmes.
- Do not label the OAuth consent itself as write access.
- Reuse the existing Connected Agents surface, toggle/row patterns, tokens,
  status text, and error affordances; no raw screen colors.
- Permission is off by default and must never be enabled by a loading fallback.

## Acceptance criteria

1. Existing grants and missing/false/stale permission rows get `403
   PLAN_PERMISSION_REQUIRED` from all three routes without revealing whether a
   referenced plan, gym, or exercise exists.
2. A normal app user can view/change only their own current-client permission;
   `anon`, OAuth, cross-owner, and stale-grant writes are denied by server
   tests, not only hidden in UI.
3. Disable and live grant revocation block the next request. Re-authorizing the
   same client yields a new grant timestamp and cannot inherit the old enable.
4. GET returns only the validated owner's bounded upcoming/unscheduled plans,
   stable ordering/cursors, safe snapshots, and no deleted or foreign data.
5. Each POST validates the exact contract schema and owner references, creates
   its whole graph in one transaction, marks provenance as agent/client, and
   writes no performed-session row.
6. A child validation or SQL failure leaves no programme, plan, child, receipt,
   or other partial plan-domain row.
7. Same key/hash returns the original IDs; same key/different hash returns
   `409 IDEMPOTENCY_CONFLICT`; concurrent same-key calls converge.
8. Request fields resembling user/owner identity are rejected, and a foreign
   gym/exercise produces the same safe error as a nonexistent ID.
9. Direct OAuth PostgREST, `sync_push`, and performed-session mutations remain
   denied. The service-role key appears only in the Edge Function environment.
10. Audit success and failure rows contain approved metadata only; logs and
    receipts contain no bearer token or plan payload.
11. Connected Agents UI implements all three flows, preserves revoke behavior,
    uses shared tokens/primitives, has accessible state labels, and includes
    RNTL/Jest coverage and screenshots.

## Docs touched (required)

- `docs/specs/03-technical-architecture.md`: adopt the separately authorized
  agent-write path and service-role-only RPC boundary.
- `docs/specs/05-data-model.md`: permission/receipt inventories as non-sync
  control data and agent provenance on synced plans.
- `docs/specs/10-api-authn-authz-guidelines.md`: per-client plan permission,
  grant-generation matching, and performed-domain denial rules.
- `docs/specs/tech/session-planning-contract.md`: API/auth as-built pointers.
- `supabase/README.md` and `supabase/functions/agent-api/README.md`: routes,
  local tests, deployment, secrets, and authorization posture.
- `apps/agent-auth-web/README.md`: explain the base read-only consent and
  separate in-app plan permission; update runtime UI copy only if needed to
  prevent a false claim.
- UI docs update required: **yes** for the Connected Agents toggle and states
  in `screen-map.md`, `components-catalog.md`, and `ux-rules.md`; navigation
  contract only if routes/transitions change.
- Tokens/primitives reuse: existing Connected Agents controls and shared
  status/error components; exceptions none planned.
- Screenshots required: disabled, enabling/error, enabled, and revoked/relinked
  states with the disclosure visible.

## Testing and verification approach

- Extend `agent-api` contract coverage for permission RLS, grant generation,
  route validation, owner isolation, transaction rollback, receipts,
  concurrency, revocation, audit, and performed-session denial.
- Add mobile hook and Connected Agents component tests.
- Before PR: `./boga test fast`, `./boga test backend`, and
  `./boga test frontend`.
- T07 owns protocol-level MCP and hosted end-to-end smoke after these routes
  ship; local route contract coverage is mandatory here.
- Run `./boga test for --diff origin/main`; use `./boga timings` for measured
  time evidence.

## Evidence

## Completion note

- What changed:
- What tests ran:
- What remains:
