---
task_id: M23-T08-Milestone_closeout
milestone_id: "M23"
status: planned
ui_impact: "no"
areas: "docs"
runtimes: "docs|node|expo|maestro|supabase|deno|sql"
gates_fast: "./boga test fast; ./boga test mcp-smoke"
gates_slow: "./boga test backend; ./boga test frontend"
docs_touched: "docs/specs/00-product.md, docs/specs/03-technical-architecture.md, docs/specs/05-data-model.md, docs/specs/06-testing-strategy.md, docs/specs/09-project-structure.md, docs/specs/10-api-authn-authz-guidelines.md, docs/specs/tech/sync-v2-server-contract.md, docs/specs/tech/session-planning-contract.md, docs/specs/ui/**, docs/plans/milestones/**, docs/specs/README.md, services/boga-mcp/README.md, supabase/README.md"
---

# M23-T08 — Milestone closeout

## Task metadata

- Task ID: `M23-T08-Milestone_closeout`
- Status: `planned`
- Depends on: `M23-T01` … `M23-T07` merged

## Parent references (required)

- Milestone: `docs/plans/milestones/M23-session-planning-and-programmes.md`
- Contract: `docs/specs/tech/session-planning-contract.md`
- Milestone archive rule: `docs/plans/milestones/README.md`
- Quality/testing: `docs/specs/02-quality-and-test-gates.md`,
  `docs/specs/06-testing-strategy.md`
- Canonical docs inventory: `docs/specs/README.md`

## Objective

Verify M23 on merged `main`, reconcile every source-of-truth document with the
as-built behavior, account for hosted validation, and archive the milestone and
all completed task cards.

## Scope / acceptance criteria

1. **Fresh main.** Start from current `origin/main`, run `./boga doctor`, and
   verify the complete M23 diff/inventory. A bootstrap failure is fixed rather
   than used to skip a lane.
2. **Full local gates.** Run `./boga test fast`, `./boga test backend`, and
   `./boga test frontend` on the closeout commit. Confirm the aggregates include
   `mcp-smoke`, `ios-sync-e2e`, and `ios-session-plans-e2e`; run any missing
   named lane explicitly. Record `./boga timings`, never estimates.
3. **Acceptance matrix.** Map M23 AC1–AC15 to exact automated tests, local
   artifact roots, screenshots, or hosted evidence. Any gap becomes a follow-up
   card and keeps the milestone open rather than being silently accepted.
4. **Product and architecture.** `00-product.md` and
   `03-technical-architecture.md` describe the shipped human/agent plan
   boundary, programme semantics, and materialization path with as-built links.
5. **Data, sync, and auth.** `05-data-model.md`,
   `tech/sync-v2-server-contract.md`, and `10-api-authn-authz-guidelines.md`
   contain the thirteen-entity/five-layer model, backlink, RLS, current-grant
   permission, receipt, service-role boundary, and direct-agent denials.
6. **Runtime and UX docs.** Specs `06`, `09`, and the relevant `ui/*` and `08`
   sections match the actual modules, routes, components, states, lanes,
   fixtures, and evidence policy. Service/agent/Supabase READMEs advertise no
   obsolete "exactly four tools" or universally read-only claim.
7. **Contract truth.** `tech/session-planning-contract.md` is marked as-built,
   links to implementation/tests, and lists every deliberate deviation. No
   active source-of-truth doc describes M23 behavior as merely planned.
8. **Hosted smoke.** Run the T07 hosted discovery, permission, create, pull or
   database inspection, replay/conflict, revocation, performed-row denial, and
   audit checks against the deployed target. If release access is genuinely
   unavailable, record a named owner and release-blocking trigger; local results
   do not satisfy this item.
9. **Archive.** Set task statuses/completion notes, move M23 cards to
   `docs/plans/tasks/`, move this milestone spec to
   `docs/plans/milestones/`, and update every inbound index/reference in
   the same change.
10. **Final validation.** `./boga test docs-check`, task closeout helpers, and
    `./boga test for --diff origin/main` are green after moves and generated-doc
    updates.

## Docs touched (required)

- Every path in frontmatter is reviewed; change only those whose canonical
  statement or index actually needs reconciliation.
- Milestone/task docs are archived rather than left active with a completed
  status.
- The completion note includes the AC evidence matrix, gate results, hosted
  status, deviations, follow-ups, and shipped PR/commit references.

## Testing and verification approach

- Use only repository gate entrypoints and record their generated evidence.
- Run the full gate set in AC2 after the final documentation/archive edits.
- Validate the closeout PR body with `./boga pr check --body <file>` and list
  every aggregate gate as ran or path-triggered N/A according to the current
  PR contract.

## Evidence

## Completion note

- What changed:
- What tests ran:
- What remains:
