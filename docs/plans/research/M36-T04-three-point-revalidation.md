# Conditional three-point RIR research revalidation

Status: research implementation and full simulations completed and independently reviewed on the experimental branch, 2026-10-15; final gates recorded below. No production chart, reference, loading rule, metric or frozen programme change.

## Adopted observation model

The owner adopted uncertainty around the logged reading n. Logged n=0 means actual r=0 exactly. For n>0, actual r is n−1, n or n+1, with probabilities (1−p)/2, p and (1−p)/2. Start with p=0.50, giving 25%/50%/25%; joint estimation may fit p in [0,1] while retaining equal tails. Logged 1 therefore includes actual 0. Actual failure need not always be logged 0. There is no positive-reading floor, Gaussian RIR error, cap at RIR 4, or extra uniform latent-RIR prior.

Here p is the probability of zero RIR error conditional on a positive logged reading; it is not overall accuracy or a break probability. Conditional mean actual RIR is n, variance 1−p and initial SD sqrt(0.5), about 0.707 reps. The old SD 1 assumption is superseded. A bound of ±1 and symmetric errors are assumptions, not empirically measured facts. The initial model shares p across all positive readings.

For state r, predicted total load is S/f(m+r), using the adopted estimator unchanged. The conditional load likelihood sums the one or three nonnegative-truncated Gaussian component densities with those weights. Generate logged n from a declared design, sample r|n, then sample load conditional on that r. The mixture mean generally differs from the central curve because the adopted inverse is nonlinear. Logged effort, weight and actual-rep metrics are never rewritten; load uncertainty represents discrepancy around predicted capacity. Candidate m+r and n±1 must remain safe integers.

Fixed fits estimate S with p=0.50 and total-load tau=2.50 kg; joint fits estimate S,p,tau by maximizing that conditional mixture likelihood. Entry uncertainty remains 1.25 kg per side or 2.50 kg total, converted once by existing semantics; bodyweight context is fixed. Only S controls curve amplitude. At logged 0, RIR uncertainty disappears but load discrepancy remains.

All-zero histories cannot identify p. Positive readings can also fail to identify it where the adopted kernel saturates; a numerical flat-profile span ≤1e−10 returns no p estimate/interval. This is a floating-point diagnostic, not a sufficient-data threshold. Raw profiles remain. Probability endpoints 0/1 are physical finite bounds; broad intervals spanning [0,1] still indicate weak information. S/tau search-edge intervals remain explicitly unresolved.

## Validation and reproduction

Primary recovery retains the first ordinal selected before outcomes, one per independent completed session, in constant-S windows. Fixed and joint methods use identical observations. Full matching cells use 400 calibration and 400 separate evaluation repetitions at 12/16/24/48 sessions and true p=0/0.5/0.75/1. Joint cutoffs take the worst matching p-cell quantile, conditional on true total-load SD 2.50 kg. Stresses use 200 repetitions: off-grid p/S/load, wrong load scale, plate rounding, high/wave logged-RIR designs, high reps, asymmetric or wider errors, false zeros, serial/common categorical errors, fatigue, changing S, all-zero/all-positive/logged-1/composition and saturated high-RIR cases. A Gaussian copula is used only for dependent categorical stress draws; it is not Gaussian RIR error.

Full output contains 6,400 strength-calibration datasets, 10,200 strength evaluations in 35 cells and 14,600 regression evaluations in 43 cells. Strength cutoffs are recomputed with fresh, disjoint calibration/evaluation seeds. Finite-fit errors, unconditional coverage, no-information counts, both p endpoint rates, disconnected profiles and grid limits remain in the JSON. The S grid is 80–120 kg by 0.5 kg; p has 13 candidates including both endpoints; tau has six candidates from 0.5–7.5 kg. These finite grids and their interpolated profile sets are research approximations.

The current TypeScript scripts use worktree-local tsx and the mobile tsconfig. T02 method checks take --correct-probability=<0..1>. Full JSON/logs/figures and evidence live in ignored `apps/mobile/artifacts/research/rm-curve-three-point/`; quick output is development-only. Previous Gaussian outputs remain under `apps/mobile/artifacts/research/rm-curve-exact-zero/`, reproducible at commit `db3b4b79`; its obsolete oracle source is archived as `.ts.txt` so current typechecking does not compile an old API. The older world differs in both distribution and conditioning, so a smaller RMSE alone would not establish a superior method.

## Strength recovery and identification

These matching cells have true S=100 kg, p=0.50 and tau=2.50 kg; each has 400 independent replications. Coverage concerns the declared synthetic family, not real-user confidence guarantees.

