---
task_id: M27-T07-Integrate_bodyweight_analytics_and_loading_estimates
milestone_id: M27
status: in_progress
ui_impact: "yes"
areas: "cross-stack"
runtimes: "node|expo|maestro|supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test frontend"
docs_touched: "docs/specs/00-product.md, docs/specs/03-technical-architecture.md, docs/specs/05-data-model.md, docs/specs/tech/bodyweight-load-contract.md, docs/specs/ui/ux-rules.md, docs/specs/ui/screen-map.md, docs/specs/ui/components-catalog.md, docs/specs/ui/design-language.md"
---

# M27-T07 — Integrate bodyweight analytics and loading estimates

- Status: `in_progress`
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


## Local implementation checkpoint

The personal calculation adapters, records/history/Stats coverage, heatmaps,
raw external-load labels and loading calculator are integrated. Shared context
uses frozen session weight with validated provenance and current personal
exercise rules; unknown upgrade metadata stays unavailable. Cross-surface DB
and pure parity tests, calculator UI cases and a fourth `ios-bodyweight` flow
are added. Compact summary figures carry separate incomplete-coverage text.

Actual lint/typecheck and all 178 mobile suites (2,114 tests) passed. The
initial run exposed older blank-as-invalid assertions; confirmed blank load
now consistently means zero with valid reps, with negative/invalid and
unperformed coverage retained. Total 1RM and coverage-shape assertions were
updated. Full `./boga test fast` passed, including backend smoke, repository
checks, consent web and MCP unit/build checks. Full backend passed, including
all 6 sync suites / 15 tests, clean as-built drift, group evaluation contracts
and MCP smoke. Frontend and three-size visual verification remain pending. Logs:
`/tmp/boga-m27-analytics-fast-rerun.log`, `/tmp/boga-m27-analytics-backend.log`.
No shipping completion is claimed. The pre-upgrade offline metadata review gap remains an explicit
integration follow-up: do not resolve unknown actual/planned fields using
migration defaults or infer server absence from a missing bootstrap marker.

Small-phone inspection at `3ac03a6` found the logger amount label wrapping
inside its fixed-height field and crowding the numeric value. Entry and logging
flows passed, but the remaining run was deliberately interrupted (backfill
rc=130) to repair this observed layout defect. The visible labels are now
`Added · kg/lb` and `Assist · kg/lb`, with full meaning/unit accessibility
labels. Full fast passed again (178 suites / 2,114 mobile tests), including
repository, consent and MCP checks: `/tmp/boga-m27-analytics-fast-labels.log`.
Fresh three-size/native verification is pending. Initial
evidence: `M27-analytics-small/20260927-020406-61533/`, BWL04/BWL06.

The next small-phone run at `be6db03` passed entry, logging and backfill,
and confirmed the compact logger labels. Analytics reached all calculator
scenarios through source selection, then failed the bodyweight-only zero
projection: inverse cancellation displayed `Assistance 0.00`. Screenshot
review also caught a stale reading hint after manually editing target B.
The kernel now normalizes only machine-precision cancellation to zero; vectors
retain genuinely small assistance. Target edits update their explanation.
Full fast passed with 178 suites / 2,119 mobile tests, plus all other fast lanes:
`/tmp/boga-m27-analytics-fast-projection-fix.log`. Required backend and native
reruns are pending. Failed-run evidence is
`M27-analytics-small-final/20260927-021437-72662/bodyweight-analytics/`.

Native checkpoint (2026-09-27): the small projection run passed entry, logging,
backfill and analytics through BWA13c, including zero round-trip, corrected
history (816) and incomplete Stats/heatmap rendering. It stopped at a backdrop
label hidden by the modal accessibility boundary; the flow now uses the existing
Stats/share backdrop gestures and waits for dismissal. Failed run preserved at
`M27-analytics-small-projection/20260927-023728-10923/`; no full native pass claimed.
The offline-upgrade review follow-up is integrated before the next complete run.

Small and large phone bodyweight gates are now green at runtime source
`19fc54d` (flow readiness fixes `4ab3ac6` / `ccff804`). Small evidence:
`M27-restart-readiness-small/20260927-042810-28105/`; large evidence:
`M27-picker-readiness-large/20260927-080734-63114/`, all four flows passed.
Large BWO03, BWF06, BWA09 and BWA14 were visually compared with the target:
reviewed 20 kg added + 80 kg B gives 100 kg effective / 127.7 total 1RM / 800
volume; source rows fit; incomplete totals remain explicitly labelled.
`./boga timings` and `./boga test for` were rerun; logs are
`/tmp/boga-m27-picker-timings.log` and `/tmp/boga-m27-picker-required-gates.log`.
Full frontend/default-phone verification remains required and will run after
the remaining group integration, against the integrated milestone source.
No frontend aggregate or shipping completion is claimed.
