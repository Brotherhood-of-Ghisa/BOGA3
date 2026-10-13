# RM curve reconstruction and proposed analytical contract

Research prepared against `7b6dc3fd` on 2026-10-13. **All observation/default/reference/axis choices below are proposals awaiting product-owner approval.** This note does not change product facts, global eligibility, records, input semantics or production calculations. T01 remains in progress; T02 has not started.

## Existing authority and integration seams

| Input or behaviour | Current authority | Consequence for this research |
| --- | --- | --- |
| Estimated RM | [[1rm.formula]]; `estimateOneRepMax` in `apps/mobile/src/exercise-calculations/index.ts` | Use the existing function, including its single-rep branch. Effort is not an estimator argument. |
| Actual values and working eligibility | [[set.performed]], [[set.eligibility]]; `isWorkingSet` in `apps/mobile/src/exercise-calculations/set-semantics.ts` | Resolve confirmed performance and current account policy first, then apply a separately labelled analytical cohort. |
| Effort parsing | `getSessionSetRir` in `apps/mobile/src/exercise-calculations/effort-policy.ts` | Retain raw labels; canonical numerical RIR can exceed four. Unknown and missing effort are not known RIR. |
| Account context | `getPersonalEffortPolicy` and `personalCalculationContext` in `apps/mobile/src/config/personal-effort.ts`; `personalLoadContext` in `apps/mobile/src/exercise-calculations/analytics.ts` | Take one active-account policy snapshot for observations and reference; display/volume choices do not replace working eligibility. |
| Load and displayed RM | `resolveCalculatedLoad`, `calculateSetMetrics` in `apps/mobile/src/exercise-calculations/load-metrics.ts`; `docs/specs/tech/training-metrics-contract.md` §4 | Keep entered Weight, total calculated load, total RM and displayed RM distinct. `eligible` in metrics means performed, not working. |
| Dated weight | `createAsOfWeightResolver` in `apps/mobile/src/bodyweight/as-of.ts`; `docs/specs/tech/bodyweight-load-contract.md` §2–4 | Latest valid nondeleted reading at/before exact session start, not completion or calendar day. Missing personal reading still uses zero. |
| Raw history | `ExerciseHistoryStore` reads in `apps/mobile/src/data/exercise-history.ts`; schema under `apps/mobile/src/data/schema/` | Join by current definition ID; combine repeated blocks without duplicating set IDs. Use completed nondeleted sessions, blocks and sets. |
| Lossy projections | `buildSessionEntry` in the history repository; `apps/mobile/src/data/exercise-analytics.ts`; `apps/mobile/src/data/exercise-session-facts.ts` | Final history entries normalize unknown labels to null; daily/weekly facts lose individual points. Research must retain raw `setType` before normalization. Facts' `bestE1rmKg` is displayed RM, not total RM. |

Observation provenance should carry definition/session/block/set IDs, order, start/end timestamps, gym ID including missing gym, entered Weight/reps text, raw effort and parsed RIR, current eligibility/policy key, load mode, contribution, preference, selected reading tuple or missing sentinel, and both RM projections. No name-based identity joins or inferred effort/readings. Dataset-origin/enrichment provenance belongs in the data audit; recorded labels alone cannot establish it.

**Planning/source conflict corrected:** the milestone previously said not to double ordinary per-side loads. Current kernel uses entry factor two once even for ordinary/off/zero contribution. This was a stale planning assertion; current source and the adopted load contract govern. Analytics must avoid an *additional* conversion, not remove the existing factor.

## Exact curve, domains and numerical reconstruction

Let `f(r) = estimateOneRepMax(1, r)`. Homogeneity in load gives total RM `M = L × f(r)` and the inverse predicted total load `P(r; M) = M / f(r)`. This calls the shared estimator and copies no formula constants into production. For a single, `f(1) = 1` and `P(1; M) = M`; applying the exponential branch at one rep would violate [[1rm.formula]]. Repetitions are discrete integers; any line connecting integer predictions is a drawing interpolation, not evidence for fractional reps.

The numerical check [script](M36-T01-rm-curve-checks.ts) runs directly with Node 24:

```sh
node docs/plans/research/M36-T01-rm-curve-checks.ts
```

It uses all 11 current load vectors, real kernel calls, exact dated resolution and assert-based checks. Round-trip recovery of entered Weight has maximum floating-point error `1.42e−14 kg`. Numerical parity says nothing about accuracy on a person's actual repetitions to failure.

| Reps | Predicted total kg for total RM 100 |
| --- | ---: |
| 1 | 100.000000 |
| 2 | 95.106089 |
| 5 | 85.776163 |
| 8 | 78.326066 |
| 10 | 74.213321 |
| 20 | 60.804403 |
| 30 | 54.470478 |
| 50 | 50.065255 |
| 999 | 48.800000 |

