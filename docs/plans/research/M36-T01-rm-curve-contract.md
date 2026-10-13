# RM curve reconstruction and revised analytical contract

Prepared against `7b6dc3fd`; original approval 2026-10-13, followed by the owner's explicit request to include all known RIR and assume m performed reps at RIR n equal m+n reps at RIR0. This replaces the earlier analysis-only RIR0/default and no-reps-plus-RIR constraint. It is a **modelling assumption, not empirical proof**. Global [[1rm.formula]], logged reps/effort, records, eligibility and loading remain unchanged. Durable authority: [[1rm.curve-population]], [[1rm.curve-effort]], [[1rm.curve-reference]], [[1rm.curve-load]]; technical owners are `docs/specs/tech/training-metrics-contract.md` §6 and `docs/specs/tech/bodyweight-load-contract.md` §11. T02 has not started; visual design, empirical and UI acceptance gates remain pending.

## Existing authority and input provenance

| Input | Authority / integration implication |
| --- | --- |
| Actual metrics | `calculateSetMetrics` / `resolveCalculatedLoad` in `apps/mobile/src/exercise-calculations/load-metrics.ts` read actual m, raw Weight and current dated context. Their `eligible` flag means performed, not working. |
| Formula | `estimateOneRepMax` in `apps/mobile/src/exercise-calculations/index.ts`; use the same function at actual m for global figures and at effective u for the separate analytical quantity. No copied constants. |
| Performance/eligibility | [[set.performed]], [[set.eligibility]]; `isWorkingSet` in `apps/mobile/src/exercise-calculations/set-semantics.ts` takes the active account's policy. Analytical selection narrows it. |
| Effort | `getSessionSetRir` in `apps/mobile/src/exercise-calculations/effort-policy.ts` returns canonical nonnegative safe integers, including historical values above four. Missing/unknown/malformed labels return null. |
| Personal context | `getPersonalEffortPolicy` / `personalCalculationContext` in `apps/mobile/src/config/personal-effort.ts`; `personalLoadContext` in `apps/mobile/src/exercise-calculations/analytics.ts`. Snapshot account policy coherently for both populations. |
| Dated load | `createAsOfWeightResolver` in `apps/mobile/src/bodyweight/as-of.ts`; latest valid nondeleted reading at/before exact session start. Personal missing-reading fallback stays zero. |
| Raw history | `ExerciseHistoryStore` in `apps/mobile/src/data/exercise-history.ts`; retain raw effort before `buildSessionEntry` normalizes unknown to null. Aggregates/facts lose individual points or hold actual-reps displayed RM, not analytical RM. |

Carry definition/session/block/set IDs and order, actual m and entered Weight text, raw recorded RIR and parsed n, effective u, current policy/metadata, start/end, gym, dated-reading tuple or missing sentinel, actual metrics and analytical total RM separately. Join by definition ID, never captured name. A programme target is not recorded effort. Unknown labels and missing labels remain distinguishable even though shared eligibility maps both to Unspecified.

Current ordinary per-side load uses entry factor two exactly once. The original planning assertion against doubling was corrected; no extra conversion belongs in analytics. The same source rules govern preference off/zero contribution.

## Revised equivalence and exact inverse

For a valid confirmed working set with actual m and known recorded n, set `u=m+n`, validating positive safe-integer addition. The actual parser's 999 cap applies to m, not to this derived coordinate: m999/n1 has u1000. Very high u is mathematically evaluable but empirically unsupported. Unsafe addition, invalid actual values/status, unknown RIR or nonfinite analytical output supplies no analytical point/reference; global raw history is not mutated.

Resolve actual load L with `calculateSetMetrics` at m. The separate analytical total RM is `A=estimateOneRepMax(L,u)`. Let `f(u)=estimateOneRepMax(1,u)`. Homogeneity gives predicted total load `P(u;M)=M/f(u)` for an independent reference M. A raw single at RIR0 has u1 and A=L. A raw single at positive RIR has u>1 and A>L when load is positive; its global single-rep 1RM still equals its actual load. Analytic identity never replaces a logged row or displayed 1RM.

