# M36 — RM Performance Curve Analytics

- Status: `in_progress`
- Approval: the product owner accepted the initial analytical contract on 2026-10-13: “All accepted as a first deloverable”. The owner subsequently authorized all-known-RIR normalization u=m+n for the analytical view. Empirical reliability, human design approval and UI acceptance remain pending.
- Created: 2026-10-13, planning baseline `68f6a1c6d1892edb5de176edafd2bf5fbef1eb91` on `origin/main`
- Tracking: repository milestone and task cards only.
- Experimental workflow: on 2026-10-13 the owner authorized continuing on branches while usefulness is uncertain. T02 starts from reviewed T01 commit `43482cd7de537dfce0982acfdbc8b8ab8b109bab`, without merging T01 into main; its future draft PR targets `m36-t01-rm-curve-contract`. Further integration requires explicit owner direction. Analytical, empirical, design and test gates remain in force.
- Research only so far: the initial analytical contract is approved; production implementation and visual design have not started.

## Objective

Build an analytical framework to compare actual exercise sets with BoGa’s estimated RM curve, investigate systematic deviations and strength changes over time. The first production release is an interactive RIR0-equivalent-repetitions-versus-load chart of qualifying observed sets with an estimated reference curve. Structural break detection is research and validation only.

## Scope

- In: reconstruct the adopted RM curve; comparable-effort and RIR cohort research; historical/current reference selection; signed and percentage-normalised residuals; exploratory trend/segmented regression and statistical reliability; dataset provenance and empirical/synthetic validation; approved scatter/curve design; read-only transformations, focused tests and final selected-exercise navigation exposure.
- Out: competing RM formulas; changing logged reps, global 1RM or record calculations; changed global working-set/record/load conventions; production structural-break detection, dates, markers, alerts or significance claims; regression dashboard/residual timeline; cross-exercise rankings, group/coaching changes, new sync/schema or analytics-platform rewrite. Research reliability need not establish a production detector to ship the chart.

## Agreed design direction

These D entries record constraints from the brief and repository; the visual target and analytical choices are still open.

### D1. Preserve the single calculation and loading authority

Reuse [[1rm.formula]], [[set.performed]] and [[set.eligibility]], the kernel and definition-ID identity. Global metrics still use actual performed reps; RIR affects eligibility without rewriting them. The owner authorized a separate analytical assumption ([[1rm.curve-effort]]): u=m+n for known recorded RIR, analytical total RM from the existing estimator at u, and explicitly equivalent-reps X. Retain actual m/n, displayed 1RM, current working policy and load semantics. Unknown RIR is not zero; reject unsafe sums/nonfinite results. No competing formula or loading reinterpretation.

### D2. Research precedes empirical review and product design

Order: **Research → Empirical validation → Design → Implementation and testing → UI exposure**. Research findings do not decide an open product fact or alter an accepted one. T01's first-deliverable effort/reference/load-coordinate rules are approved in [[1rm.curve-population]], [[1rm.curve-effort]], [[1rm.curve-reference]] and [[1rm.curve-load]]; T04 still closes empirical review with explicit human analytical/product approval before T05 begins. Unsupported real-data evidence must be reported honestly and its limitations accepted.

### D3. First release is the observed-set scatter and reference overlay

X-axis is explicitly RIR0-equivalent reps u=m+n; Y-axis is the approved load coordinate under existing semantics. Include observed qualifying sets, estimated reference curve, date/recency differentiation, exact date/actual reps/recorded RIR/equivalent reps/load/existing 1RM details and exercise/time-range/effort filters. Missing effort, overlap, insufficient data, failures and accessibility are required states. Statistical experiments stay isolated from production imports, dependencies and sync.

### D4. Human approval gates control design and UI acceptance

T05 follows `docs/specs/08-ux-delivery-standard.md` and `docs/specs/ui/ai-design-policy.md`, reusing the design system/chart patterns. Use Figma where appropriate and pin exact frames/version if selected; external artifacts remain in their native environment. Record human design approval before substantial UI implementation or UI acceptance testing. T08 obtains human hands-on acceptance of the implemented chart before its agreed UI acceptance suite. Material changes return to approval; automated checks cannot substitute for the human gate. New observable product rules need product-owner approval.

### D5. UI exposure is the final implementation step

T06–T08 build and review transformations and chart/page content without a new production `app/` route, root-stack registration or user-facing entry. Use isolated developer preview/rendering for review. Only T09 wires the approved selected-exercise entry, typed route and existing Back/context behavior. After that, only validation, required fixes and closeout remain; no deferred feature is silently added.

### D6. Reuse one weekly wave scenario across the tasks

