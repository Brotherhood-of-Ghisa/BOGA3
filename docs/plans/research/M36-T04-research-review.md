# Strength amplitude and RIR uncertainty: research review

## Outcome and approval status

Both statistical approaches remain viable research candidates. They use BoGa's adopted unit-load kernel to fix curve shape; **latent total 1RM S is the only free curve parameter**. Approach A fixes RIR measurement SD sigma, initially 1 rep with 0/.5/2 sensitivities. Approach B estimates S and sigma jointly. Sigma measures error in reported effort, not another curve-shape parameter or the standard error of a sample mean. Neither fitted S nor a regression result replaces the independently anchored chart reference M.

Research is ready for review, not full task acceptance. Human analytical/product approval of the release limitations and exact shared-wave fixture is still required before design. Main and production behaviour stay untouched. Direct segmented latent S(t)/sigma likelihood, production break detection, automatic adaptive curves and statistical UI claims remain deferred. The break experiments below concern amplitude trajectories; the noisy-RIR proxy experiment instead concerns observed analytical RM A and cannot be interpreted automatically as latent S(t).

## Paired amplitude/error comparison

The [validation contract](M36-T04-validation-contract.md) declares generators, estimands, methods and failures before results. The [strength/error script](M36-T04-strength-error-validation.ts) uses a uniform integer latent-RIR0–4 prior, rounded nonnegative recorded RIR without an upper clamp, and the existing nonnegative truncated-normal load likelihood. Tau is a separate load/task discrepancy, fixed at 1 kg initially. Both methods share the same points, prior and tau. One first ordinal per independent synthetic session is chosen before any observations; no filtering by reported RIR or equivalent-rep support. Equivalent reps above 10 remain observed. The 1–10 support rule applies to reference M only.

Four independent-session counts 12/16/24/48 crossed with true sigma 0/.5/1/2 use 400 evaluation repetitions each. Independent 400-repetition calibration cells set model-matched fixed-sigma profile cutoffs and conservative joint cutoffs across the declared sigma family. Twelve additional stresses use 200 repetitions: off-grid truth, tau misspecification/explicit tau, plate rounding, nonuniform/wave effort priors, high reps, reporting bias, serial errors, varying strength within a constant-S window, independent or dependent three-set histories. That is 6,400 calibration and 8,800 evaluation datasets, with all methods paired on each. Calibration and evaluation seeds differ; raw replicate results and seeds stay in local evidence.

| True sigma;24 independent sessions | Fixed sigma 1: 1RM RMSE | Joint S/sigma: 1RM RMSE | Fixed / joint S interval coverage |
| --- | ---: | ---: | ---: |
| 0 | 0.380 kg | 0.286 kg | 97.8% /97.3% |
| .5 | 0.411 kg | 0.354 kg | 97.8% /98.3% |
| 1 | 0.448 kg | 0.457 kg | 95.3% /96.5% |
| 2 | 0.617 kg | 0.540 kg | 90.5% /97.0% |

Correctly fixed sigma 1 is an oracle under matching truth; joint estimation need not outperform it. In that cell joint sigma RMSE is 0.220 reps and its own interval coverage 93.8%. These are conditional simulation results, not evidence that workout data identify sigma. Approximate Monte Carlo SE at 95% coverage with 400 repetitions is 1.1 percentage points; output includes actual rate, bias and RMSE SE. Observed zero errors are not proof of zero probability. Widths, no-fits, disconnected profile sets and unresolved search boundaries are retained. Interpolated strength profiles admit off-grid truth; a .25 kg versus .5 kg grid diagnostic shifts the example's upper endpoint by 0.036 kg, without changing its 100.5 kg optimum. This single check does not establish global grid convergence.

Misspecification matters more than the small matched-model difference. Understating true load SD3 kg as 1 kg reduces S interval coverage to 59.5% fixed and 60.5% joint, while joint sigma drifts upward (bias+0.415 reps). Allowing tau 3 is an illustrative sensitivity using existing cutoffs, not fresh tau 3 calibration. A high-latent-RIR population fitted with the uniform prior gives 44.5% /52.5% coverage and roughly−0.94/−0.97 kg bias. Plate rounding gives 81.0% /87.5%; biased RIR gives 44.5% /83.0%; serial RIR gives 84.0% /84.5%. A changing-strength window has no single constant S: coverage against its initial 100 kg value is not legitimate constant-window recovery. This is an explicit estimand-failure stress, not a zero-quality rating of the methods.

Under true sigma 1, fixed sigma 0 cannot explain a recorded n above the latent prior's maximum 4;86.3% of 24-session samples are no-fit. They count as uncovered, with conditional finite-fit error reported separately; no clamping or row deletion rescues them. Shared load/reporting errors preserve marginal tau/sigma and expose dependence: first-set coverage 95.0% /97.5% falls to 83.5% /88.5% when all three sets are treated as independent. Exact duplicated m 6/RIR2 observations are a separate deterministic relative-likelihood diagnostic; no stochastic sigma truth or calibrated recovery claim is attached to them. Impossible log likelihoods serialize as the explicit string `-Infinity`, distinct from absent results. Unknown true effort distribution, load noise, task variation and serial reporting can confound joint sigma and S. The remote histories cannot resolve that identifiability problem.