X must say RIR0-equivalent reps. Details retain actual m, recorded n, u, Weight/load and existing displayed 1RM; a separately shown analytical quantity must be distinguished from that global figure. Exact chart labels remain part of human design approval.

The [numerical script](M36-T01-rm-curve-checks.ts) uses real kernel functions/vectors:

```sh
node docs/plans/research/M36-T01-rm-curve-checks.ts
```

The prior 11-vector inverse recovers entered Weight with error at most 1.42e−14 kg; normalized-vector, single, zero, invalid, high-RIR, unsafe-sum, reference-domain and overflow checks extend it. This proves arithmetic, not the physiological equivalence. A finite actual single can still yield an overflowing analytical estimate at u>1; reject that result without changing the actual metric.

| Effective reps u | Predicted total load for M100 |
| --- | ---: |
| 1 | 100.000000 |
| 2 | 95.106089 |
| 8 | 78.326066 |
| 10 | 74.213321 |
| 30 | 54.470478 |
| 999 | 48.800000 |

The curve's high-rep asymptote is not evidence for unlimited endurance. Reference support is initially effective u1–10; retain valid normalized observations outside it while limiting curve drawing to the supported integer interval fixed during design. [Reynolds et al. (2006)](https://www.unm.edu/~rrobergs/478RMStrengthPrediction.pdf) found their 5RM chest/leg-press regressions most accurate under controlled testing. Their linear-equation advice does not validate Wathan with RIR-adjusted inputs or every exercise.

Blank actual Weight with valid reps becomes zero through the kernel; direct raw blank `resolveCalculatedLoad` would be invalid. Zero calculated load gives A0 and is valid but does not establish a positive reference. Entered zero with contributing bodyweight can give positive L/A. Calculation precision stays unrounded.

## Known-RIR population and sensitivity

Include all canonical known RIR by default, intersected with current working eligibility; optional effort filters narrow this population. Unknown, missing and malformed effort cannot be normalized, even if the global policy counts the set. Targets or perceived effort cannot fill those gaps. Preserve RIR7 as 7 rather than mapping it to four for arithmetic; eligibility still uses its established policy mapping.

RIR0 alone, exact RIR1/2 and narrow bands remain research sensitivities rather than the default. Compare the normalized residual distributions with actual-reps estimates and each recorded-RIR stratum. Perturb recorded n by ±1 where nonnegative, recalculating u/A and both baseline/observation populations; separate observation-only perturbation from baseline coupling. Larger RIR or a target/observation mismatch can make a point look systematically stronger after normalization. These perturbations are scenarios, not calibrated errors or confidence intervals.

[Armes et al. (2020)](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.565416/full) found imperfect failure-endpoint prediction in trained participants' knee-extension experiments. This supports treating RIR as uncertain self-report; it neither proves m+n equivalence nor provides a BoGa-wide calibration.

A programme phase named Technique/reset logged as rir_4 remains working under the current default. Actual Technique/warm-up labels remain their recorded labels and use existing eligibility; no phase-name relabelling. High canonical n remains known even if u exceeds reference support. A disabled working effort remains excluded regardless of analytical availability.

## Fixed historical reference and residuals

The approved reference structure is unchanged: same definition, gym and analytical effort population; missing gym separate. Anchor prior History look-back's calendar start at evaluation start t0 and end strictly before t0. Take the six most recent qualifying completed sessions; each supplies maximum finite positive **analytical** total RM from effective u1–10; median session maxima gives M. Require six distinct qualifying sessions. Otherwise keep observed points without reference/percentage residual, never silently broaden or fall back to current/all-time estimates.

Exclude the whole evaluated session and tied cutoff timestamps. Weekly prefixes share fixed t0/baseline and cannot see later workouts. Source corrections and current policy/metadata still reinterpret history; recompute both populations coherently rather than claiming an immutable historical snapshot. Preserve research input/policy provenance for reproducibility.