The user requests a shared representative weekly wave programme followed by one individual, using all known recorded RIRs that vary by phase, and one gym, with analytical progress inspectable week by week. Each task proves its own part against the same scenario; it does not create a separate history or repeat earlier assertions. The approved fixed historical reference is unchanged. Additional weekly fitted curves and exact programme parameters remain clarification questions, not production features or prescriptions.

## Shared weekly wave validation scenario — parameters provisional

Use one canonical synthetic input family through the adopted kernel. The primary plateau/repeated-exposure story is illustrative input; stable and smooth-linear controls retain their own constructed ground truth. Choose its exercise/load context, rep sequence, weeks, sessions per week, prior baseline span, progression/noise parameters and fixture location during research, after human clarification. One individual/gym and known phase-dependent recorded RIR simplify comparison; they do not remove estimator or within-session uncertainty. No particular rep prescription or new weekly-curve UI is approved here.

The [provisional starter dataset](../research/M36-weekly-wave-example.json) retains raw inputs and synthetic/provisional flags: 24 prior sets in eight sessions (six qualify at u1–10), then 72 sets in each plateau, stable and smooth-linear scenario across 24 synthetic weekly sessions. Actual set 1RM is separate from analytical RM. The main plateau story repeats same-phase load/reps before increasing load; stable analytical capacity100 and smooth101–124 remain methodological controls, not realistic progress expectations. Programme inspiration is a generic 24-session roadmap from [the programme reference](https://app.notion.com/p/3b3a4905c27481e580a1d9ca744d5bbf), last edited 2026-10-13: repeat Volume 3×8 target RIR2–3, Strength 3×6 target2, Heavy 3×4 target2 (later Heavy may target3–4), and Technique/reset 3×8 target4. The source fixes no calendar: weekly spacing, actual logged RIRs, loads and trajectories in our example are synthetic assumptions, not an approved prescription or verified personal history. Targets/annotations and uncertain imported effort cannot serve as measured RIR. Only this generic pattern is retained; no personal health/location/history is copied. A reset phase logged rir_4 remains working under existing policy, not a relabelled Technique/warm-up set. T03 reconciles actual starter rows; T04 validates/freezes the canonical fixture. Fixed six-prior-session reference remains, with support measured over u=1–10. For example 8@RIR3 (u11) and reset 8@RIR4 (u12) are observations outside reference support; never silently widen it.

The shared scenario needs these variants and prefix views:

- **Primary plateau/repeated exposure:** six four-phase waves use active first-set RIR1/1/2/3/1/2. Hold each active phase’s load/reps across the first four exposures; waves5/6 use higher phase loads, with wave5 RIR1 matching wave4 RIR3 analytical RM. The third set repeats load with RIR one lower; reset stays RIR4 and its load is constructed from the Heavy estimate. Check flat repeats, same-load RIR progress and load increases without inventing physiological ground truth or a statistically established break. Analytical RM varies slightly across rep phases; this is not one exact latent-capacity trajectory.
- **Stable-strength control:** vary weekly performed rep/RIR targets and corresponding loads while keeping the latent RM level fixed. Heavier loads in lower-rep weeks must not be classified or presented as strength gain. In a noiseless algebraic control, qualifying points at u=m+n remain on the same analytical RM curve; noise sensitivity is separate.
- **Smooth-linear methodological control:** retain the existing known progressive RM trajectory with the same wave reps/RIRs. Show how observed sets/residuals move relative to the fixed prior reference; smooth progress must not become an established structural-break claim.
- **Weekly prefixes:** inspect only history available through each week. Keep evaluation start and its independent historical baseline fixed across prefixes, excluding evaluated/future sessions from that baseline. Earlier prefix outputs must be invariant to adding later workout rows; changing a dated source input is a separate retroactive-metadata test.
- **Insufficient baseline:** truncate prior support below the approved six qualifying sessions. Observed points may remain, but no reference curve or reference residual is fabricated and the cohort does not widen automatically.

T02 specifies the model/validation contract; T03 audits provenance and reconciles inputs; T04 creates/freezes the canonical fixture and expected numerical progression. T06 reuses its raw data in transformations, T05/T07 use its same prefix outputs as design/render inputs, and T08/T09 reuse them for integrated acceptance and navigation. Reuse the fixture through existing test-helper conventions; no exploratory regression tooling enters production imports. The synthetic story supplements authorized historical validation, never replaces it or establishes statistical significance.

| Task | Proof using the shared scenario |
| --- | --- |
| T01 | Completed algebraic reconstruction and illustrative weekly-prefix progression against a fixed prior reference; synthetic parity/control evidence, not empirical formula validation. |
| T02 | Predefine plateau/repeated-exposure interpretation and separate stable/smooth control expectations, session dependence, rep-wave confounding and prefix/cutoff checks; no production detector. |
| T03 | Reconcile actual starter rows, weekly counts, identities, recorded-RIR/target distinction and gym provenance, baseline support and eligible prefix populations; distinguish synthetic from empirical data. |
| T04 | Verify illustrative plateau outputs and known stable/smooth control trajectories separately; measure method reliability separately with seeded simulations. |
| T05 | Human-review week-by-week scatter/reference/readout and sparse-state targets; weekly fitted-curve feature remains subject to clarification. |
| T06 | Prove filtered prefix points, fixed reference, residual/projection values and no future leakage over the reused data. |
| T07 | Prove geometry, recency, point access and state rendering against the existing oracle, without redoing reference arithmetic. |
| T08 | Reconcile the running integrated view and accessible readouts with that oracle after human design approval; reuse numerical evidence. |
| T09 | Reach the correct selected-exercise scenario and return safely; verify navigation/context, not another chart-fit experiment. |

Pending clarification: whether the user wants additional per-week fitted curves rather than only week-by-week progress against the approved reference, and which remaining synthetic timing/load/progression parameters are suitable. Until resolved, keep weekly fitting exploratory and all exact programme parameters provisional. Research evidence may illustrate prefixes without approving a new production control or overlay.

## Task breakdown

One card = one session = one local worktree = one PR under `docs/plans/README.md` task protocol. The planning PR has landed. T01's research and first analytical approval are delivered in draft PR #727; [detailed research](../research/M36-T01-rm-curve-contract.md) remains reproducible. The owner's experimental-branch exception permits research continuation before parent PRs merge. T02's research specification, method checks and repository gates are complete; on 2026-10-14 the owner approved proceeding to T03 after reviewing the [validation plan](../research/M36-T02-residual-regression-method.md). T03 will use synthetic histories and read-only test-user data in remote BOGA_DEV. Empirical reliability and human design approvals remain separate.

| Task | Summary | Depends on | Status |
| --- | --- | --- | --- |
| M36-T01 | Reconstruct the RM curve and agree effort/reference contracts | none | completed |
| M36-T02 | Specify exploratory residual regression and break reliability | T01 | completed |
| [M36-T03](../tasks/M36-T03-Workout_data_and_curve_validation.md) | Audit workout data and empirically validate the RM curve | T02 | planned |
| [M36-T04](../tasks/M36-T04-Regression_validation_and_research_review.md) | Validate regression with known behaviours and approve research findings | T03 | planned |
| [M36-T05](../tasks/M36-T05-Approve_RM_chart_design.md) | Design and obtain human approval of the RM scatter chart | T04 | planned |
| [M36-T06](../tasks/M36-T06-RM_chart_data_transformations.md) | Implement RM chart data transformations and real-data tests | T05 | planned |
| [M36-T07](../tasks/M36-T07-Implement_approved_RM_chart.md) | Implement the approved interactive chart without UI exposure | T06 | planned |
| [M36-T08](../tasks/M36-T08-Validate_chart_before_exposure.md) | Validate the integrated chart and obtain human UI acceptance | T07 | planned |
| [M36-T09](../tasks/M36-T09-Expose_RM_analytics_and_closeout.md) | Expose exercise RM analytics through existing navigation — final implementation step | T08 | planned |

## Ordered workstreams

| Workstream | Tasks | Depends on |
| --- | --- | --- |
| 1. Analytical research and modelling | T01, T02 | none |
| 2. Empirical testing against data | T03, T04 | WS1 |
| 3. Graphics and design | T05 | WS2 |
| 4. Implementation and validation | T06, T07, T08 | WS3 |
| 5. Final UI exposure | T09 | WS4 |

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

Existing Progress exploration and Timeline provide integration precedents. Verify working-set RM eligibility and reuse shared set/record presentation at execution; this milestone does not replace those rules. Absolute versus %BW personal-record meaning remains an open product question outside this milestone. Gym splitting and heatmap label alignment are separate work; investigate gym sensitivity without implementing either feature here. The repository discovery found no duplicate RM-curve/research scope. M36 follows the highest M35 in full main history at planning time.

## Testing proposals and execution constraints

| Workstream | Proposed evidence / gates |
| --- | --- |
| Research | Formula round-trip/parity and effort/cutoff/load examples; primary-source methods review, reproducible research specifications. Code experiments add focused checks; no detector UI. |
| Empirical | Provenance/count reconciliation; historical cohort/holdout residual diagnostics; seeded no-break, gradual trend, slope/level-break simulations with session dependence. Report false-positive/power/localization/uncertainty evidence and limitations. |
| Design | Target/state/token/accessibility review and explicit human approval. No UI acceptance run before approval. |
| Implementation | Pure transformation/geometry Jest, chart interactions and real migrated SQLite integration/regression tests; representative T03/T04 histories shared across tasks. `fast` and three quality lanes before code PRs; minimal device checks by agreement after human gates. |
| Final exposure | Route/context/return and logging/history regressions; `boga test for` on final diff plus cumulative milestone paths; agreed native navigation lanes and final evidence. Root-stack/access/harness changes propose `frontend`; ordinary UI defaults propose `frontend-ui` plus affected area lanes. |

Read test-directory READMEs before edits. One canonical assertion per claim; reuse histories and chart evidence, run focused checks during iteration, then mandatory finished-PR checks once. Do not repeat the full backend or unrelated feature suite after every task; rerun affected checks after fixes or material changes. This plan grants no gate exemption. Lanes beyond `fast`, new Maestro scenarios, threshold/baseline changes and releases/sweeps follow operator agreement under AGENTS.md and spec 02. No durations are estimated. Evidence stays in PRs; approve device-only scenarios before authoring them. If a gate fails to bootstrap, use `./boga doctor` and fix it.

The shared wave adds task-specific evidence, not another aggregate lane. Record canonical fixture version, prefix boundary and the task's new proof; reuse unchanged earlier oracles/screenshots, running each stage's appropriate tests once. Test baselines and prefixes with Jest/numerical checks; approve any device-only scenario separately.

## Risks / dependencies and unresolved decisions

1. Effort comparability: the approved initial RIR/cohort choice is [[1rm.curve-population]]; subjective labels and possibly enriched fixture provenance still need empirical validation. Normalized analytical effort is the approved assumption [[1rm.curve-effort]], not a change to global metrics or established RIR accuracy.
2. Reference: [[1rm.curve-reference]] fixes the initial historical estimator/window/support; rolling/current/all-time comparisons remain research sensitivities. The approved support minimum is not statistically established reliability.
3. Load coordinate: [[1rm.curve-load]] approves a coherent chart coordinate across dated bodyweight contexts; absolute versus %BW personal records remain unchanged. Current kernel applies the entry factor once, including ordinary per-side loads; avoid an additional conversion. Same-gym cohorts still cannot exclude equipment/technique confounding.
4. Residual definitions: signed/percentage normalization and zero/undefined handling are approved in `docs/specs/tech/training-metrics-contract.md` §6. Empirical/domain sensitivity and no-reference/insufficient-data presentation remain to validate and design.
5. Break modelling: level/slope alternatives, breakpoint search, minimum independent sessions, cluster/autocorrelation treatment, selection penalties and uncertainty. Sparse histories and changing rep ranges can mimic breaks; visual shifts never establish significance.
6. Design: Figma or repo-native target, recency/overlap selection, approved filter defaults/ranges, accessible legend and exact selected-exercise entry. Human review resolves these in T05, not this plan.
7. Concurrent Progress, effort and presentation work may change integration seams; recheck current main without loading unrelated plans as authority. No first-release backend/schema/sync change is expected; any proposed expansion requires human scope review and corresponding local gates.

## Definition of Done

- All nine task PRs merged; research/empirical findings and reproducibility evidence linked, including failures/limitations and real-data availability/provenance.
- Human analytical/product approval precedes design; a pinned human-approved design precedes UI acceptance tests; implemented chart and final entry/return flow have human acceptance.
- Interactive chart shows qualifying observed sets against the adopted reference, recency, exact details and approved exercise/time/effort filters; missing effort, overlap, empty/insufficient/error and accessible phone states meet the approved target.
- Existing RM/effort/load semantics and raw history remain intact; focused unit, real-data integration and regression tests plus all agreed local lanes and quality targets are green with PR evidence.
- The shared weekly wave scenario demonstrates plateau/repeated-exposure progression under the analytical assumption, separate stable/smooth controls, future-free weekly prefixes and insufficient baseline support across each task's own proof; one fixture/oracle is reused and synthetic limits are explicit.
- Structural break work remains exploratory and absent from production UI/runtime; no unapproved product fact or loading change ships.
- T09 is the final implementation step and exposes the view for a selected exercise without disrupting logging, history or analytics context.
- Durable decisions live with their owning product/spec/code/tests; final shipping PR deletes ephemeral cards/spec and completes worktree/stack cleanup after merge. No implementation begins from this planning session.
