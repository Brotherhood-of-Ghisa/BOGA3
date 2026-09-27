---
task_id: M27-T11-Align_coaching_API_and_MCP_bodyweight_metrics
milestone_id: M27
status: in_progress
ui_impact: "no"
areas: "cross-stack"
runtimes: "node|deno|supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test mcp-smoke"
docs_touched: "docs/specs/tech/bodyweight-load-contract.md, docs/specs/10-api-authn-authz-guidelines.md, services/boga-mcp/README.md"
---

# M27-T11 — Align coaching API and MCP bodyweight metrics

- Status: `in_progress`
- Depends on: M27-T07.
- Milestone spec: `docs/plans/milestones/M27-bodyweight-load-and-group-comparisons.md`
- Governing decisions: D1–D6, D10.

## Objective and scope

Make coach-visible personal training data agree with the app's bodyweight
calculations, including unknown/estimated context. Read AGENTS.md, specs
02/03/05/09/10, bodyweight contract, `supabase/README.md` and the MCP README.
Refresh current API/tool contracts and HEAD; read test-directory READMEs.

## Deliverables and acceptance

1. Load the owner's exercise load metadata and saved session B/provenance at the
   dedicated `supabase/functions/agent-api` boundary. Feed the same T03 resolver
   used by the app rather than estimating from external weight alone.
2. Return raw entered amount/mode separately from effective load, total 1RM,
   session B and applicable coefficient. Expose clear units and completeness;
   do not report a known subtotal as complete volume or a missing B as zero.
3. Exercise summaries, records, workout totals and comparison/history outputs
   agree with T07 on the same fixtures. New current readings do not rescore old
   workouts. Estimated historical B remains identifiable to the coach.
4. Update MCP schemas/descriptions/output translation where these shapes or
   semantics change; define compatible response evolution for existing callers.
   Keep MCP a protocol adapter without direct database/service-role access.
5. Preserve existing read-only owner-scoped training authorization. This task
   does not add measurement/plan write tools, OAuth direct-table access or group
   access. Query only weight context needed for authorised training responses.

## Verification and closeout

Assert API/app parity on BW-only, added, assisted, conventional, missing and
backfilled rows, including unit labels and incomplete aggregates. Exercise
cross-owner denial, OAuth boundary, response compatibility and the real
OAuth-to-MCP path. Run `./boga test fast`, `./boga test backend`,
`./boga test mcp-smoke`; use `./boga test for` for the final diff.
T12 owns deployed API/MCP smoke and release ordering. Graduate API semantics,
attach evidence, mark the milestone entry complete and delete this card when shipped.

## Implementation checkpoint — 2026-09-27

API/MCP implementation is integrated, with runtime verification pending. The
owner-filtered API adapter uses mobile's load/snapshot boundary; raw entered
unit/mode, effective load, metric basis, saved B/provenance and coverage remain
separate. Existing kg external-load fields are retained with additive
`effective_load_v1` semantics. Incomplete/truncated totals stay unavailable.
MCP keeps four read-only tools and passes enriched JSON through unchanged.

The backend contract adds conventional/BW-only/added/assisted/lb/per-side,
missing/malformed/estimated B, explicit correction, later-reading invariance,
partial-workout coverage and legacy ambiguity cases. Existing OAuth, ownership,
denial and revocation coverage stays. The real MCP smoke now checks B80 +20×8
=800 across API and protocol; unit fixtures preserve null/coverage in both JSON
channels. API and MCP TypeScript overlays and Bash syntax checks passed; they
are preparation checks, not runtime gates.

Integrated while T07's device sequence runs with mobile code fixed at f9d5b56;
none of this task's implementation files changes that app build. Run full fast
and backend (including MCP smoke) after the native sequence: the backend drift
negative fixture temporarily edits a mobile schema file and must not race Metro.
No hosted deployment or shipping completion is claimed.

The actual `./boga test mcp-unit` lane passed (5 tests, typecheck and build):
`/tmp/boga-m27-coaching-mcp-unit.log`. Actual API source also typechecks with
the installed pinned Supabase types and a minimal Deno-global declaration;
this does not replace the pending real Edge Function backend contracts.
`docs-check` and `git diff --check` passed.
