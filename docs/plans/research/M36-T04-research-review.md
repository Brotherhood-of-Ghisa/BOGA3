# Strength amplitude with RIR and load uncertainty

## Revised two-approach contract

The owner added uncertainty from discrete gym load choices: **1.25 kg per-side entry SD and 2.50 kg total-load entry SD**. These are per-observation SDs, rather than the standard error of a sample mean. Existing loading semantics give total-load SD F×entrySD: 2×1.25=2.50 kg for a per-side entry, or 1×2.50=2.50 kg for a total-load entry. One logged per-side value controls both sides; there is no independent-side variance calculation or second scaling. Dated bodyweight contribution remains the existing fixed context.

**Fixed uncertainty** fits latent total 1RM S while holding RIR sigma at 1 rep and total-load tau at 2.50 kg. **Joint estimation** fits S, RIR sigma and total-load tau together. Both use the adopted unit-load kernel f and identical observations/prior/likelihood. Predicted load is S/f(m+r); S alone changes curve amplitude, never curve shape. Keep S distinct from observed analytical RM A and the approved independent reference M. Logged weight and existing actual-rep metrics stay exact and unchanged.

Load discrepancy represents a continuous curve's mismatch with available loads, not unknown plate mass. A centred Gaussian/truncated-normal proxy and independence of RIR/load errors are initial research assumptions. The specified SD does not determine a plate-step width or selection bias; do not add a second rounding variance to the primary model. A separately labelled nearest 2.5 kg-rounded stress tests additional quantisation. Joint tau can absorb fatigue, task variation or curve misspecification as well as gym granularity; it cannot identify those causes separately.

The [validation contract](M36-T04-validation-contract.md) records this revision before evaluating it. The earlier tau 1 kg result/approval proposal is superseded. T04 remains research and `in_progress`; exact shared-wave freezing and human analytical/product review before T05 are still pending. Production behaviour, main and the fixed reference contract are untouched.

## Paired recovery and uncertainty

The [strength/error script](M36-T04-strength-error-validation.ts) uses the existing uniform latent integer-RIR 0–4 prior and recorded max(0,round(r+normal error)), with no upper clamp or filtering by n/u. Primary recovery uses the first ordinal chosen before generating observations, once per independent completed session in a constant-S window. Support 1–10 only restricts prior reference M. Three-set dependence is a separate sensitivity.

Counts 12/16/24/48 × true RIR sigma 0/.5/1/2 use 400 evaluation repetitions each, all at true total-load SD 2.50 kg. Separate 400-repetition calibration cells calibrate fixed cutoffs and conservative joint profile cutoffs across that RIR family. Joint profiles maximize over the other two parameters, on load-SD grid .5/1.25/2.5/3.75/5/7.5 kg. Twelve stresses use 200 repetitions: off-grid S/RIR/load truth, true load SD 5 assumed 2.5 versus explicit 5, plate rounding, wrong/wave priors, high reps, reporting bias, serial errors, varying strength and independent/dependent three-set histories. Total 6,400 calibration and 8,800 evaluation datasets; seeds and paired raw results are retained locally.

| True RIR sigma;24 sessions, true load SD 2.5 kg | Fixed 1RM RMSE | Joint 1RM RMSE | Fixed / joint S interval coverage |
| --- | ---: | ---: | ---: |
| 0 | 0.697 kg | 0.639 kg | 99.0% / 97.0% |
| 0.5 | 0.716 kg | 0.696 kg | 98.0% / 95.8% |
| 1 | 0.755 kg | 0.771 kg | 98.8% / 97.5% |
| 2 | 0.977 kg | 0.933 kg | 92.8% / 96.8% |

At the owner's matching uncertainties both recover strength similarly: fixed RMSE 0.755 kg versus joint 0.771 kg. Joint RIR-SD RMSE is 0.392 reps; load-SD RMSE 0.813 kg. Their separate profile interval coverage is 94.8% and 95.5%; these are marginal, not a simultaneous three-parameter confidence region. Correctly fixed uncertainties are oracle information; joint fitting need not outperform them.

