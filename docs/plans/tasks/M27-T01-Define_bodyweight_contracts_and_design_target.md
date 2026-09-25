---
task_id: M27-T01-Define_bodyweight_contracts_and_design_target
milestone_id: M27
status: planned
ui_impact: "yes"
areas: "docs|cross-stack"
runtimes: "docs|expo|maestro"
gates_fast: "./boga test docs-check"
gates_slow: "N/A for a documentation-only diff; ./boga test for governs any implementation changes"
docs_touched: "docs/specs/tech/bodyweight-load-contract.md, docs/specs/ui/design-targets/bodyweight.md, docs/specs/ui/README.md"
---

# M27-T01 — Define bodyweight contracts and the design target

- Status: `planned`
- Depends on: none.
- Milestone spec: `docs/plans/milestones/M27-bodyweight-load-and-group-comparisons.md`
- Governing decisions: D1–D10; this task resolves representation, not the already accepted product choices.

## Objective and scope

Pin executable domain and UI contracts before schema and consumer work diverge.
Read AGENTS.md and specs 02/03/05/08/09/10, the Sync v2 and groups contracts,
`ui/README.md`, `ui/ai-design-policy.md`, and the existing accepted design targets.
Do not read unrelated plans. At implementation start record current HEAD,
freshness against origin/main and any changed code assumptions in the PR.

## Deliverables and acceptance

1. A concise `tech/bodyweight-load-contract.md` records M27 behaviour as planned
   until its implementation ships: typed measurements, snapshots/provenance,
   coefficient and actual/planned adjustment modes, resolver result/completeness,
   numeric units and validation, group metrics and rule revisions.
2. Specify valid load-mode combinations and the order of external per-side
   normalization, body contribution and muscle allocation. Preserve conventional
   exercise results. Specify zero/negative effective resistance and the Wathan
   inverse/one-rep boundary, with shared numeric vectors for T03.
3. Resolve legacy entered-load interpretation with T05's inventory. Do not
   silently classify an entered 80 as either body weight or added plates.
   Define a reviewable conversion and how unresolved data stays unranked.
4. Specify private weight history versus authorised shared snapshot context,
   rule-version rebuild visibility and certification dependency fingerprints.
   Estimated backfill values are visible, editable inputs, not verified readings.
5. Pin a repo-native design brief plus reference captures for Settings, session
   weight, backfill, exercise entry/estimates, group standards and boards. Use
   existing accepted targets as references and document any material conflicts.
   Do not invent accepted screenshots or require an external design service.
6. Link the new contract from the owning indexes/specs with truthful planned
   status. Leave rollout/deployment to T12; create no production schema here.

## UX Contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Record current weight | More → Settings → Body weight → enter value/unit/date → save | Latest reading visible; next session receives it | Invalid input stays editable; offline local save works |
| Supply historical weight | Settings → Fill missing session weights → date range/selection → preview → apply | Chosen empty snapshots filled, later-source rows labelled estimated | No readings, changed preview or already-filled rows explained |
| Understand performance | Open a set/record → inspect external load, B, coefficient and score basis | Total, relative and added-load meanings are distinguishable | Missing context shows unavailable metrics and a correction route |
| Compare members | Open group exercise → select its default or another board → record details | Group rules and Certified/All scope remain visible | Incompatible links, rebuilding and missing-data states are explicit |

Reuse `components/ui` tokens, PageHeader, ListRow, fields, sheets, notices and
the existing logger/record-detail recipes; no raw styling exceptions proposed.
T04–T10 own implementation screenshots for their happy/error/offline/estimated
states and must compare them to this target at the chosen phone sizes.

## Verification and closeout

- Validate links and contract examples; run `./boga test docs-check` and resolve
  `./boga test for` for the actual diff. No runtime gate is waived if code changes.
- Target evidence belongs in the PR. Update the milestone entry, then delete
  this card when shipped; implementation tasks must not depend on a deleted
  plan as their sole durable contract.