The inverse approaches a positive load fraction at high reps; mathematical boundedness is **not** validation of unlimited endurance or of a 999-rep RM estimate. The parser accepts at most 999; `estimateOneRepMax` alone has no upper rep cap. Use parsed set values for observations, and propose a narrower inference domain below. The bare estimator can overflow for extreme finite loads; `calculateSetMetrics` rejects nonfinite results. Research must not let a direct helper's infinity become a reference.

- `M = 0` gives prediction zero for valid reps. A zero load is a valid observed set; it supplies no positive reference support. With positive bodyweight contribution, entered zero can still have positive calculated load and RM.
- Negative/nonfinite reference, invalid reps, unperformed/planned/skipped or invalid text values yield no analytical point/reference. Blank Weight with valid reps is zero through `calculateSetMetrics`; calling `resolveCalculatedLoad` on raw blank text directly would instead be invalid.
- Rounding is presentation only. References, inverses and residuals use full precision; point displayed RM uses the existing formatter later.

**Proposed rep policy:** retain all valid observed points. Estimate a reference using 1–10 reps initially; sensitivity bands 1–5, 6–10, 11–20 and above 20 stay separately reported in empirical work. Draw the first curve only over the approved supported integer rep interval, without using high-rep observations to invent confidence. The cutoff is a conservative proposal, not an adopted BoGa estimator restriction. [Reynolds et al. (2006)](https://www.unm.edu/~rrobergs/478RMStrengthPrediction.pdf) tested chest/leg press at 1/5/10/20RM with controlled cadence and found their 5RM regressions most accurate. Their linear-equation recommendation does not validate Wathan across every exercise or set the app's rep cap; it motivates sensitivity checks.

## Comparable effort proposals

Apply the account's `isWorkingSet` first. Intersect it with an explicit raw-RIR cohort; do not alter policy preferences or stored labels. A user who excludes an effort from working sets still excludes it from this proposed analytical population. Policy-selected warm-up/technique/cooldown can appear in the broad working population but are never silently promoted to an exact-RIR cohort.

| Candidate cohort | Role and tradeoff |
| --- | --- |
| Exactly RIR 0 | Proposed initial chart/reference cohort: closest recorded endpoint to the RM curve, often sparse and still subjective. |
| Exactly RIR 1 or exactly RIR 2 | Separate within-grade analyses distinguish curve shape from differing effort. |
| RIR 0–1 and 0–2 | Sensitivity/explicit alternative filters: more observations, mixed effort. Never substitute reps + RIR. |
| RIR 3–4, canonical historical RIR above four | Separate effort strata; keep numerical RIR 7 as 7 even though working eligibility follows RIR-4. |
| Missing/explicit Unspecified | Separate sensitivity population; never assume failure. |
| Unknown/malformed raw label | Separate from missing, e.g. `unknown` or `rir_01`; shared eligibility may include it, but parsing does not manufacture RIR. |
| All current working sets | Broad descriptive comparator, not comparable-effort proof. |

The script's illustrative label population contains 10 default-working rows, versus 1/2/3 rows in RIR 0/0–1/0–2. It verifies equal per-set RM for equal load/reps across every label; cohort differences come from selection only. These counts are synthetic parser examples, not dataset coverage or effect-size estimates.

**Recommendation for approval:** begin with RIR 0 and explicit optional broadening; exclude missing/unknown from reference estimation while retaining their separate research comparisons. No automatic widening when data are sparse. Report count of sets **and independent sessions**, rep coverage, label provenance and excluded populations. [Armes et al. (2020)](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.565416/full) found trained participants' predicted failure endpoints imperfect in knee-extension experiments. This supports treating RIR as uncertain self-report, not a measured correction; it is not a universal error calibration for BoGa users.

## Reference comparison and proposed cutoff contract

Estimate reference on the same definition, effort cohort, current policy/metadata and comparable load coordinate as observations. Proposed estimator: take each qualifying completed session's maximum finite positive **total** RM, then median those session maxima. Session weighting limits domination by a session containing many sets; max selection can still favour sessions with more attempts or favourable rep ranges, and the median estimates typical best performance rather than a maximal capacity. Compare median of all sets and prior maximum as sensitivities in empirical validation.

| Reference | Population and refresh | Analytical interpretation |
| --- | --- | --- |
| Fixed historical, recommended | Before evaluation start `t0`, from an explicit prior window; hold estimate constant while evaluating `[t0,t1)` | Preserves improvement relative to a past benchmark; can become stale or span earlier training changes. |
| Rolling/current-as-of | For each evaluation session, only completed sessions strictly before that session; specified look-back/session count | Tracks recent performance but adapts away gradual improvement. Same session's other sets are excluded together. |
| Prior all-time maximum | All qualifying sessions strictly before each evaluation session | Record-like ceiling; sensitive to old/outlier estimates and upward selection. |
| Existing all-time displayed estimate | Current facts across all working sessions, current personal context | Existing production record context only. Includes displayed observations and is not the total/effort-filtered historical reference. Recompute a prior raw cohort for valid analytical comparisons. |

**Concrete proposal awaiting approval:** anchor a fixed baseline to the selected evaluation range start; use the existing History look-back setting's calendar start computed at `t0`, truncate its end to `t0`, and take up to the six most recent qualifying sessions in that prior interval. Require six distinct qualifying sessions for a curve; fewer means points without a reference, with no silent all-time/current fallback. Six is a proposed conservative reuse of an existing history support convention, not statistical reliability or adequate breakpoint support. Empirical work should compare 3/6/10 sessions and alternative windows before final analytical approval.

A reference fit never uses any session displayed as an evaluated point. Cutoff uses exact `completedAt < t0`; tie timestamps are excluded as a whole session group, even though record folds have their own ID tie ordering. A rolling comparison uses `completedAt < evaluationSession.completedAt`. No later workout or later-as-of bodyweight reading enters an old evaluation. Source metadata/preferences/readings remain current reinterpretations under BoGa's existing contract; after an edit or policy/account change, recompute both populations atomically. A fixed numerical reference is fixed during one evaluation, not a permanently stored historical snapshot. Archive the research input snapshot/policy separately to reproduce results; no new synced derivation.

Synthetic prior session RMs `100,102,104,106,108,110` have median `105`; evaluation RMs are `115,125`, with a later `140`. At eight reps:

| Reference | First / second estimate | First / second load residual % |
| --- | --- | --- |
| Fixed historical median | 105 / 105 | +9.524 / +19.048 |
| Rolling median of previous three | 108 / 110 | +6.481 / +13.636 |
| Prior all-time maximum | 110 / 115 | +4.545 / +8.696 |
| Current maximum including evaluated points | 125 / 125 | −8.000 / 0.000 |
| Later maximum leaking backwards | 140 / 140 | −17.857 / −10.714 |

Using each point's own RM as its reference forces zero residual by construction. Using a shared maximum including evaluation is subtler: its winning point is forced onto the curve and positive residuals disappear. These demonstrations validate cutoff logic, not real strength change.

## Residual definitions and uncertainty

For observed total calculated load `L_i`, parsed reps `r_i` and independent positive reference total RM `M_ref`, predicted load is `P_i = M_ref / f(r_i)`.

```text
signed residual kg = L_i − P_i
percentage residual = 100 × (L_i − P_i) / P_i
```

Positive means above the reference prediction, negative below. Normalise by predicted **load**, not entered Weight, observed load or a displayed RM with bodyweight removed. For constant `M_ref`, percentage residual also equals `100 × (M_i / M_ref − 1)`; changing rep mix can therefore change residuals through estimator bias. Rep-range strata remain necessary. Dividing both observed/predicted load by fixed `F` rescales kg residual by `1/F` and leaves percentage unchanged; subtracting bodyweight does not preserve the denominator.

With prediction zero, retain a finite signed residual but percentage is undefined, even `0/0`. Without a valid independent reference or finite observation, both residuals are unavailable. A nonfinite subtraction/ratio is unavailable too. Do not equate undefined percentage with zero. The proposed chart may retain points without residuals; actual missing-state copy/layout is design work.

Prediction error combines model mismatch, effort/reporting error, day-to-day readiness, fatigue/order, equipment/technique and metadata/reading changes. It is neither a measurement error estimate nor proof of changed strength. Many points from one session are dependent. This note specifies no regression, uncertainty interval, significance threshold or break date; T02 owns those methods.

## Load projection, bodyweight and the single overlay

Let `E` be entered Weight, `b = cB` the effective bodyweight contribution resolved by personal policy, and `F` the entry factor. The kernel gives `L = b + FE`, total RM `M`, and displayed RM `q = (M − b)/F`. For a **fixed total reference** the per-context entered prediction is `(M_ref / f(r) − b_i)/F`. For a **fixed displayed reference q**, it is `(Fq + b_i)/[F f(r)] − b_i/F`. Both depend on bodyweight context; blindly applying the ordinary inverse to displayed bodyweight RM is wrong.

| Case | Correct projection / consequence |
| --- | --- |
| Ordinary total-load | `b=0,F=1`: entered points and total points coincide. |
| Ordinary per-side | `b=0,F=2`: internal load is `2E`; displayed RM and entered chart projection divide by two exactly once. |
| Preference off or contribution zero | `b=0`; F still comes from entry mode: one for total-load, two for per-side. No reading is accessed. |
| Positive bodyweight, constant `b` | Entered Weight can share one context-specific curve; total reference must include that context. |
| Positive bodyweight, changing dated `b` | Raw entered points require different curves/predictions. A single raw-Weight curve at latest B is not a prediction for older B. |
| Personal reading missing | Kernel uses `b=0`; keep raw provenance. Research stratifies/excludes this reference population in sensitivity checks without changing personal metrics or introducing a production missing-reading warning. |
| Negative projected external Weight | Unattainable in the nonnegative entry domain; do not clamp to zero or invent assisted loading. Total prediction may remain valid. |

Numerical example: at eight reps with displayed reference `q=30`, total-load mode and full contribution, entered prediction is `6.158673` at B=80 versus `3.991279` at B=90. A fixed total RM=130 gives entered predictions `21.823886` and `11.823886` instead. Equal logged Weight=20/reps=8 at those B values gives total loads 100/110, displayed RMs 47.671419/50.438561, and residuals −1.791%/+8.030% against total RM130. This is not proof of strength gain independent of body mass.

The script selects B80 just before timestamp 10, B90 at 10, and skips a later malformed reading. Before any reading it preserves personal fallback load20 and displayed RM25.534284, a markedly different cohort. At 30 reps, total RM90/B80 would predict external Weight −30.976570: no supported nonnegative external prediction.

**Research recommendation:** use total calculated kg and total RM as the canonical comparable scale; preserve per-entry and raw fields alongside it. Recompute from raw rows rather than aggregate displayed maxima.

**Production coordinate alternatives for human approval:**

| Candidate | One coherent overlay across B changes? | Tradeoff |
| --- | --- | --- |
| Entered Weight, restrict to identical effective `b` contexts | Yes within each context | Preserves current Weight axis; fragments histories and often prevents useful BW comparison. Never silently round B into bins. |
| Calculated load per entry factor `Y=L/F`, reference `M_ref/F` | Yes: `Y_pred=(M_ref/F)/f(r)` | Recommended proposal for a mixed-context chart: ordinary/per-side axis remains entered kg; BW points include `b/F`. Requires explicit approval of a new chart coordinate/label. Point raw Weight and displayed RM remain unchanged. |
| Calculated total load `Y=L` | Yes | Clearest research scale; ordinary per-side points become twice entered Weight and need an approved explicit label. |
| Entered Weight with one latest-B curve | No | Not recommended as an analytical overlay; systematically misprojects earlier contexts. |

Current bodyweight UI contract hides calculated-load breakdown and shows entered Weight/displayed RM. **No new calculated axis is approved here.** If the owner selects the recommended coordinate, its chart-specific presentation exception must be approved and recorded with the owning rules before implementation. Otherwise retain entered Weight and explicitly select a homogeneous context. Neither option changes logging, records, contribution/reading selection or the global meaning of Weight. This is the outstanding load-design decision, not permission to ship misleading BW plots.

Gym/equipment comparison is also provisional: propose matching the reference's gym to the evaluated cohort, keeping missing-gym separate, then testing pooled histories as a sensitivity. A gym ID is only a proxy; apparatus, range of motion, tempo and technique changes are not fully recorded. No new gym feature is implemented.

## Acceptance and human decision gate

| T01 acceptance | Reviewable evidence | Remaining condition |
| --- | --- | --- |
| 1. Trace existing authority | First section, current function/policy/data seams | Human review |
| 2. Reconstruct and parity | Shared unit-load inverse; 11 vectors and single/zero/invalid/overflow checks; focused Jest identities | Human review |
| 3. Effort sensitivity | Cohort table, raw-label checks and subjective-effort limitation | Approve initial cohort/missing/high-RIR treatment |
| 4. Reference alternatives | Population/estimator/cutoff/refresh/fallback proposal and synthetic comparison | Approve estimator/window/support; empirical testing can later revise |
| 5. Residuals | Signed/percentage definitions, denominator and unavailable cases | Approve analytical contract; no production residual UI promised |
| 6. Loading and projection | Current F once, dated reading examples, BW curve family and coordinate alternatives | Approve BW chart coordinate/exception or homogeneous-context alternative |
| 7. Assumptions and approval | Limitations and concrete recommendations above | **Pending product-owner approval; no new fact or persistent extension written** |

Other pending choices are the rep-domain policy and same-gym default. T03/T04 still need to verify actual dataset/effort provenance, estimator bias, sensitivity and empirical reliability; no real historical residual distribution has been analysed in T01. Keep the research note/checks ephemeral until decisions graduate into their existing owners. Do not delete the task card or unblock T02 as completed before the required approval.