| Independent sessions | Fixed S RMSE kg | Joint S RMSE kg | Fixed / joint S interval coverage |
| --- | ---: | ---: | ---: |
| 12 | 1.057 | 1.164 | 93.00% / 94.50% |
| 16 | 0.904 | 0.931 | 93.75% / 97.00% |
| 24 | 0.752 | 0.770 | 93.75% / 95.00% |
| 48 | 0.485 | 0.478 | 95.75% / 97.00% |

At 24 sessions, joint S bias is −0.006 kg (Monte Carlo SE 0.039 kg). Joint p RMSE is 0.358, its mean profile-set width is 0.946 on a possible range of 1, and its optimum reaches 0/1 in 12.75%/22.50% of runs. At 48 sessions p RMSE remains 0.296 and mean width 0.862. S can be useful while p remains weakly identified. Joint tau RMSE at 24 sessions is 0.581 kg; p/tau profile coverage is 98.25%/97.00%. Near 95% with 400 repetitions, rate SE is about 1.1 percentage points; each output retains its measured Monte Carlo SE. No numerical S fit fails in any evaluated cell.

Both all-zero and saturated positive-RIR histories suppress p estimates/intervals in 200/200 runs while retaining S/tau profiles. Logged-1-only data include actual 0 without a boundary correction: S RMSE is 0.796/0.861 kg and S coverage 95.5%/93.0%. The matching-population cutoff is not separately calibrated for these conditional designs.

Misspecification still matters. Under understated load discrepancy, S coverage is 66.5%/97.0%; asymmetric RIR errors give 70.0%/79.5%; serial categorical errors give 81.0%/84.0%; deliberately false zero labels give 36.5%/85.5%. Joint fitting absorbs some violations but does not validate them. Taking every correlated set as independent reduces shared-session coverage from 95.0%/95.5% with first-set selection to 74.0%/78.5%. A changing-strength window violates the constant-S estimand and has only 0%/3% coverage of initial S. The ±2-error stress has 77.5%/99.0% coverage; broad joint uncertainty is not evidence that its assumed support is correct.

## Break and historical replay

The complete known-RIR0 amplitude regression search is rerun, including cut, form and the declared 12/16/24/48 prefix family. Its unchanged null benchmark reproduces cutoff 10.018403233720234, with 0.75% stable/linear and 1.25% quadratic false flags at 48 sessions. A +5 kg jump has 11.75% detection at 24 sessions and 60.0% at 48. A +0.5 kg/week hinge has only 0.5%/1.75% detection: allowing a quadratic no-break trajectory makes this alternative difficult to distinguish. Serial errors still give 16.5% false flags at 24 sessions; naive correlated sets give 28.5%.

Mixed-RIR, composition, false-zero and logged-1 stresses use the new conditional generator but target observed analytical amplitude A. They are not a full segmented conditional-likelihood fit of latent S(t). This remains an RSS research diagnostic. Direct segmented likelihood, evidence-to-curve-emphasis calibration, real-history adequacy rules and unrestricted weekly monitoring remain future work; no production break score or threshold is introduced.

Authorized history replay reuses the same private local snapshot without new remote access. Zercher Squat/Dumbbell Bench Press retain six cohorts with 1–7 evaluated sessions and at most one known-effort prespecified first set per cohort; available efforts are positive. Sparse one-point profiles do not measure p/tau, their lower load-grid optima remain unresolved, and no cohort supports eight sessions on each side of a break. All 72 frozen descriptive programme prefixes, the six-prior reference of 100 and insufficient-five-prior result reconcile with the unchanged oracle/hash. Those prefixes are not a known latent physiological trajectory.

## Numerical checks, gates and review

Seeded method checks pass at p=0/0.5/0.75/1; development quick runs and historical replay pass. An independent Python math.erfc oracle verifies 81 conditional-mixture parameter cells, 243 point-load density evaluations and 162 scalar/grid comparisons, including low load and physical p endpoints. Maximum absolute log-likelihood difference is 3.372e−11. Both scientific figures were regenerated from full output and visually inspected.

Agreed finished-code gates: fast PASS, 286 suites/3,931 tests plus aggregate checks; jest-coverage PASS, 86.56% branches/94.41% lines; complexity PASS; dependencies PASS, 525 modules/2,637 edges with 13 unchanged known violations. The separate final docs-check result is retained in `docs-check.log` after this report is saved. No UI/native/backend-contract change requires another slow lane. Independent Codex source/product and full-output review is clean after retaining both p boundary rates and correcting a historical link. The reviewer checked replicate-level results, unique/disjoint seeds, both figures, the conditional oracle and gate evidence without rerunning simulations or reading private historical rows. No dependency, threshold, production formula or loading convention change is needed.

The ±1 bound, equal and constant conditional tails, exact-zero provenance, load discrepancy and independent-session assumptions remain unverified against adequate real histories. Keep both fixed and joint approaches available; these simulations do not establish a reliable individual accuracy estimate or a calibrated latent-strength break detector.
