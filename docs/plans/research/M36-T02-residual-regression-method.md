# Exploratory session residual regression and validation plan

Prepared from T01 commit `43482cd7de537dfce0982acfdbc8b8ab8b109bab`. The research specification and small method checks are delivered for review; **human analytical approval of this validation plan remains pending**. T02 is not complete until that approval and its agreed code/review gates pass. T03 provenance work and T04 reliability validation have not been executed. The work remains on the experimental stacked branch; no production detector, statistical dependency, route or product default follows from this document.

## Inputs and analysis unit

Use the approved T01 contracts [[1rm.curve-population]], [[1rm.curve-effort]], [[1rm.curve-reference]] and [[1rm.curve-load]], plus the residual definition in `docs/specs/tech/training-metrics-contract.md` §6. Preserve raw IDs/order, performed reps, recorded effort, load context, session dates and provenance. Reuse the actual kernel; never copy the RM formula. The statistical inputs are separate analytical total RM A and a fixed positive reference M. Set percentage residual is `100 × (A/M − 1)`.

Proposed primary research response: one median of finite set percentage residuals per completed session, with sessions weighted equally. A session with no analytical points contributes no response. Retain its set count, actual/effective rep distribution, recorded-RIR composition and task-standard annotations beside that response. Session maxima and a prespecified first-set selection are alternative summaries; they answer different questions and are not additional independent observations. The prior reference uses session bests, so a stable session median need not equal zero. The provisional stable control has capacities100/99/98 and M100: its median residual is −1%.

Sessions are the replication unit; 72 sets in the shared history yield 24 session responses. Aggregation prevents treating correlated sets as independent evidence, but does not make adjacent workouts independent. Model residuals may retain shared day effects and serial dependence. Define t as elapsed UTC days/7 since evaluation start, using session start time; a missing week is a gap, not a zero or a compressed workout index. This is a statistical duration coordinate, not a change to local-calendar product windows.

Each prefix keeps the same evaluation start/prior cutoff and baseline interval. No evaluated, tied-cutoff or future session enters M. The script's prior array is already the provisional selected-window input; it is not a replacement for T03 verification of real History bounds, identity or provenance. Source/policy/filter corrections cause an explicit coherent rerun, not claimed immutable past output. Fewer than six eligible prior sessions yields no reference residual/fit. Baseline support and sufficient evaluation evidence are separate requirements.

## Candidate models and search

For session response y and a declared covariate vector z, compare:

| Candidate | Mean response | What it describes |
| --- | --- | --- |
| Constant | `a + z c` | No time trend, free intercept |
| Linear | `a + b t + z c` | Progressive trend |
| Smooth sensitivity | `a + b t + q t² + z c` | Smooth curvature without a break |
| One continuous hinge | `a + b t + d max(0,t−τ) + z c` | Slope change d, continuous level |
| One jump | `a + b t + g I(t>τ) + z c` | Level change g, common slope |

The initial experiment compares zero versus one breakpoint; it does not search arbitrary numbers of breaks or combine a jump with a slope change. A process containing both changes is a later misspecification/abstention scenario. A quadratic is a small smooth competitor, not an exhaustive model of all gradual change. Positive slope/level coefficients describe analytical estimates under the assumption; they do not diagnose physiological strength.

Proposed search grid: midpoints between distinct observed session times, keeping at least eight sessions on each side. Six and ten are sensitivity settings, not reliability guarantees. Eight represents two four-phase waves per side in the complete starter; missing phases remove that assurance. No split divides tied times. Fit the complete model at every candidate, retaining its profile rather than reporting only the winner. A jump cannot be localized within an unobserved gap: report the neighbouring-session interval. Hinge midpoints are a declared resolution restriction; continuous optimization is not implemented and may yield a different estimate. Test off-grid truths later.

The numerical helper solves scaled least squares with twice-reorthogonalized Gram–Schmidt, rejecting nonfinite inputs, inconsistent dimensions, no residual degrees of freedom and normalized column residual norm ≤1e−10. This is a numerical rank guard, not an inferential threshold. Covariate/time overlap must also be inspected: a numerically full-rank matrix can still be too weak or imbalanced for a useful claim.

Start with no covariates as a descriptive baseline; compare declared phase indicators and same-phase histories as sensitivities. Reset's controlled eccentric tempo/pause may change the performed task even after RIR normalization. Separately exclude reset and restrict effective reps to1–10 for regression sensitivity; approved observed points remain available and baseline support never widens. Actual reps m, recorded RIR n and u=m+n are linearly dependent, so do not fit all three linear terms together. Add one rep-range/effort composition representation at a time; time interactions require overlapping strata before/after and enough sessions. If phase, equipment, task or effort shifts coincide with a candidate break, report confounding, not an adjusted strength conclusion. No automatic production phase filter is proposed.

