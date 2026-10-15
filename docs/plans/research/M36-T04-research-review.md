# Estimating strength from repetitions, load and reported RIR

BoGa research paper · 2026-10-15

## Abstract

We compare two ways to fit BoGa's adopted repetitions–load curve: hold observational uncertainty fixed, or estimate it jointly with strength. The curve has one free parameter, total 1RM S. Positive logged RIR has conditional three-point uncertainty; logged RIR 0 is exact. Load discrepancy is modelled separately. Synthetic experiments recover S under matching assumptions but identify RIR accuracy much less precisely. Session dependence and misspecified errors can invalidate uncertainty. A separate regression benchmark examines changes in curve amplitude; operational structural-break inference remains research.

## Observations and curve

For each qualifying set, retain performed repetitions m, logged RIR n, total calculated load L, exercise/gym identity, session time/order and loading/bodyweight context. Preserve logged values and existing metrics. Population and missing-effort handling follow [[1rm.curve-population]]; analytical equivalence follows [[1rm.curve-effort]]. Missing effort is not inferred from a target or treated as zero. Independent sessions, rather than individual sets, are the primary replication units.

Define f(u) as the existing `estimateOneRepMax(1, u)` kernel under [[1rm.formula]]. Given actual RIR r, the predicted total load is

```text
mu(S, m, r) = S / f(m + r),    S > 0.
```

Only S changes the curve amplitude. The adopted shape and single-repetition branch remain intact under [[1rm.formula]]. Candidate repetition counts must be positive safe integers. Bodyweight and per-side/total loading resolve through existing calculation functions, not an alternative formula.

Distinguish three quantities: latent strength S, observed analytical RM A evaluated at logged m+n, and the independent historical reference M governed by [[1rm.curve-reference]]. Descriptive load residuals against M are L−M/f(m+n), or 100 times that difference divided by the prediction. These are not latent-strength errors or independent evidence of a break. A point fitted to its own A has zero residual by construction.

## Conditional RIR and load model

Let p be the probability that a positive logged RIR reading has zero error. The initial value is p=0.50; the joint approach may estimate p in [0,1]. Both extremes always have equal probability.

| Logged RIR n | Actual RIR r | Conditional probability |
| --- | --- | --- |
| 0 | 0 | 1 |
| n > 0 | n−1 | (1−p)/2, initially 0.25 |
| n > 0 | n | p, initially 0.50 |
| n > 0 | n+1 | (1−p)/2, initially 0.25 |

Thus logged 1 permits actual 0, 1 or 2. A true failure may be logged 1, while a logged zero always means no further repetition was possible at that load. Exact RIR does not establish exact S or imply that another load could not produce a different RM equivalent. Load/performance discrepancy remains at RIR 0.

For positive readings, E[r|n]=n and Var(r−n|n)=1−p; initial RIR error SD is sqrt(0.5), approximately 0.707 repetitions. The initial model shares p across positive readings. Its ±1 support, symmetric tails and exact-zero reliability are assumptions to test, not measured properties of the available histories. The likelihood is conditional on logged n; no additional latent-RIR prior or likelihood for the frequency of logged readings is included.

Conditional on each actual-RIR state, L follows a Gaussian with location mu and scale tau, truncated to nonnegative loads:

```text
g(L | mu, tau) = phi((L−mu)/tau) / [tau × Phi(mu/tau)],    L >= 0, tau > 0.
```

Here phi and Phi are the standard normal density and distribution functions. Truncation means mu is the untruncated location, not exactly the truncated expectation. Logged Weight stays exact. This discrepancy represents variation around the curve and discrete load choices; it does not assert uncertainty in the mass of a plate or isolate gym granularity from fatigue or model error.

The fixed load SD is 1.25 kg for a per-side entry and 2.50 kg for a total-load entry. Existing semantics give total-load SD F times entry SD: 2×1.25=2.50 kg or 1×2.50=2.50 kg. One entered per-side value controls both sides. There is no independent-side variance calculation, second scaling or additional primary rounding variance. Dated bodyweight is fixed context; chart coordinates remain governed by [[1rm.curve-load]].