All reported coverage is conditional on the declared generator and finite grid. Calibration is at true tau 2.50 kg; other load scales are stresses, not independently calibrated policies. Failure/coverage use all repetitions; finite-fit bias/RMSE are conditional. Actual Monte Carlo SE, widths, disconnected profiles and unresolved endpoints are retained for all three parameters. Near 95% with 400 repetitions rate SE is about 1.1 percentage points; a zero observed rate is not proof of zero probability. A single .25 kg versus .5 kg strength-grid diagnostic changes the upper endpoint by 0.015 kg and not its 100 kg optimum, while keeping the nuisance grids fixed. It establishes no global convergence or nuisance-grid accuracy.

With true load SD 5 kg but fixed assumption 2.5 kg, strength coverage is 79.0% fixed versus 96.0% joint. However, 37.0% of joint load intervals reach an unresolved grid endpoint: apparent coverage is not a finite reliable noise estimate. With a wrong high-RIR prior, S bias is -1.558/-2.072 kg and coverage 55.0%/44.0%. Learning both scales does not fix a wrong effort population.

For shared errors, first-set coverage 97.0%/96.5% drops to 83.0%/84.5% when the three set rows are incorrectly treated as independent. Fixed sigma 0 still cannot explain recorded RIR above 4: 86.3% of 24-session sigma 1 samples are no-fit, count as uncovered, and are never clamped/deleted. A changing-S window is explicitly compared with its initial S(t₀), not a legitimate single constant-S truth. Exact deterministic copies are profile diagnostics only; load density can diverge toward zero SD. A lower .5 kg grid optimum is an unresolved bound, not a measured noise floor or proof of accurate effort. Impossible scores remain explicit `-Infinity`.

## Amplitude-break research at the revised load scale

The [regression script](M36-T04-amplitude-regression-validation.ts) isolates known S(t) through RIR 0 singles, so load SD 2.50 kg is exactly amplitude observation SD; RIR is known in this benchmark. Constant/linear/quadratic trajectories and one-jump/one-hinge changes all vary S(t), never f. Another stress adds RIR/load error and changing rep populations to observed A; it cannot be interpreted automatically as latent S(t).

The complete two-form/cut/prefix 12/16/24/48 search is recalibrated on 400 separate null-family repetitions, at cutoff 10.018403. Minimum 8 independent sessions per side yields no search at 12, and only one possible cut at 16 (exact midpoint localisation there comes from the constraint). Thirty primary cells use 400 evaluations and ten stresses 200, totaling 14,000 evaluations. The smooth quadratic competitor remains intentionally conservative.

| Known amplitude change; load SD 2.50 kg |16 sessions |24 sessions |48 sessions |
| --- | ---: | ---: | ---: |
| +2.5 kg level jump | 0.5% | 2.5% | 8.2% |
| +5 kg level jump | 3.5% | 11.8% | 60.0% |
| +10 kg level jump | 30.5% | 79.0% | 99.8% |
| +0.5 kg/week slope increase | 0.0% | 0.5% | 1.8% |
| +1 kg/week slope increase | 0.0% | 0.8% | 18.0% |

Independent 48-session null flag rates are 0.8% stable, 0.8% linear, 1.2% smooth, including earlier prefixes. Serial errors raise flags to 16.5%; dependent session medians give 0.0%, naive set rows 28.5%. Output distinguishes misses, unconditional detection/form rates and conditional form accuracy. Earlier-only forecasts are retained; BIC or visual changes do not supply significance.

Retrospective wild bootstrap redoes the whole search with session signs or four-session block signs. Across 80 independent histories, false flags are 6.3%/5.0%; across 80 serial histories 56.3%/25.0% (199 bootstrap draws per method/history). This remains too unreliable for production; block choice and serial inference are open research. Minimum-segment 6/10 stresses reuse the 8-session cutoff and are not calibrated policies.

Separate-seed known-form date/effect intervals use 97.5% marginal error radii across declared effect sizes. They are conditional on known form and matched independence, not post-selection latent-strength intervals. At 24 sessions a +5 kg jump has 96.8% known-form joint coverage; a long gap drops to 23.5%, and outside-search cuts to 5.5%. Gap dates remain between observations, not precise inferred days. Direct joint segmented S(t)/RIR/load-noise inference and production detection remain deferred.

## Historical limits and unchanged wave

The [history/oracle replay](M36-T04-history-and-oracle-review.ts) reuses the already-authorised Zercher Squat and Dumbbell Bench Press snapshot. No new remote query or account is accessed; raw records remain local. Six exercise/gym cohorts have 1–7 evaluated sessions, insufficient for the declared break search. Bench's only supported reference remains 60.636 kg total. Its observed-A mean 53.366 kg, descriptive slope−0.0574 kg/week and 8.30 kg residual scatter do not establish physiology or calibrated uncertainty.