## Amplitude regression and break reliability

The [amplitude regression script](M36-T04-amplitude-regression-validation.ts) fits known S(t) through synthetic RIR0 singles (the adopted kernel returns their load exactly), with 1 kg independent session error. Constant/linear/quadratic amplitudes provide the null family. One-jump or one-hinge changes remain changes in S(t); no formula coefficient or loading convention is fitted. The statistic compares the best searched jump/hinge with a quadratic smooth alternative. Calibration covers **both forms, all admissible cuts and prefixes 12/16/24/48 together**, with minimum 8 independent sessions per side. A12-session history has no search;16 sessions has only one admissible cut, so apparent exact localisation there comes from the constraint, not date precision.

Four hundred separate calibration repetitions over the three null shapes give family cutoff 9.216867. Thirty primary null/signal cells use 400 evaluation repetitions; ten stresses use 200. Independent null-family flag rates at 48 sessions are 2.0% stable, 1.8% linear and 0.8% quadratic. These include earlier prefixes. The conservative smooth competitor reduces false positives and also sacrifices slope-change power.

| Known change; noise SD1 kg |16 sessions |24 sessions |48 sessions |
| --- | ---: | ---: | ---: |
| +2.5 kg level jump |12.8% |32.0% |84.3% |
| +5 kg level jump |74.5% |97.5% |100.0% |
| +0.25 kg/week slope increase |0.0% |0.8% |4.0% |
| +0.5 kg/week slope increase |0.0% |1.3% |43.8% |
| +1 kg/week slope increase |0.0% |6.8% |96.8% |

These are detection frequencies, not production sensitivity requirements. Each output includes its Monte Carlo SE, misses, full-prefix form confusion/conditional accuracy and earlier-only next-session prediction errors for constant, linear, quadratic and the thresholded searched policy. BIC is not treated as a calibrated significance test. The nonlinear smooth alternative and weak hinge explain why a nice segmented line does not establish a break.

Serial session errors raise false flags to 23.0%. Naively analysing three dependent set rows per session gives 30.5% versus 0.5% after session medians. Wild bootstrap redoes the complete prefix/form/cut search, multiplying whole sessions or four-session blocks. In 80 independent-error histories its retrospective false flags are 6.3% for both variants; in 80 serial-error histories they are 56.3% for session signs and 25.0% for four-session blocks. Monte Carlo SE there is about 3–6 percentage points. Neither bootstrap is validated for reliable serial dependence; choosing a block length is still a research decision. Minimum-segment 6/10 stresses reuse the 8-session cutoff and are sensitivity diagnostics, not calibrated policies.

Known-form effect/date intervals use separate-seed calibration with 97.5% marginal error radii, conservative across declared effect sizes. They are **conditional on knowing the break form and the matched independent model**, not confidence intervals after choosing a model or discovering a real latent-strength break. At 24 sessions a matched +5 kg jump has 100% joint coverage in 400 repetitions with a deliberately broad interval; mean known-form date error 0.01 weeks. A long gap lowers detection to 21.5%, date/effect joint coverage to 66.0%; a change outside admissible cuts gives 2.0% detection and 0.5% joint coverage. Report gaps as intervals between observed dates; do not name a precise unobserved jump day. No observed shift in a real history is promoted to significance.

## Historical observations and shared-wave oracle

The [history/oracle review](M36-T04-history-and-oracle-review.ts) replays the existing owner-authorised Zercher Squat and Dumbbell Bench Press snapshot; no extra account or remote export is queried. Source rows/IDs remain local. Six same-exercise/gym cohorts have only 1–7 evaluated sessions, all below the 16-session search minimum. Bench's supported cohort has 7 sessions and the unchanged total-load reference 60.636 kg; no other cohort supplies the six-prior-session reference. Its observed-A constant mean is 53.366 kg and descriptive linear slope−0.0574 kg/week; constant/linear/quadratic RSS are 352.301/344.632/341.913 kg². Linear residual scatter is 8.30 kg, not a calibrated uncertainty interval. Small RSS improvements after adding coefficients cannot establish physiology or a break. None supports a segmented comparison or a reliability claim.