## Comparison, penalties and selection

Report N sessions, design columns, searched cuts, RSS and effect sizes. Ordinary candidate BIC is a **ranking sensitivity**: `N log(RSS/N) + k log N`, with k counting coefficients, error variance and one searched τ. It is undefined for the noiseless controls; the helper reports null below a numerical RSS tolerance rather than inserting arbitrary noise. [Schwarz (1978)](https://sites.stat.washington.edu/courses/stat527/s13/readings/ann_stat1978.pdf) motivates a large-sample dimension penalty; it does not validate this penalty for 24 sessions, discrete searched cuts, medians, serial errors or selected covariates. No BIC winner becomes a significance claim.

Complement ranking with chronological prediction errors. At each declared training origin, refit and re-search using only that prefix; forecast the next session and retain errors for all alternatives. Model selection needs an inner chronological comparison or a declared training-only rule, followed by untouched outer future sessions. The small script checks candidate predictions; it does not present those same outer errors as an unbiased evaluation of a retrospectively chosen winner. Phase composition of held-out sessions must be reported. Rolling-origin assessment is supported by [Tashman (2000)](https://www.sciencedirect.com/science/article/pii/S0169207000000650).

For a future inferential comparison, define the family before seeing results: constant/linear/smooth no-break generators, both searched break forms, cut bounds, covariate sensitivities and any repeated-prefix decisions. Proposed statistic for a declared linear null is the maximum RSS improvement over the complete hinge/jump grid, with all null parameters refitted in each replicate. A curved no-break generator is separately required; a test against linearity cannot distinguish an abrupt break from omitted curvature. [Andrews (1993)](https://users.ssc.wisc.edu/~behansen/718/Andrews1993.pdf) and [Davies (1987)](https://www.robertnz.net/pdf/nuisance2.pdf) explain the nonstandard search problem: τ is absent/unidentified under no break. A fixed-cut test at the selected τ, naive set-level standard errors and repeated uncorrected weekly tests are invalid shortcuts.

T02 includes 32 seeded wild-sign examples applied to the aggregated session residuals: `y*s = fitted-null(s) + residual(s) × sign(s)`, sign equally likely±1. Each replicate refits the null and searches both forms/all admissible cuts. Those examples exercise search/resampling mechanics under independent-workout assumptions, not validated p-values. For set-level examples, all sets in a session must share its resampling multiplier. Add serial-error generators and dependence-preserving residual/block or explicit day-error models for T04; do not silently shuffle workout times. Few-cluster refinements still require assumptions, as [Cameron, Gelbach and Miller (2007/2008)](https://www.nber.org/papers/t0344) demonstrate.

## RIR measurement model — user-authorized starting assumption

The owner requested the simple starting model with equal error across RIR and a plausible value of1. Interpret1 as **per-set pre-quantization measurement-error SD in reps**, not the standard error of a session mean. Simulations distinguish known latent integer RIR r from recorded integer n:

```text
e ~ Normal(0, sigma_RIR²)
n = max(0, round(r + e))
initial sigma_RIR = 1 rep, equally for every r
illustrative sensitivities: 0, 0.5, 1, 2 reps
```

The check script accepts `--rir-sd=<value>`; no upper clamp at4 is applied. Gaussian draws are a proposed distributional experiment; their shape is not empirically calibrated. Round with JavaScript `Math.round` and clamp negative recorded values to zero, validating safe integers. The latent r stays nonnegative and distinct from the simulated record. Truncating/resampling the error instead would be a different model, not a hidden implementation detail. Boundary censoring changes mean and variance near RIR0: constant pre-rounding SD does not imply constant recorded variance or constant analytical RM variance across loads/reps. High-RIR-specific SD can be examined later; it is not the initial assumption.

Generate known-control loads using latent r and the adopted estimator, then analyse the forward-generated recorded n through the actual kernel. For the illustration, the starter stable/prior RIR coordinates serve as synthetic latent inputs only; this does not declare real recorded RIR to be latent truth. For actual histories, true RIR, reporting bias, formula mismatch and session variation are not identifiable from m/load/n alone. Adding noise to observed n is a sensitivity perturbation, not a posterior draw of true RIR. Repeated calibrated effort assessments or independent task-standard evidence would be needed to identify an empirical error model.

Keep logged history intact. Changing simulated/perturbed n changes both u and A, reference support and possibly the chosen six session bests. Compare observation-only error with coupled prior/evaluation error under the same fixed time cutoff. Do not use a rolling reference. Deterministic n±1 (bounded at zero) remains a separate scenario, not a confidence interval. At6 reps80kg, recorded RIR1/2/3 gives analytical99.223971/102.137135/104.997052kg; actual-m global RM stays96.264464kg.

The starting per-set errors are independent draws. Optional session reporting bias/dependence is a declared later sensitivity: for example split a fixed total RIR variance between a common session component and independent set components. Model formula/task/day/load uncertainty separately; homoskedastic RIR error does not eliminate it. Inference on session residuals must accommodate the unequal variance produced by nonlinear transformations, censoring, support selection and varying set counts.

## Alternative joint strength / RIR-SD candidate

Preserve the configurable fixed-σ path. The owner also requested investigating whether comparable sets can jointly estimate an RM/strength parameter and RIR error SD. Call this parameter S, a latent total-RM level for a declared short comparable window or a prespecified trajectory S(t). S is distinct from set-derived analytical A, actual-m displayed 1RM and the approved chart reference M. A fitted S does not replace the six-prior-session chart reference. Use `f(u)=estimateOneRepMax(1,u)` from the kernel, so the latent predicted calculated load is `S/f(m+r)` at integer latent RIR r.

Exact common S with integer r is an initial feasibility constraint, not a safe assumption for real sets. For6 performed reps, loads80 and81kg have no common exact S over latent r0–4; the minimum separation between their possible implied strengths is1.2033kg. Free continuous latent r would hide this by departing from the approved integer equivalent-rep coordinate; freely changing S for every set would eliminate shared-strength identification. Neither shortcut is used.

Proposed small probabilistic candidate, conditional on performed reps/task and a declared latent-RIR mixing distribution π:

```text
r is a nonnegative integer latent state with declared weights pi(r)
n | r,sigma follows the same rounded/censored Gaussian reporting model
L | r,S,tau follows Normal(S/f(m+r),tau²), restricted to L>=0
p(L,n | m,S,sigma,tau) = sum_r pi(r) p(n | r,sigma) p(L | r,S,tau)
```

Here τ>0 is a separate load-coordinate discrepancy scale for formula/task/performance differences, not an assertion that a plate's recorded weight is noisy. The demonstration fixes τ and profiles S/σ; it also compares τ0.2/1/3kg. It does not attribute every discrepancy to RIR or claim these scales are calibrated. If τ is freely estimated, include its profile and tradeoff with σ/S; a common session/fatigue component needs corresponding dependence modelling. The recorded-value likelihood is `Phi((.5−r)/σ)` at n0 and `Phi((n+.5−r)/σ)−Phi((n−.5−r)/σ)` above zero; atσ0 it is a point mass. The normal CDF relation is documented by [NIST DLMF §7.20](https://dlmf.nist.gov/7.20). The helper computes central probabilities by numerical integration and tail log probabilities by the [NIST DLMF §7.9 continued fraction](https://dlmf.nist.gov/7.9), then differences tails with `expm1`. Joint scoring uses log probabilities directly; it never treats a positive-SD observation as impossible merely because its probability underflows or two CDF values round to one. No statistical dependency is added.

The toy marginalises a declared uniform latent-r prior on0–4; that is a **synthetic design assumption only**, not a clamp on observed RIR or an estimated distribution for real lifters. The actual recording model can produce n above4. A different finite support/prior, or profiling every latent r as an incidental parameter, changes the likelihood and needs separate validation. Loads/reps are chosen by a programme in real training, so π may depend on that selection/task design; uniform independent latent r cannot silently transfer to those data. Inspect latent support and prior sensitivity before interpreting σ.

Feasibility requires close-in-time, same-definition/gym/equipment/task cohorts with reliable m/n/load provenance, repeatable execution and enough varied rep/load/RIR combinations to separate S from reporting noise. Prefer comparisons with several independent sessions; multiple near-identical sets from one workout share fatigue/readiness/reporting bias. Repeated identical m/load/n contributes little separation and cannot independently reveal the error distribution. Time-varying strength, session fatigue, inconsistent tempo/range, rounding/plate increments, dated bodyweight, formula mismatch and unknown π/τ can all explain apparent spread in derived RM. Their variation is not automatically an estimate of σ_RIR. Account for nonnegligible load precision with an interval/rounding likelihood rather than treating displayed decimals as exact continuous measurements. A stable-S window and a declared smooth S(t) sensitivity are different models, with parameter counts and data needs stated in advance.

The joint experiment generates32 independent toy observations at S100, σ1, τ0.2 using varied performed reps2/4/6 and known π, then searches S90–110 in0.5kg steps and σ0/.25/.5/.75/1/1.25/1.5/2. It recovers S100 and a grid σ estimate0.75 for this one seed; fixedσ1 also peaks at S100. This single sample is not evidence that0.75 is the empirical error or an unbiased estimator of1. At τ3 the descriptive set within two log-likelihood units spans S99–101.5 and σ.5–1. An eight-row identical-set example spans S99.5–104.5 and σ0–1 under the same descriptive convention. These are parameter-profile diagnostics, **not confidence regions**. Infeasible σ0 likelihoods are serialized as `-Infinity`, not finite fits. Numerical grid bounds/step and latent-support truncation can conceal wider modes; T04 must extend them and test off-grid recovery.

T04 must test joint S/σ recovery and separability over independent seeds, varied support/priors, known versus estimated τ, shared bias/fatigue, changing S(t), quantization/censoring and load precision. Report parameter bias/error, interval coverage if proposed, boundary/flat/multimodal profiles and dependence on nuisance assumptions. Without independent RIR ground truth this remains a model-dependent estimate, not independent empirical RIR calibration. Return insufficient evidence where S/σ/τ/prior effects cannot be separated; retain fixed-σ scenarios as the alternative rather than silently replacing them.

## Uncertainty and insufficient evidence

The current fit profile, competing models, influence of removing one whole session, and simulated selection frequencies are descriptive diagnostics, with no confidence level attached. A search-boundary minimum, flat/multimodal profile, collinear phase/break, wide gap, unstable effect sign, inadequate support or severe serial dependence without credible error modelling returns **insufficient evidence**. A no-break history makes τ undefined; do not force a date/interval or treat missing localization as failure to optimize.

For prespecified model/cut and independent Gaussian equal-variance session errors, ordinary coefficient t intervals have their usual conditional interpretation. They do not cover a cut/model selected from the same data, and RIRσ1 does not establish their error assumptions. Subsequent research must compare model-specific procedures:

- **Hinge:** profile/score inversion with its continuity constraints, including weak/zero slope-change cases. [Muggeo (2017)](https://onlinelibrary.wiley.com/doi/abs/10.1111/anzs.12200) supplies a smoothed score interval proposal; applicability to aggregated, serial and measurement-error responses remains to test.
- **Jump:** a profile statistic with critical values justified for the declared fixed-time design/error generator, or a model-specific resampling inversion. Standard bootstrap percentile dates are not automatically valid: [Seijo and Sen (2011)](https://arxiv.org/abs/1101.1032) show failures and alternatives in stochastic-design jump regression. Their assumptions differ from this fixed workout grid.
- **Finite-design calibration candidate:** at each hypothesized τ generate responses under the constrained candidate, refit nuisance terms and invert the tested profile over τ. Known generating nuisance parameters permit a conditional Monte Carlo check; plugging in estimated parameters yields an approximation requiring coverage validation. Project over τ/model uncertainty for slope/level effects rather than taking the selected-cut coefficient interval. Return disconnected/wide/full-search sets when supported. Any confidence claim must include discretization, model selection and weak identification, not only successful well-separated breaks.

Condition on observed M when comparing trend shape on a fixed cohort; M is a shared offset/scale, not fresh independent noise per observation. For absolute residual-level uncertainty, include prior-session sampling/measurement variation and reapply maximum/median/support selection. Source edits or perturbed eligibility can change the cohort, and six reference sessions give weak variance information. Neither a small bootstrap nor RIR±1 supplies calibrated confidence in strength.

## Reproduction and observed method checks

Research script: `M36-T02-residual-regression-checks.ts`; test-only numerical helper: `apps/mobile/__tests__/helpers/residual-regression-research.ts`; focused suite: `apps/mobile/__tests__/residual-regression-research.test.ts`. Only the research script imports the provisional plan fixture; no production import/dependency is introduced. The helper contains no domain rule or copied RM constants. The files are applied and reviewed; repository gates pass. Evidence is recorded with the experimental research draft PR.

```sh
node docs/plans/research/M36-T02-residual-regression-checks.ts
node docs/plans/research/M36-T02-residual-regression-checks.ts --rir-sd=0.5
```

Node24, seed20261013; provisional fixture SHA256 `172dae999afb8e2a0a3dcf34ced8c474f17eca76c04a68aa17edc753e144ae26`. Standalone assertions passed atσ0/.5/1/2 in staging against the actual kernel, plus the joint candidate's seeded recovery/profile checks. Independent Python `math.erfc` checks cover321 CDF points (maximum absolute error2.792e−11) and576 RIR intervals (maximum relative error2.809e−10 where the oracle probability is representable). All interval log probabilities remain finite, including15 cases whose ordinary oracle probabilities underflow. Outputs are reproducible JSON; gate/evidence artifacts belong with the PR. The scripts are method checks, not a new test lane. A Node module-format warning occurred; no runtime/package configuration was changed to remove it.

| Check | Observed result / interpretation |
| --- | --- |
| Stable and linear control | Median−1%; linear intercept−0.01 at first session t0, slope0.99pp/week. Noiseless BIC is null. |
| Known one-hinge / one-jump | Separate noiseless truths recover τ11.5, slope change0.8 and level change5; the other form leaves nonzero error. Arithmetic recovery is not measured power. |
| Smooth curved no-break | Linear RSS109.6333, searched hinge6.6733, quadratic approximately0: a much better break fit still need not represent a break. |
| Plateau primary | At min8, linear BIC3.5063 beats searched jump4.8590 and hinge6.0853 under this ranking convention. This is an illustrative comparison, not evidence for/against physiological breaks. |
| Support / phase | Restricting regression to u1–10 leaves18 sessions. Week13's median residual changes from5.2718% to2.6670% because its two higher-u sets leave. Selection changes the response. |
| RIR error and baseline coupling | Atσ1 one seeded forward reference becomes100.5372, changing all residual levels. Coupled deterministic+1 leaves only4 qualifying prior sessions and therefore no reference fit; observation-only+1 still has M100. |
| Boundary / high RIR | The32 σ1 draws at latent0 average recorded0.34375; this illustrates censoring only. RIR4 plus a three-SD draw records7, with no upper clamp. |
| Tiny Gaussian tails | Recorded RIR7/latent4/σ.25 has probability7.619853e−24 and finite joint score−54.1502 in the targeted load example. σ0 correctly remains impossible; recorded100 retains finite log probability despite ordinary probability underflow. |
| Pseudoreplication / search | Three dependent sets per session still yield24 rows; duplicating every set does not increase N. Example max search gain9.7444 versus first-cut0.1400 shows why the whole scan matters. No p-value/rate is reported. |
| Prefix / sparse / rank / gaps | All24 prefixes unchanged by later rows; fewer than6 prior sessions gives no fit, and min8 gives no break before16 sessions. Collinear time/phase designs are rejected; a jump between time11 and32 reports that gap, not midpoint21.5 as a known date. |

## T04 validation proposal and human checkpoint

T03 first audits authorised historical effort/task/gym provenance; synthetic truths cannot replace it. T04 freezes the shared fixture only after the outstanding programme clarification and validates reliability using **independent known-control generators**, not a guessed latent trajectory for the primary plateau story.

Proposed preregistered candidate matrix for analytical review: evaluation N12/16/24/48; same regular schedule plus missing sessions/gaps; constant/linear/quadratic no-break truth; isolated level/slope and combined changes at interior, boundary and off-grid times; RIRσ0/.5/1/2, rounding/censoring, baseline coupling and optional session reporting bias; additional session/set noise, unequal variance, serial dependence, outliers, rep/RIR/phase/tempo changes, high-u observations and invalid/missing effort; fixed-σ and joint S/σ approaches with known/estimated τ, latent-prior/support and load-precision sensitivities. Baseline support includes fewer than6, exactly6 and additional eligible sessions with identical prior-window/cutoff logic. No threshold is already approved.

Report false-positive probability across the entire declared search/prefix/model family for every no-break generator; power across effect sizes; slope/jump confusion and wrong-model rates; localization error and gap/off-grid behaviour; nominal effect/breakpoint interval coverage, widths and unidentifiable outcomes; prediction error on untouched later sessions; and Monte Carlo standard errors. Proposed reporting levels are5% error and95% intervals, subject to owner review, not accepted reliability or release thresholds. A minimum useful effect/power and acceptable false-positive/coverage bounds must be agreed before interpreting success. Choose replicate counts from precision needs and record them: estimated rate p has MCSE `sqrt(p(1−p)/B)`; 32 examples cannot measure useful reliability. Calibrate on one seed set and evaluate on separate seeds rather than optimizing thresholds on their own reported performance.

The usefulness checkpoint is whether session summaries add information the owner values beyond the observed scatter and whether interpretations survive plausible RIR/composition/task sensitivities. If they do not, preserve descriptive points and explicitly report insufficient evidence for strength/break inference; cheap abandonment remains available. Even successful T02 checks authorise no production feature. On 2026-10-14 the owner approved proceeding to T03 after reviewing this plan. Both fixed-σ and joint candidates remain in the research validation scope; T04 analytical/product approval remains a further gate before design.