A rolling prior-session median and prior all-time maximum remain exploratory alternatives. Existing all-time facts summarize actual-reps displayed RM and cannot stand in for this analytical reference. Session maxima select favourable attempts; medians balance sessions without eliminating rep/effort composition bias. Six sessions is an approved support convention, not validated inferential reliability.

For observed L and predicted P=M/f(u):

```text
signed residual = L − P kg
percentage residual = 100 × (L − P) / P
```

Positive is above prediction. Percentage also equals `100×(A/M−1)` for positive fixed M, so RIR error changes both the coordinate and derived strength. Prediction zero retains a finite signed residual but no percentage; absent reference or nonfinite arithmetic gives no corresponding residual. Normalize by predicted calculated load, not Weight after removing bodyweight. Per-entry division preserves percentage.

Synthetic A values 100/102/104/106/108/110 give M105; later A115/125 yield +9.524%/+19.048% load residuals. A rolling previous-three median gives +6.481%/+13.636%; prior maximum +4.545%/+8.696%. Including the evaluated maximum125 gives −8%/0%; leaking future140 gives −17.857%/−10.714%. Each point's own reference forces zero; a shared evaluated maximum forces all residuals nonpositive. These are selection demonstrations, not empirical trends.

## Load coordinate and bodyweight

The actual kernel resolves L=b+FE from entered E, effective dated contribution b=cB and entry factor F. It also returns the unchanged actual-reps displayed RM. The chart uses Y=L/F; its analytical reference curve is M/[F×f(u)]. Ordinary total-load points equal E, ordinary per-side points still equal E after exactly one division of internally doubled load. Changing dated b affects L but requires no family of curves on this approved chart coordinate.

Internal external prediction `(M/f(u)−b_i)/F` remains context-dependent. An analytical entered-unit capacity q requires total reference Fq+b_i; it is not the global displayed 1RM at actual m. At u8, q30 and B80/90 yield external predictions 6.158673/3.991279; M130 yields 21.823886/11.823886. These RIR0/effective-u examples remain valid load-projection checks. A negative external prediction is unattainable under current entry semantics; never clamp it or invent assisted loading.

Current dated-reading tests keep B80 before the later timestamp, B90 at it and skip malformed rows. Missing personal reading still supplies b0 without a warning; research distinguishes its provenance. Body mass or metadata change can produce different A without proving strength gain independent of those changes. Absolute versus %BW record policy is outside this work.

## Shared programme inspiration and acceptance

Retain only the generic [programme pattern](https://app.notion.com/p/3b3a4905c27481e580a1d9ca744d5bbf), last edited 2026-10-13: 24-session roadmap repeating Volume3×8 targetRIR2–3, Strength3×6 target2, Heavy3×4 target2 (later3–4), Technique/reset3×8 target4. No fixed calendar exists in the source. Weekly spacing, actual n, loads and progression are synthetic; annotations mix targets/observations and imported RIR may be uncertain. No personal health/location/history is retained.

Volume8@RIR2 has u10 and can support the reference; Volume8@RIR3 has u11 and reset8@RIR4 has u12, so those remain points but cannot supply reference support. Heavy/Strength may supply it if other criteria hold. This phase-dependent selection effect must be investigated before empirical claims, without silently widening 1–10.

Equivalence assumes the same complete-repetition/task standard. The source reset phase prescribes controlled eccentric tempo and a pause; that technique change can leave systematic residuals even after m+n normalization. A phase target is not proof of actual tempo or execution. Research should inspect phase/task-standard sensitivity rather than assume RIR removes every phase effect. No production phase filter or health guidance is implied.

T01 now covers the revised assumption, exact reconstruction and numerical sensitivity. T03 reconciles the revised provisional starter input and verified historical data separately; T04 validates/freezes the canonical fixture. Stable capacity with varying m/n must not look like strength gain under the model; gradual progress, future-free prefixes and sparse prior support remain shared controls. A requested additional weekly fitted production curve remains unresolved; fixed reference stays approved. The draft remains unmerged; T02 has not begun. No production normalization/regression/UI helper is implemented, and human visual-design/UI acceptance remains required.
