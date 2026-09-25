---
task_id: M27-T07-Integrate_bodyweight_analytics_and_loading_estimates
milestone_id: M27
status: planned
ui_impact: "yes"
areas: "cross-stack"
runtimes: "node|expo|maestro|supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test frontend"
docs_touched: "docs/specs/00-product.md, docs/specs/03-technical-architecture.md, docs/specs/05-data-model.md, docs/specs/tech/bodyweight-load-contract.md, docs/specs/ui/ux-rules.md, docs/specs/ui/screen-map.md, docs/specs/ui/components-catalog.md, docs/specs/ui/design-language.md"
---

# M27-T07 — Integrate bodyweight analytics and loading estimates

- Status: `planned`
- Depends on: M27-T03, M27-T04, M27-T05, M27-T06.
- Milestone spec: `docs/plans/milestones/M27-bodyweight-load-and-group-comparisons.md`
- Governing decisions: D1–D6.

## Objective and scope

Use effective load consistently throughout personal training surfaces and make
the total-versus-added distinction understandable. Read AGENTS.md, specs
02/03/05/08/09, bodyweight contract, UI index/policy and target. Refresh all
calculation callers and HEAD; read test-directory READMEs before changes.

## Deliverables and acceptance

1. Replace entered-only arithmetic in session/draft/completion/detail summaries,
   exercise and muscle analytics, catalogue/history heatmaps, personal records,
   comparisons and session-share previews. Audit direct `weight * reps` as well
   as calls to shared helpers. Fetch exercise metadata and session B once per
   graph rather than querying every set.
2. Volume uses effective load; muscle allocation then applies current per-side
   and role factors. Bodyweight strength PRs compare estimated total 1RM using
   historical snapshots. Conventional exercise results and current first-PR,
   warm-up, planned/unperformed and RIR rules remain unchanged.
3. Render unknown dependent metrics as unavailable and partial aggregate volume
   as incomplete. Preserve rep/working-set counts. Do not use incomplete totals
   as comparable full-volume baselines or silently award records from them.
4. Preserve external top-weight meaning with a bodyweight-specific label.
   Show enough context to distinguish `BW + 20`, effective total and total 1RM.
   Historical B remains the source for historic values after new weigh-ins.
5. Add a loading estimate flow: choose source performance/strength estimate,
   target reps and current/target B; show predicted added weight or assistance,
   the total basis and estimate wording. Do not rescore history using target B.
   Raw calculation and any implementable load rounding stay separate.
6. Editing B/coefficient or applying backfill refreshes every affected projection
   without persisting a personal achievement or derived-metric ledger.

## UX Contract

Target: T01's bodyweight brief with existing exercise/history/session targets.

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Inspect workout | Log/complete/open a BW session → inspect rows, totals and records | Effective volume and total 1RM agree across surfaces | Missing B shows unavailable/partial data with a correction route |
| Plan added load | Open exercise estimate → select target reps/B | Added load or assistance is actionable and explicitly estimated | Unknown B, invalid target or missing source explains why no answer exists |
| Inspect corrected history | Backfill/correct B or coefficient → reopen history/share preview | All projections refresh from the same inputs | Incomplete history never looks like a complete comparison baseline |

Reuse numeric Stat roles, logger/history/detail components, sheets and UI
tokens; no raw style exceptions proposed. Capture weighted/unweighted,
assisted, incomplete totals, historical corrections and calculator results,
including narrow-width/accessibility states, against T01's target.

## Verification and closeout

Assert cross-surface parity on T03 vectors and regress conventional lifts,
per-side muscle volume, completion PRs/comparisons and generated share content.
Run `./boga test fast`, `./boga test backend`, `./boga test frontend` and resolve
any additional actual-diff lanes with `./boga test for`.
Update entered-volume/1RM specs where semantics intentionally change, and stale
formula references. Attach evidence, mark the milestone entry complete and
delete this card when shipped.
