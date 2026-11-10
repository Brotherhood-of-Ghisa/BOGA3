# M41-T03 — MCP workout tools and conversational-flow proof

- Status: `planned`
- Depends on: M41-T01, M41-T02
- Milestone: [M41](../milestones/M41-mcp-workout-logging.md)
- Areas: MCP, cross-stack; UI impact: no

## Objective and scope

Expose the safe logging API to coaching clients so the person can start,
record, correct and finish a workout through chat. Verify the whole path with
real OAuth and local Supabase after T02's handoff/compatibility protection has
landed. Follow milestone D1–D5; do not extend authority or write directly to DB.

## Baseline to verify

Load `services/boga-mcp/README.md` and
`supabase/functions/agent-api/README.md` for contracts; inspect
`services/boga-mcp/src/tools.ts`, `services/boga-mcp/src/api-client.ts`,
`services/boga-mcp/scripts/smoke-client.ts` and
`scripts/smoke-boga-mcp.sh`. Re-check T01/T02's actual contracts and rollout.

## Open — resolve before coding

- Final names/schemas for proposed `start_workout`, `get_active_workout`,
  `log_sets`, `update_set`, `delete_set`, `finish_workout`; bounded inputs,
  concurrency tokens, replay keys and client annotations.
- Bounded responses that make ambiguous exercise/block/set references and
  active-session conflicts actionable without relying on conversation memory.
- Tool guidance for units, per-side meaning, warm-ups/RIR, “same again”,
  corrections, missing/ambiguous exercise identity and lost-response retries.
  Use canonical kg on the wire; never infer performance from a plan target.
- Confirm supported-client catalogue refresh/approval steps from the current
  MCP README. Distinguish protocol proof from real client UX verification.
  Check per-call approval prompts in the intended chat client: tool annotations
  cannot guarantee frictionless repeated logging on the go.

## Deliverables and acceptance

1. Strict tool schemas delegate every operation to the agent API. Server
   permissions and errors remain authoritative; tool descriptions do not
   claim access to unsynced phone-only data or completed-history mutation.
2. Registry/API-client tests cover forwarding, validation, annotations,
   token handling, permission/conflict errors and structured IDs/state.
3. Extend the local real-token smoke to prove start → log → intentional
   identical set → correct/delete → fresh-client read → finish. Also prove
   retry replay, revoked/denied writes and rejection after completion, while
   keeping existing tools green.
4. T02's app/chat handoff evidence remains valid; run affected integration
   checks if this PR changes contracts or fixtures. A fresh MCP client resumes
   from persisted state rather than an earlier assistant response.
5. Document a reproducible chat walkthrough and deployment/catalogue refresh
   procedure. Record actual supported-client smoke separately from local
   protocol evidence; never label a scripted MCP test as proof of chat UX.
6. Update ownership/security docs and [[agents.write-access]] staged notes to
   match the shipped surface. Remove this card and the completed milestone
   when the final task ships.

## Owning docs to update when implementing

- `services/boga-mcp/README.md`: tool contracts, conversational guidance,
  permission, deployment and client refresh.
- `supabase/functions/agent-api/README.md`: any final API contract adjustments.
- `docs/product/agents.md`: remove only staged notes this PR actually fulfills.

## Gates

Recompute with `./boga test for`; settle lanes with an independent reviewer.
Expected: `fast`, `mcp-smoke`, `jest-coverage`, `complexity`, `dependencies`.
Run `backend` and macOS `ios-sync-e2e` if API/schema/sync changes require them;
otherwise use the still-valid T01/T02 evidence for unchanged mobile behavior.
Obtain independent code, security and product reviews.
