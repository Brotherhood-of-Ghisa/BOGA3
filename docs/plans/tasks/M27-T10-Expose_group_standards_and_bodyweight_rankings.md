---
task_id: M27-T10-Expose_group_standards_and_bodyweight_rankings
milestone_id: M27
status: planned
ui_impact: "yes"
areas: "frontend|cross-stack"
runtimes: "node|expo|maestro|supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test frontend"
docs_touched: "docs/specs/tech/groups-contract.md, docs/specs/ui/ux-rules.md, docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md, docs/specs/ui/components-catalog.md"
---

# M27-T10 — Expose group standards and bodyweight rankings

- Status: `planned`
- Depends on: M27-T07, M27-T09.
- Milestone spec: `docs/plans/milestones/M27-bodyweight-load-and-group-comparisons.md`
- Governing decisions: D7–D9.

## Objective and scope

Make group comparison rules, score meaning and input provenance visible across
group exercise setup, linking, podiums, boards and certification. Read AGENTS.md,
specs 02/03/08/09, groups/bodyweight contracts, UI index/policy and T01's target.
Refresh routes/components and HEAD; read test-directory READMEs before edits.

## Deliverables and acceptance

1. Owners/admins edit coefficient, movement/loading standard and default metric
   on the group exercise. Everyone can read the standard. Explain history-wide
   recalculation before a rules edit; a different movement is a new exercise.
   Respect existing online-only group writes and role permissions.
2. Linking shows personal versus group semantics and warns/refuses incompatible
   movements as defined by T08. Never overwrite personal configuration merely
   because it links. Offline member linking remains supported as today.
3. Bodyweight podiums/boards offer Reps, Relative strength and Absolute strength
   with explicit reps/×BW/kg units and Certified/All. Defaults: unweighted
   standard push-ups → Reps; weighted pull-ups/dips → Relative strength.
   Conventional Weight/1RM boards retain their behaviour.
4. Record detail shows raw added/assisted amount, kg and %BW when available,
   session B/source/provenance, group coefficient/rule revision and score basis.
   Certification reveals what is being attested, including estimated B.
5. Update record/void/link cards, history, cached/offline displays, friend session
   metrics and accessibility text for all metrics. Rules recalculation has its
   own explanation, not a spurious new-performance celebration.
6. Missing B offers eligible reps results and explains unavailable strength;
   rebuilding/archived/former-version states follow T08 without mixed rankings.

## UX Contract

Target: T01's bodyweight brief, using existing group forms, boards and record sheet.

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Set group standard | Admin opens exercise → edits rule/default → reviews impact → saves | Members see the same version and updated scores | Offline/role failure preserves form and states nothing changed |
| Link exercise | Member opens link flow → compares standards → links compatible movement | Group evaluates their raw sets without changing personal settings | Incompatible variant explains required separate exercise |
| Compare members | Open podium → switch board and Certified/All → inspect row | Metric/units/default and reason for score are clear | Missing B, empty certified board and rebuilding are actionable |
| Certify performance | Open record sheet → inspect saved B/provenance and load → certify | Attested inputs match score and updated scope | Estimated B is explicit; edited/voided data cannot retain certification |

Reuse existing group recipes and UI tokens; no raw styling exceptions proposed.
Capture each board, relative/absolute reversal, missing/estimated B, offline,
permission/error, rules change and certification states at target sizes. Attach
render comparisons plus happy/error path interaction evidence to the PR.

## Verification and closeout

Run component/view-model tests and two-user flows covering different weights,
group coefficient authority, backfill and correction invalidation. Run
`./boga test fast`, `./boga test backend`, `./boga test frontend`; confirm
`ios-groups-e2e` is included and resolve additional diff requirements with
`./boga test for`. Graduate UX/group contracts, attach evidence, mark the
milestone entry complete and delete this card when shipped.
