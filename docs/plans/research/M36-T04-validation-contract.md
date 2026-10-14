# Statistical comparison and validation contract

## Estimand and two approaches

The adopted unit-load estimator f fixes the curve shape. Latent total 1RM S is its only free curve parameter: predicted load is S/f(m+r) for performed reps m and latent RIR r. Keep S separate from observed analytical RM A at recorded m+n and the approved independent prior reference M. Sigma describes pre-quantisation RIR measurement error, not another shape parameter. Logged metrics and loading semantics remain unchanged.

Compare the same declared likelihood and paired observations with (A) sigma fixed initially at 1 rep, with 0/.5/2 sensitivities, and (B) S and sigma estimated jointly. Initially latent r is uniform over integers 0–4; recorded n is nonnegative rounded r+normal error, without an upper clamp. A separate positive load/task discrepancy tau uses the existing nonnegative truncated-normal likelihood. Load observations are generated from that distribution; plate rounding and alternative priors/tau are explicit misspecification stresses. Both methods share those nuisance assumptions. Correctly fixed sigma is an oracle comparison under matching truth; the joint method need not beat it.

Primary recovery uses one prespecified first set per independent completed synthetic session in a declared constant-S window. Choose the ordinal before generating observations, never search for a favourable effort or residual. All canonical known RIR, including equivalent reps above 10, remain observed. Support 1–10 applies only to M. Three-set fits and common/serial reporting or fatigue effects are dependence sensitivities, not additional independent sessions.

## Repetition, intervals and failure accounting

Predeclare separate calibration and evaluation seed ranges. Report conditional finite-estimate bias/RMSE and unconditional failure/coverage frequencies, Monte Carlo standard errors, interval widths and boundary/disconnected-profile flags. An impossible fixed-sigma likelihood is a no-fit outcome and counts as uncovered, not an observation to remove. Sigma 0 at a physical lower boundary is allowed; a finite search-grid upper boundary is not proof of a finite uncertainty limit.

Strength and sigma profile sets retain disconnected components. Linear interpolation between profile-grid scores defines continuous interval endpoints, including off-grid truths; report grid sensitivity and unbounded endpoints. Calibrate likelihood-ratio cutoffs on the declared matched generator, then evaluate them on different seeds, off-grid truth and nuisance stresses. These are conditional simulation-calibrated intervals, not universal confidence guarantees. No acceptance threshold is inferred from a pretty fit.

Start with 400 repetitions for matched recovery and calibration: near a 5% rate, Monte Carlo SE is about 1.1 percentage points; small differences need more repetitions. Stress comparisons may use 200 with their larger measured uncertainty. Replicate counts, seeds and actual failures are preserved in output. This design follows the simulation-reporting principles of [Morris, White and Crowther (2019)](https://doi.org/10.1002/sim.8086); the paper does not validate BoGa's measurement model.

## Curve-amplitude regression research

Break models concern changes in 1RM amplitude over time; they never reshape the reps curve. Validate the constant/linear/quadratic versus searched one-hinge/one-jump machinery with known 1RM-scale generators. Those benchmark observations can be reconstructed as synthetic singles at RIR0 through the adopted kernel. Other generators use noisy reported RIR and changing rep/task populations to expose the distinction between an analytical-RM trend and latent S(t).

Calibrate the maximum statistic over both break forms, admissible cuts and declared prefixes 12/16/24/48 against the complete no-break family using separate seeds. Minimum segment 8, with 6/10 sensitivity, implies no breakpoint search at 12 sessions. Report false-positive rate, power across effect sizes, model confusion, missed/unidentified changes, boundary/gap/off-grid localisation and model-specific effect/date coverage. Simulation-calibrated known-model intervals must not be presented as post-selection latent-strength intervals for unknown mixed RIR histories. Prediction checks refit using only earlier observations; future outcomes do not select the model used for their own evaluation.

Direct joint latent S(t)/sigma segmented likelihood and production detection remain deferred research choices; user emphasis is the two amplitude/error approaches. Strong strength/break claims require evidence beyond fitting observed A. Available T03 remote cohorts remain descriptive because effort provenance is uncertain and independent-session support is sparse.

## Fixture and human gates

Reuse the existing weekly wave without inventing another programme. Its raw plateau/RIR progression and separate stable/smooth controls, every completed prefix, high-rep/effort selection and insufficient baseline are the shared candidate oracle. Prepare a reproducible numerical oracle and checksum; exact fixture freezing and first-release analytical/product limitations require final human review before T05. No product fact or production overlay is changed by these experiments.