## Estimation and identification

For each observation i, let R(n_i) and w(r|n_i,p) be the states and probabilities above. The conditional log likelihood is

```text
ell(S,p,tau) = sum_i log [sum_{r in R(n_i)}
                         w(r|n_i,p) × g(L_i | S/f(m_i+r), tau)].
```

Both approaches minimize negative ell on identical observations:

| Approach | Estimated parameters | Fixed parameters |
| --- | --- | --- |
| Fixed uncertainty | S | p=0.50; total-load tau=2.50 kg |
| Joint estimation | S, p, tau | Adopted curve shape, equal tails and RIR support |

This is a mixture-likelihood objective, not ordinary least squares on RIR-normalized RM. Its density normalization and mixture weights matter. Even the mixture's expected load generally differs from the curve at m+n because inversion of the adopted kernel is nonlinear. Simulation therefore draws an actual-RIR component before drawing load.

Nuisance profiles maximize over the other parameters. Probability bounds 0/1 are finite physical endpoints; S/tau search boundaries remain unresolved when a profile reaches them. Retain disconnected profile components and interpolate crossings between grid scores. All-zero histories contain no p information. Positive readings may also contain no p information where the adopted kernel saturates. A numerical profile span ≤1e−10 suppresses the p estimate/interval while retaining the raw scores; it is a floating-point diagnostic, not a sufficient-data rule. A boundary optimum or broad [0,1] interval does not establish accurate effort reporting.

## Simulation design

Primary strength recovery uses one prespecified first ordinal per independent completed session in a constant-S window. Select it before outcomes; missing first effort does not trigger substitution of a later set. Generate logged n from a declared design, draw r|n, then draw load from its truncated component. Matching cells use logged integers 0–4 uniformly, m cycling through 2/4/6, S=100 kg and tau=2.50 kg.

Use 12/16/24/48 sessions and true p=0/0.5/0.75/1, with 400 calibration and 400 separate evaluation replications per cell. Joint profile cutoffs use the worst matching p-cell quantile at true tau=2.50 kg. Evaluate 19 stress cells, including off-grid truth, with 200 replications each: load-scale errors, rounding, logged-RIR designs, rep range, asymmetric/wider errors, false-zero labels, dependence/fatigue, changing S and information-poor designs. Correlated categorical stress draws use a Gaussian copula; the RIR marginal distribution remains three-point.

Full evidence comprises 6,400 strength-calibration datasets, 10,200 strength evaluations in 35 cells and 14,600 regression evaluations in 43 cells. Calibration and evaluation seed families are unique and disjoint. The strength grid is 80–120 kg by 0.5 kg, p has 13 candidates including both endpoints, and tau uses 0.5/1.25/2.5/3.75/5/7.5 kg. These are finite-grid research approximations, not globally converged optimizers.

Report finite-fit bias/RMSE separately from unconditional coverage and failures, plus Monte Carlo standard errors, widths, no-information counts, both p endpoint rates, disconnected components and unresolved boundaries. Intervals are conditional on the simulated family and calibration policy; arbitrary histories/load scales have no confidence guarantee.

## Strength results

The following cells have true S=100 kg, p=0.50 and tau=2.50 kg, with 400 independent evaluation replications each.

| Independent sessions | Fixed S RMSE kg | Joint S RMSE kg | Fixed / joint S interval coverage |
| --- | ---: | ---: | ---: |
| 12 | 1.057 | 1.164 | 93.00% / 94.50% |
| 16 | 0.904 | 0.931 | 93.75% / 97.00% |
| 24 | 0.752 | 0.770 | 93.75% / 95.00% |
| 48 | 0.485 | 0.478 | 95.75% / 97.00% |

