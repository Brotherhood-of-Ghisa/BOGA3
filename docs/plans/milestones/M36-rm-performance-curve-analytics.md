# M36 — RM Performance Curve Analytics

- Status: `planned`
- Created: 2026-10-13, planning baseline `68f6a1c6d1892edb5de176edafd2bf5fbef1eb91` on `origin/main`
- GitHub milestone: https://github.com/Brotherhood-of-Ghisa/BOGA3/milestone/1
- Planning only: no milestone implementation or analytical/design decision is approved by this plan.

## Objective

Build an analytical framework to compare actual exercise sets with BoGa’s estimated RM curve, investigate systematic deviations and strength changes over time. The first production release is an interactive repetitions-versus-load chart of qualifying observed sets with an estimated reference curve. Structural break detection is research and validation only.

## Scope

- In: reconstruct the adopted RM curve; comparable-effort and RIR cohort research; historical/current reference selection; signed and percentage-normalised residuals; exploratory trend/segmented regression and statistical reliability; dataset provenance and empirical/synthetic validation; approved scatter/curve design; read-only transformations, focused tests and final selected-exercise navigation exposure.
- Out: competing RM formulas; reps + RIR estimation; changed global working-set/record/load conventions; production structural-break detection, dates, markers, alerts or significance claims; regression dashboard/residual timeline; cross-exercise rankings, group/coaching changes, new sync/schema or analytics-platform rewrite. Research reliability need not establish a production detector to ship the chart.

## Agreed design direction

These D entries record constraints from the brief and repository; the visual target and analytical choices are still open.

### D1. Preserve the single calculation and loading authority

Reuse [[1rm.formula]], [[set.performed]] and [[set.eligibility]], the existing calculation kernel and current definition-ID identity. Source behavior is Wathan with a single-rep special case; effort governs eligibility, not the reps passed to the formula. Do not introduce a second formula or reinterpret ordinary total/per-side entry, personal bodyweight settings, dated readings or retroactive metadata. Formula reconstruction must be checked against existing functions/vectors.

### D2. Research precedes empirical review and product design

Order: **Research → Empirical validation → Design → Implementation and testing → UI exposure**. Research findings do not decide an open product fact or alter an accepted one. T01 proposes effort/reference/load-coordinate rules; T04 closes empirical review with explicit human analytical/product approval before T05 begins. Unsupported real-data evidence must be reported honestly and its limitations accepted.

### D3. First release is the observed-set scatter and reference overlay

X-axis is repetitions; Y-axis is the approved load coordinate under existing semantics. Include observed qualifying sets, estimated reference curve, date/recency differentiation, exact point date/reps/load/effort/estimated RM details and exercise/time-range/effort filters. Missing effort, overlap, insufficient data, failures and accessibility are required states. Statistical experiments stay isolated from production imports, dependencies and sync.

### D4. Human approval gates control design and UI acceptance

T05 follows `docs/specs/08-ux-delivery-standard.md` and `docs/specs/ui/ai-design-policy.md`, reusing the design system/chart patterns. Use Figma where appropriate and pin exact frames/version if selected; external artifacts remain in their native environment. Record human design approval before substantial UI implementation or UI acceptance testing. T08 obtains human hands-on acceptance of the implemented chart before its agreed UI acceptance suite. Material changes return to approval; automated checks cannot substitute for the human gate. New observable product rules need product-owner approval.

### D5. UI exposure is the final implementation step

T06–T08 build and review transformations and chart/page content without a new production `app/` route, root-stack registration or user-facing entry. Use isolated developer preview/rendering for review. Only T09 wires the approved selected-exercise entry, typed route and existing Back/context behavior. After that, only validation, required fixes and closeout remain; no deferred feature is silently added.

## Task breakdown

One card = one session = one local worktree = one PR under `docs/plans/README.md` task protocol. Land this plan as a docs-only PR before T01 starts. No task is executing. The completing PR deletes its card and marks it completed here; execution starts only when dependencies are completed and required approvals recorded.

