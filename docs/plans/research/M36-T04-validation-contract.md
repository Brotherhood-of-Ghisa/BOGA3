# Statistical validation contract

When reproducing or extending the research model, use the [research paper](M36-T04-research-review.md) for its conditional likelihood, parameters and numerical findings. This contract owns the validation requirements.

## Paper maintenance

Update the paper in place whenever the model or matching simulation evidence changes. Present only the adopted model, its matching results and clearly labelled open research questions; remove superseded formulations/results instead of appending iteration reports. Git history retains provenance. Never relabel an older simulation as evidence for different assumptions.

## Model and paired comparisons

Use exact logged RIR 0 and the conditional three-point distribution for positive readings. Compare S fitted with p=0.50 and total-load tau=2.50 kg against joint S/p/tau fitting on identical observations. Keep the tails equal, p within [0,1], load discrepancy positive and the adopted RM kernel unchanged. Missing effort remains unavailable. Logged metrics, loading semantics, chart/reference rules and the frozen programme are not modified by research fitting.

Primary strength recovery uses a prespecified first ordinal from each independent completed session in a constant-S window. Select the ordinal before outcomes; never replace it because its effort is missing. Separate all-set fits and shared/serial errors are dependence stresses. Keep exercise/gym identity, timing/order and load/bodyweight context available for diagnosing confounding.

## Calibration and reporting

Use separate, unique calibration and evaluation seeds. Matching cells cover 12/16/24/48 independent sessions and true p=0/0.5/0.75/1 at total-load tau=2.50 kg, with 400 replications for each calibration/evaluation cell. Calibrate fixed and joint profiles under their declared policy. Stress cells use 200 replications and include off-grid truth, alternate load scales, rounding, effort/rep designs, dependency, asymmetry, wider RIR errors, false zeros, changing S and information-poor data. Other load scales and designs are sensitivities, not automatically calibrated policies.

Report finite-fit bias/RMSE, unconditional failure/coverage, Monte Carlo SE, profile widths/components and grid diagnostics. A no-fit outcome counts as uncovered; do not remove impossible observations or silently widen eligibility. Retain both physical p endpoint rates. Flat p profiles, including all-zero and kernel-saturated histories, supply no p estimate or interval. Distinguish numerical flatness from a statistical adequacy decision; broad intervals can remain uninformative without being exactly flat.

Use interpolated profile crossings while retaining disconnected components. Treat p endpoints as finite physical bounds and S/tau grid endpoints as unresolved. A lower tau grid optimum can hide divergence toward zero in repeated deterministic data and does not measure a noise floor. Record grid sensitivity; one refinement check is not global convergence. Simulation coverage and Monte Carlo precision do not establish real-history reliability.

## Amplitude and break validation

S is the only curve parameter. The isolated regression benchmark uses known-RIR0 singles with total-load SD 2.50 kg, separating curve-amplitude changes from RIR error. Calibrate the maximum over no-break competitors, both break forms, admissible session cuts and declared 12/16/24/48 prefixes. Minimum eight sessions per side, with six/ten sensitivities, is a search constraint rather than a sufficient-data rule. Report power, false flags, form confusion, misses, gaps/boundaries and conditional versus unconditional localization/effect coverage. Forecast checks use only earlier observations.

Mixed-RIR stresses concern observed analytical amplitude unless a direct segmented conditional likelihood is fitted and validated. For that research, compare break/no-break likelihoods on the same data with comparable nuisance assumptions, account for cut/suffix/form selection and repeated assessments, and examine noise-only alternatives and serial dependence. Relative likelihood evidence may guide future candidate-curve emphasis; no probability, threshold, opacity mapping or production assertion follows from the RSS benchmark.

## Empirical and human review

Use only authorized histories; raw exports stay restricted locally and published summaries remain anonymized. Verify effort provenance and comparable exercise/gym/loading context. Sparse sessions, missing first effort and grid-edge estimates are limitations, not reasons to substitute a fitted reference or claim a measured accuracy. Reuse the frozen weekly plateau/RIR progression and stable/smooth controls with all completed prefixes and insufficient-reference checks.

Analytical evidence, human design approval and UI acceptance remain distinct gates. These experiments change no product fact or production inference feature.