At 24 sessions joint S bias is −0.006 kg (Monte Carlo SE 0.039 kg). Joint p RMSE is 0.358 and mean profile-set width is 0.946 on a possible range of 1; its optimum reaches 0/1 in 12.75%/22.50% of runs. At 48 sessions p RMSE remains 0.296 and mean width 0.862. S can be estimated more precisely than RIR accuracy. Joint tau RMSE at 24 sessions is 0.581 kg; marginal p/tau profile coverage is 98.25%/97.00%, not simultaneous coverage of all parameters. A rate near 95% with 400 replications has Monte Carlo SE about 1.1 percentage points; each output retains its actual SE. No numerical S fit fails in any evaluated cell.

All-zero and saturated positive-RIR designs suppress p estimates/intervals in 200/200 runs each while retaining S/tau profiles. Logged-1-only data include actual failure: fixed/joint S RMSE is 0.796/0.861 kg and coverage 95.5%/93.0%. Matching-population cutoffs are not separately calibrated for these conditional designs. Correctly fixed nuisance values supply information that joint estimation must learn; joint fitting need not improve S recovery.

| Stress; 24 sessions, 200 replications | Fixed / joint S interval coverage |
| --- | ---: |
| Load SD 5 kg, fixed assumption 2.5 kg | 66.5% / 97.0% |
| Asymmetric RIR errors | 70.0% / 79.5% |
| Serial categorical errors | 81.0% / 84.0% |
| False-zero labels | 36.5% / 85.5% |
| Errors outside ±1 | 77.5% / 99.0% |
| Shared-session errors, first set only | 95.0% / 95.5% |
| Shared-session errors, naive use of every set | 74.0% / 78.5% |
| Changing S, coverage of initial S | 0.0% / 3.0% |

Joint fitting can absorb some violations without validating their assumed support or mechanism. Broad coverage under wider errors is not evidence that ±1 is correct. A changing-strength window violates the constant-S estimand.

## Structural-break methodology

A break concerns the curve parameter S over time, not a change in curve shape. The implemented isolated benchmark uses known-RIR0 singles on a weekly synthetic grid, where f(1)=1 and Gaussian load SD 2.50 kg is also amplitude observation SD. It compares constant, linear and quadratic no-break trajectories with searched linear-plus-jump and linear-plus-hinge alternatives. Mixed-RIR/composition/false-zero/logged-1 stresses target observed analytical amplitude A and cannot automatically establish latent S(t).

For each admissible cut k, fit the jump and hinge by regression. With RSS_Q for the quadratic competitor and RSS_B for the best cut/form, the nonnegative search statistic is (RSS_Q−RSS_B)/(RSS_Q/N). An unusably small RSS_Q or insufficient segment support yields no result. Cuts occur between distinct completed-session times, with at least eight sessions on each side. Maximize over the declared 12/16/24/48 prefixes, then calibrate that complete search against the constant/linear/quadratic null family on separate seeds. This accounts for the declared family only; arbitrary repeated weekly monitoring remains unvalidated.

The full benchmark gives cutoff 10.018403233720234. At 48 sessions stable/linear false flags are 0.75% each and quadratic false flags 1.25%. A +5 kg level jump is detected in 11.75% of 24-session runs and 60.0% at 48. A +0.5 kg/week hinge is detected in only 0.5%/1.75%: a smooth quadratic competitor makes this alternative difficult to distinguish. Serial errors give 16.5% false flags at 24 sessions; naive correlated sets give 28.5%. Eight-per-side is a research search constraint, not an empirically sufficient sample size. Separate-seed known-form date/effect intervals are not post-selection guarantees. For a +5 kg jump at 24 sessions, their joint date/effect coverage is 96.75% in 400 runs, versus 23.5% with a long gap and 5.5% for a cut outside the search in 200 runs each. Gaps constrain dates to intervals between observations.