| Task | Summary | Depends on | Status | GitHub issue |
| --- | --- | --- | --- | --- |
| [M36-T01](../tasks/M36-T01-RM_curve_and_effort_contract.md) | Reconstruct the RM curve and agree effort/reference contracts | none | planned | [#714](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/714) |
| [M36-T02](../tasks/M36-T02-Exploratory_residual_regression.md) | Specify exploratory residual regression and break reliability | T01 | planned | [#715](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/715) |
| [M36-T03](../tasks/M36-T03-Workout_data_and_curve_validation.md) | Audit workout data and empirically validate the RM curve | T02 | planned | [#716](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/716) |
| [M36-T04](../tasks/M36-T04-Regression_validation_and_research_review.md) | Validate regression with known behaviours and approve research findings | T03 | planned | [#717](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/717) |
| [M36-T05](../tasks/M36-T05-Approve_RM_chart_design.md) | Design and obtain human approval of the RM scatter chart | T04 | planned | [#718](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/718) |
| [M36-T06](../tasks/M36-T06-RM_chart_data_transformations.md) | Implement RM chart data transformations and real-data tests | T05 | planned | [#719](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/719) |
| [M36-T07](../tasks/M36-T07-Implement_approved_RM_chart.md) | Implement the approved interactive chart without UI exposure | T06 | planned | [#720](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/720) |
| [M36-T08](../tasks/M36-T08-Validate_chart_before_exposure.md) | Validate the integrated chart and obtain human UI acceptance | T07 | planned | [#721](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/721) |
| [M36-T09](../tasks/M36-T09-Expose_RM_analytics_and_closeout.md) | Expose exercise RM analytics through existing navigation — final implementation step | T08 | planned | [#722](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/722) |

## Ordered workstreams

| Workstream | Tasks | Depends on | Tracking issue |
| --- | --- | --- | --- |
| 1. Analytical research and modelling | T01, T02 | none | [#709](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/709) |
| 2. Empirical testing against data | T03, T04 | WS1 | [#710](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/710) |
| 3. Graphics and design | T05 | WS2 | [#711](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/711) |
| 4. Implementation and validation | T06, T07, T08 | WS3 | [#712](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/712) |
| 5. Final UI exposure | T09 | WS4 | [#713](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/713) |

The dependency chain is T01 → T02 → T03 → T04 → T05 → T06 → T07 → T08 → T09. Workstreams are intentionally ordered; no production design/implementation runs ahead of empirical review.

## Repository discovery and related work

Verified at the planning baseline; recheck current main at task start. Existing plans are working notes, never authority for the new implementation.

| Area | Existing source / implication |
| --- | --- |
| Adopted RM and effort | `apps/mobile/src/exercise-calculations/index.ts` (`estimateOneRepMax`), `load-metrics.ts` (`calculateSetMetrics`, `resolveCalculatedLoad`), `effort-policy.ts` (`getSessionSetRir`), `set-semantics.ts`; `src/config/personal-effort.ts` passes device policy. Use facts, not cloned constants/predicates. |
| Raw model | `src/data/schema/exercise-definitions.ts`, `session-exercises.ts`, `exercise-sets.ts`, `sessions.ts`: canonical definition ID, Weight/reps text, raw effort, confirmation/tombstones and session dates; current metadata reinterprets history. |
| History/analytics | `apps/mobile/src/data/exercise-history.ts`, `exercise-analytics.ts`, `exercise-session-facts.ts`, `stats.ts`, `src/session-insights/`. Aggregate daily/weekly metrics and per-session facts lose individual scatter points/raw effort; reuse raw reads and facts only where sufficient. |
| Rendering/design | `apps/mobile/components/heatmaps/TimelineHeatmap.tsx` and `timeline.ts` use installed `react-native-svg`, pure geometry, tokens, readout/selection and accessibility; Daily/Weekly charts and `components/stats/history-view.tsx` provide filters/state patterns. No scatter primitive was found. |
| Navigation | `apps/mobile/src/navigation/routes.ts`, `app/progress-history.tsx`, `app/exercise-history.tsx`, `components/navigation/root-stack.tsx`; use canonical ID and established history/back transitions. |
| Historical candidate | `apps/mobile/scripts/import/fixtures/dev-rich-history.boga-import.json`: 221 sessions, 886 blocks, 2,910 sets, 116 exercise decisions, completed dates 2024-12-23–2026-06-04. Metadata names GymBook; verify original/enriched effort provenance before statistical use. Observed labels: warm-up 886, unspecified 720, RIR 2/1/0 620/346/338. Original XML was not found in tracked repository files. |
| Existing validation assets | `load-metrics-vectors.json`; calculation/load/effort tests, exercise history repository tests, `__tests__/helpers/local-data.ts`, timeline/history tests and import-contract fixtures. These support regression correctness, not population-level statistical claims. |

Related work: [#404](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/404) / M31 Progress exploration and [#639](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/639) Timeline are integration precedents, not duplicate curve work. [#681](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/681) tracks working-set RM eligibility: verify current behavior and avoid duplicating its fix. [#654](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/654) tracks shared set/record presentation: reuse the resulting presentation where relevant. [#677](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/677) leaves absolute versus %BW personal-record meaning open: this milestone does not choose it. [#707](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/707) and [#499](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/499) cover gym splitting; research gym sensitivity without implementing that feature. [#708](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/708) concerns heatmap label alignment, outside this feature. No existing GitHub milestone or issue covers the RM-curve/research scope. M36 follows the highest M35 in full main history; no open PR reserved a later ID at planning time.

## Testing proposals and execution constraints

| Workstream | Proposed evidence / gates |
| --- | --- |
| Research | Formula round-trip/parity and effort/cutoff/load examples; primary-source methods review, reproducible research specifications. Code experiments add focused checks; no detector UI. |
| Empirical | Provenance/count reconciliation; historical cohort/holdout residual diagnostics; seeded no-break, gradual trend, slope/level-break simulations with session dependence. Report false-positive/power/localization/uncertainty evidence and limitations. |
| Design | Target/state/token/accessibility review and explicit human approval. No UI acceptance run before approval. |
| Implementation | Pure transformation/geometry Jest, chart interactions and real migrated SQLite integration/regression tests; representative T03/T04 histories shared across tasks. `fast` and three quality lanes before code PRs; minimal device checks by agreement after human gates. |
| Final exposure | Route/context/return and logging/history regressions; `boga test for` on final diff plus cumulative milestone paths; agreed native navigation lanes and final evidence. Root-stack/access/harness changes propose `frontend`; ordinary UI defaults propose `frontend-ui` plus affected area lanes. |

Read test-directory READMEs before edits. One canonical assertion per claim; reuse histories and chart evidence, run focused checks during iteration, then mandatory finished-PR checks once. Do not repeat the full backend or unrelated feature suite after every task; rerun affected checks after fixes or material changes. This plan grants no gate exemption. Lanes beyond `fast`, new Maestro scenarios, threshold/baseline changes and releases/sweeps follow operator agreement under AGENTS.md and spec 02. No durations are estimated. Evidence stays in PRs; approve device-only scenarios before authoring them. If a gate fails to bootstrap, use `./boga doctor` and fix it.

## Risks / dependencies and unresolved decisions

1. Effort comparability: strict RIR values/ranges, missing/unknown effort and high legacy RIR; RIR labels are subjective and fixture provenance may be enriched. No automatic RIR correction to the adopted formula.
2. Reference: historical baseline versus current/rolling/all-time estimate, robust estimator, window/cutoff and minimum support. Per-point self-references make residuals tautological; later data must not leak into historical evaluation.
3. Load coordinate: entered/displayed versus internal calculated load and a coherent overlay across changing bodyweight contexts; do not decide #677 or double ordinary per-side loads. Gym/equipment changes can confound a trend.
4. Residual definition and valid domains: signed/percentage normalization, zero denominator, extreme reps/extrapolation, no-reference and insufficient-data presentation.
5. Break modelling: level/slope alternatives, breakpoint search, minimum independent sessions, cluster/autocorrelation treatment, selection penalties and uncertainty. Sparse histories and changing rep ranges can mimic breaks; visual shifts never establish significance.
6. Design: Figma or repo-native target, recency/overlap selection, approved filter defaults/ranges, accessible legend and exact selected-exercise entry. Human review resolves these in T05, not this plan.
7. Concurrent Progress, effort and presentation work may change integration seams; recheck current main without loading unrelated plans as authority. No first-release backend/schema/sync change is expected; any proposed expansion requires human scope review and corresponding local gates.

## Definition of Done

- All nine task PRs merged; research/empirical findings and reproducibility evidence linked, including failures/limitations and real-data availability/provenance.
- Human analytical/product approval precedes design; a pinned human-approved design precedes UI acceptance tests; implemented chart and final entry/return flow have human acceptance.
- Interactive chart shows qualifying observed sets against the adopted reference, recency, exact details and approved exercise/time/effort filters; missing effort, overlap, empty/insufficient/error and accessible phone states meet the approved target.
- Existing RM/effort/load semantics and raw history remain intact; focused unit, real-data integration and regression tests plus all agreed local lanes and quality targets are green with PR evidence.
- Structural break work remains exploratory and absent from production UI/runtime; no unapproved product fact or loading change ships.
- T09 is the final implementation step and exposes the view for a selected exercise without disrupting logging, history or analytics context.
- Durable decisions live with their owning product/spec/code/tests; final shipping PR deletes ephemeral cards/spec, closes linked GitHub issues/milestone after merge and completes worktree/stack cleanup. No implementation begins from this planning session.