Selecting the first performed working ordinal **before checking effort availability** leaves at most one known-effort first set in each cohort, including Bench; missing first effort does not substitute a later set. Relative S/sigma likelihoods under tau.5/1/3 are diagnostic surfaces, without calibrated intervals or an empirical sigma estimate. Those maxima tend to sigma 0 with a single observation: this is insufficient information, not proof of perfect RIR reporting. Imported effort provenance is still uncertain (T03's coordinate audit), so even later-set A trends cannot establish physiological change. A fitted S is never a fallback for insufficient M.

The one shared weekly wave remains input-identical, SHA256 `172dae999afb8e2a0a3dcf34ced8c474f17eca76c04a68aa17edc753e144ae26`. The [candidate numerical oracle](M36-T04-weekly-wave-oracle.json) captures all 24 future-free completed prefixes for plateau, stable and smooth controls. Replay verifies six independent prior reference sessions fixed at 100 kg, first-week insufficient fitting, stable session-median amplitude 99 kg (set fatigue), smooth endpoint 122.76 kg, and phase/effort exclusion sensitivity already measured in T03. Primary plateau history is realistic programme structure, not a known single physiological S(t).

For the first Strength set at weeks 2/6/10/14, load 80.625679 kg stays held while recorded RIR follows 1/1/2/3. Analytical RM is 100/100/102.935948/105.818232 kg; existing displayed 1RM remains 97.017347 kg. At week 18, load rises to 85.316668 kg with RIR1, preserving analytical RM105.818232 kg; week 22RIR2 implies 108.925000 kg. The shared oracle checks those exact equivalences. These are kernel-derived analytical consequences of the logged example, not proof that latent effort is measured accurately or that a break has occurred. Exact fixture freezing awaits the human review below; no duplicate input programme is introduced.

## Proposed human decision before design

Approve the research limitations and this first-release boundary: observed known-effort sets at RIR0-equivalent reps m+n; established load coordinates and logged point details; fixed six-prior-session reference M with its existing support and missing-reference behaviour. Both S/sigma approaches, weekly fitted-amplitude experiments and all break inference remain research. No automatic fallback, statistical-confidence copy, strength-change conclusion or production breakpoint UI is authorised.

Also approve freezing the exact current shared-wave input/checksum and candidate oracle, with held-load RIR progression, higher-load equivalence, stable/smooth controls and missing-baseline cases. After that approval, the acceptance card can close and approved durable release limitations can move to their owning contract. Reliability thresholds, effort provenance verification, a defensible true-RIR prior/tau, heteroskedastic effort error, joint segmented S(t) and serial-dependence inference remain open research, without blocking the descriptive first chart once its contract is approved.

## Reproduction and evidence

Run in the leased T04 worktree with its isolated dependencies. Use `apps/mobile/node_modules/.bin/tsx --tsconfig apps/mobile/tsconfig.json` for each TypeScript script. The strength and regression scripts take no arguments for full output (`--quick` is development-only). For history review, set `TZ=Europe/London`, copy the already-authorised snapshot into the local ignored artifact directory, replay T03 with `--remote-input=apps/mobile/artifacts/research/m36-t04/remote-private-snapshot.json` to `t03-private-results.json`, then run the history/oracle script. Never commit that snapshot or private raw results. The plotting script consumes the full outputs and uses the same existing local Matplotlib 3.9.4/NumPy 2.0.2 environment as T03; it implements no RM formula.

Local evidence lives under `apps/mobile/artifacts/research/m36-t04/`: `strength-results.json`, `regression-results.json`, `history-oracle-results.json`, predecessor replay outputs, `two-statistical-approaches.png`, `statistical-validation.png`, agreed gate logs and the independent review. Research generators include assert-based consistency checks; focused Jest tests cover tail/no-fit retention, likelihood parity and an analytic density, interpolated/disconnected profiles and complete searched prefixes. Production code, dependencies, schema, navigation and metrics are unchanged.

## Checks and review

The session's agreed test-only lane set ran locally in leased worktree 51 on 2026-10-14. No UI/backend/slow lane is required by this diff; quality thresholds and baselines are unchanged. Test durations are not asserted.

| Local gate | Result | Raw artifact |
| --- | --- | --- |
| `./boga test fast` | PASS: 278 suites, 3,854 tests, plus docs/meta/backend-fast/consent/MCP checks | `fast.log` |
| `./boga test jest-coverage` | PASS: 86.45% branches, 94.35% lines | `jest-coverage.log` |
| `./boga test complexity` | PASS | `complexity.log` |
| `./boga test dependencies` | PASS: 513 modules/2,568 dependencies; 13 existing known violations unchanged | `dependencies.log` |
| `./boga test docs-check` | PASS | `docs-check.log` |
| Full research runs and T02/T03 predecessor replay | PASS consistency/oracle assertions; statistical limitations recorded above | full JSON outputs and replay logs |

Independent code/statistical review on 2026-10-14 is clean; product-facts verdict: clean, no production change or new accepted fact. The reviewer checked all 12 staged files, output summaries and both figures. Findings resolved before the PR: a deterministic example is no longer scored against a fictitious stochastic sigma truth; nonexistent break estimands have null coverage; conditional form accuracy uses its flagged denominator; impossible likelihoods retain explicit `-Infinity`. The shared-error generator also preserves its declared marginals. The detailed review is in `independent-review.txt`. Acceptance and fixture freezing remain pending the human decision above.