Retrospective wild bootstrap reruns the complete observed-prefix search with single-session or four-session-block signs. With 199 draws per method and 80 histories per error design, independent-history false flags are 6.25%/5.0%, but serial-history false flags are 56.25%/25.0%. These attempted dependence corrections are unreliable in that stress and do not validate operational inference.

Direct segmented conditional-likelihood fitting of S(t) with RIR/load uncertainty is exploratory work, separate from that RSS benchmark. The adopted direction is relative likelihood evidence to control the future candidate curve's emphasis. A candidate statistic is D=2(max ell_break−max ell_no-break), comparing the same observations and comparable error assumptions. Which nuisance parameters may vary by regime, search adjustments, adequate information, useful effect sizes and the evidence-to-emphasis mapping still require validation. D is neither a posterior break probability nor a point-membership probability. A second line or visually apparent shift is not proof of a statistically reliable break. The production chart makes no such assertion.

## Workout data and weekly progression

Read-only replay uses the authorized local Zercher Squat and Dumbbell Bench Press snapshot. Raw records remain private. Six exercise/gym cohorts have 1–7 evaluated sessions and at most one known-effort prespecified first set each; available efforts are positive. Sparse one-point profiles do not measure p/tau, lower load-grid optima are unresolved, and no cohort supports eight sessions on each side of a break. These histories cannot validate the error distribution or a physiological strength change.

The frozen weekly programme includes plateau/repeated-exposure progression plus stable and smooth controls. Held-load Strength exposures follow RIR 1/1/2/3; a later load increase returns to RIR 1 at the same analytical RM equivalent. This illustrates how additional reserve can signal progress before another load increment, subject to RIR uncertainty. All 72 descriptive prefixes, the six-prior reference of 100 and unavailable five-prior reference reconcile with the frozen oracle. They are logged/kernel equivalences, not a known physiological S(t) trajectory or proof of a break.

## Reproduction and verification

Use the [strength/error script](M36-T04-strength-error-validation.ts), [regression script](M36-T04-amplitude-regression-validation.ts) and [history/oracle replay](M36-T04-history-and-oracle-review.ts) when reproducing results. Run each with worktree-local `apps/mobile/node_modules/.bin/tsx --tsconfig apps/mobile/tsconfig.json`; no arguments produces full simulation output, and --quick is development-only for strength/regression. History replay requires TZ=Europe/London and the authorized local inputs. Method checks in `M36-T02-residual-regression-checks.ts` accept --correct-probability=<0..1>. The [figure script](M36-T04-statistical-figures.py) reads full strength/regression JSON and contains no RM formula.

Matching numerical evidence was generated from research code at commit `3add201e2fa930fec475affc3a0d5034e740a373`. Restricted local JSON, figures, logs, independent review and SHA256 manifest are under `apps/mobile/artifacts/research/rm-curve-three-point/`. Frozen fixture SHA256 is `1701f0287aeedc5ebb98a86d23a5fa18eb640cf319f22350662fdb7cfe452fce`. Raw account data is not committed.

Seeded method checks at p=0/0.5/0.75/1 pass. An independent Python math.erfc oracle verifies 81 conditional-mixture parameter cells, 243 point-load density evaluations and 162 scalar/grid comparisons, including low loads and p endpoints; maximum absolute log-likelihood difference is 3.372e−11. Independent Codex source/product, numerical and figure review is clean. Completed code gates: fast 286 suites/3,931 tests; coverage 86.56% branches/94.41% lines; complexity and dependencies pass, with 13 unchanged known dependency violations. Documentation consolidation is checked separately; numerical code and results are unchanged.

## Limitations and scope

The ±1 bound, equal and constant tails, exact-zero reliability, load discrepancy and session independence require adequate empirical validation. Parameter recovery under the declared generator does not establish real-user calibration. Keep both fixed and joint approaches available, with weak identification and unresolved boundaries visible. The first-release chart remains descriptive under [[1rm.curve-scope]]; latent-strength inference, structural-break decisions and evidence-driven curve emphasis remain research work.