Choosing the first performed working ordinal before effort availability leaves at most one known-effort first set per cohort; no later set substitutes for missing first effort. Both approaches use those same points; fixed uses 2.5 kg total-load SD and joint profiles both noise scales. Every available one-point joint load maximum hits the .5 kg lower search boundary, demonstrating inadequate identification rather than estimating gym error. Imported effort provenance remains uncertain. No fitted S supplies a missing M.

The existing synthetic weekly wave and candidate [numerical oracle](M36-T04-weekly-wave-oracle.json) remain byte/input unchanged: SHA256 `172dae999afb8e2a0a3dcf34ced8c474f17eca76c04a68aa17edc753e144ae26`. The replay preserves all 24 completed prefixes for plateau, stable and smooth controls; fixed six-prior M100; five-prior M unavailable; stable session-median 99 kg (set fatigue); smooth endpoint 122.76 kg. This primary programme has no invented single physiological S(t) truth.

First Strength sets at weeks 2/6/10/14 hold 80.625679 kg while RIR follows 1/1/2/3: analytical RM100/100/102.935948/105.818232 kg, existing actual-rep 1RM97.017347 kg. Week 18 raises load to 85.316668 kg at RIR 1 and retains analytical 105.818232 kg; week 22RIR 2 gives 108.925000 kg. These exact logged/kernel equivalences are unchanged by uncertainty assumptions and prove no structural break. Human approval of the exact input/oracle freeze remains pending.

## Release decision, reproduction and checks

The proposed first chart still uses known-RIR m+n observations, approved load coordinates/logged details and independent six-prior reference M. Both uncertainty approaches and all weekly fitted-amplitude/break inference remain research; there is no fallback, production confidence copy or statistical-strength conclusion. Human research/product review and exact fixture freeze are required before T05. True-RIR prior, empirical provenance, centred/independent noise assumptions, quantisation likelihood, nuisance-grid refinement, heteroskedastic effort error and serial inference remain research limitations.

In the leased worktree run each TypeScript script with `apps/mobile/node_modules/.bin/tsx --tsconfig apps/mobile/tsconfig.json`; no arguments gives full strength/regression output, `--quick` is development-only. History replay uses `TZ=Europe/London`, the existing authorised local snapshot and T03 replay results. The Matplotlib 3.9.4/NumPy 2.0.2 plotting script reads full JSON and implements no RM formula. Evidence under `apps/mobile/artifacts/research/m36-t04/` includes final JSON, figures, gate logs and review; previous tau 1 results are separately archived locally. Private data stays gitignored/chmod 600; the tracked oracle is synthetic only.

The prior gate agreement persists for this research/test-only revision: `fast`, `jest-coverage`, `complexity`, `dependencies`, `docs-check`. Focused tests now also verify per-side/total/BW parity, both noise-profile axes against the scalar likelihood and lower/upper load boundaries. Simulation/oracle consistency assertions pass. No production source, schema, dependency, metric or UI change is made.

## Checks and review

The session's agreed research/test-only gates ran locally on the finished revision. Production thresholds and baselines are unchanged; no UI/backend slow lane is required for this delta. No test duration is asserted.

| Local gate | Result | Raw artifact |
| --- | --- | --- |
| `./boga test fast` | PASS: 278 suites/3,856 tests plus docs/meta/backend-fast/consent/MCP checks | `fast.log` |
| `./boga test jest-coverage` | PASS: 86.45% branches/94.35% lines | `jest-coverage.log` |
| `./boga test complexity` | PASS | `complexity.log` |
| `./boga test dependencies` | PASS: 513 modules/2,568 dependencies, 13 existing known violations unchanged | `dependencies.log` |
| `./boga test docs-check` | PASS | `docs-check.log` |
| Full strength/regression/history/oracle runs | PASS consistency assertions; statistical limitations retained above | final JSON outputs/logs |

Independent code/statistical review of all 10 changed files is clean; product-facts verdict: clean. The reviewer reconciled unit conversion, three-axis profile calibration, numerical tables, unresolved noise bounds, sparse historical support and both figures with the revised evidence. The new report is `independent-review.txt`; the older tau 1 review is separately archived and does not substitute for it. No production facts change. Human acceptance remains pending.
