# Exact-zero RIR Gaussian research revalidation

Status: research implementation and full simulations completed and independently reviewed on the experimental branch, 2026-10-15. The final documentation check is recorded with the evidence after this report is saved. This is research-only; no production chart, loading, reference, recorded metric, fixture input or structural-break detector changes.

## Reporting model and parameters

The owner adopted exact recorded RIR 0 and Gaussian error for uncertain readings. The chosen generative mechanism uses a two-way exact-zero category: latent r=0 always records n=0; for integer r>0, n=max(1,round(r+sigma*z)), z standard normal. The adopted assumption requires that recorded zero excludes positive latent RIR; the additional assumption that every true zero is reported zero is a modelling mechanism, not a measured property of historical effort. A missed-zero stress tests that extra choice; a false-zero stress violates the owner's exact-zero assumption explicitly.

For r>0 and sigma>0, P(n=1)=Phi((1.5-r)/sigma), and n>=2 uses the Gaussian probability between n−0.5 and n+0.5. Cross-zero probabilities are zero; at sigma=0 a reading equals latent RIR. These probabilities sum to one. Sigma is the pre-rounding SD of the positive-RIR error; censored observed errors near one are biased and not Gaussian. Recorded high RIR has no upper clamp. Model identifier: `exact-zero-positive-censored-gaussian.v1`.

The adopted unit-load kernel f is unchanged: predicted total load is S/f(m+r). Fixed fits estimate S at positive-RIR sigma1 rep and total-load tau2.50 kg; joint fits profile S/sigma/tau. Per-side entry SD1.25 kg converts once to2.50 kg total. Load/performance discrepancy remains at exact RIR0; no one-sided bound on S is added. The declared latent prior remains uniform integers0–4 in the primary synthetic experiment, not an empirical programme prior.

All-zero histories have a flat sigma likelihood and no sigma estimate or interval; S and tau remain fit from loads. Raw flat profiles are retained for audit. Positive observations do not by themselves guarantee identification; existing boundary/profile/dependence diagnostics remain.

## Validation design and evidence

The existing 400-repetition calibration/evaluation cells and 200-repetition stresses retain separate seed families, finite grids, no-fit accounting and independent-session primary selection. Added stresses examine all-zero/all-positive histories, zero-to-positive composition, false zeros and missed failure labels. The independent Gaussian amplitude regression benchmark is rerun, including complete cut/form/prefix calibration; mixed-RIR, zero-composition and false-zero stresses examine analytical RM rather than known latent strength. It remains an RSS diagnostic, not the unimplemented full segmented latent likelihood or a calibrated display score.

The completed T04 outputs stay intact in their original worktree. New JSON, logs and figures live under ignored `apps/mobile/artifacts/research/rm-curve-exact-zero/`. Historical replay uses only the previously authorized local snapshot; no new remote query or account is accessed. Private files remain restricted. The shared frozen wave/oracle is unchanged.

Full output contains 6,400 strength-calibration datasets, 9,800 strength evaluations and 14,400 amplitude-regression evaluations. Primary cells use400 repetitions; stresses200. Strength interval cutoffs were recomputed on separate calibration seeds, not reused. The original Gaussian amplitude benchmark's null search was also recomputed and exactly reproduces cutoff10.018403233720234 because that benchmark already used known RIR0 singles. This does not calibrate mixed-RIR latent-break inference.

## Strength recovery results

All cells below have24 independent synthetic sessions, true S100 kg and total-load SD2.50 kg. Fixed assumes positive-RIR sigma1; joint estimates it. S interval coverage is conditional on the declared simulation family and finite search grids; these are not real-history confidence guarantees.

| True positive-RIR sigma | Fixed S RMSE kg | Joint S RMSE kg | Fixed / joint S interval coverage |
| --- | ---: | ---: | ---: |
| 0 | 0.672 | 0.646 | 97.50% / 97.00% |
| 0.5 | 0.679 | 0.672 | 97.00% / 96.25% |
| 1 | 0.688 | 0.722 | 97.75% / 97.25% |
| 2 | 0.833 | 0.778 | 94.00% / 97.50% |

At matching sigma1, previous fixed/joint S RMSE0.755/0.771 kg becomes0.688/0.722 kg. This is a change under a different measurement assumption with paired seed families, not empirical evidence that the assumption is true or that every cell improves. Joint sigma RMSE0.391 reps and tau RMSE0.612 kg; marginal profile coverage95.5%/96.25%. Near95% with400 repetitions the Monte Carlo rate SE is about1.1 percentage points; each output retains its actual SE, width, disconnected/boundary flags and failures.

All-zero conditional histories return no sigma estimate/interval in200/200 replications; the raw profile is exactly flat. S RMSE0.660 kg in both approaches, with observed S coverage95.0%/95.5%; the mixed-population cutoff is not separately calibrated for this conditional design. All-positive histories remain a sensitivity, not a new prior estimate.

The zero-to-positive composition stress has S bias−0.668/−0.708 kg and S coverage87.5%/90.0%: a fixed latent-RIR prior does not learn a wave programme. Deliberately misreporting20% of positive latent readings as zero produces bias−1.658/−1.433 kg and coverage46.0%/81.5%. Relabelling every true-zero reading as one, which violates the chosen two-way generator but not zero-label specificity, produces bias+1.103/+0.983 kg and coverage72.0%/85.5%. These stresses justify retaining provenance and reporting the extra generative assumption explicitly; joint noise fitting does not resolve all misspecification.

## Break and historical replay results

The independent known-zero benchmark reproduces0.75% stable/linear and1.25% quadratic no-break flag rates at48 sessions. A+5 kg jump has11.75% detection at24 sessions and60.0% at48; serial errors still give16.5% false flags at24. New zero-to-positive composition and false-zero stresses give1/200 and0/200 flags, respectively, for their particular analytical-RM generators. A zero observed count proves no zero false-alarm probability, and these cases do not establish a calibrated latent-strength detector. Full suffix/cut/form searches and the declared12/16/24/48 prefixes remain accounted for only under the declared calibration family; unrestricted weekly monitoring remains open.

The authorized local Zercher Squat/Dumbbell Bench Press replay retains six cohorts with1–7 evaluated sessions and at most one known-effort prespecified first set per cohort. Each available first effort is positive, so this snapshot does not empirically validate exact-zero readings. One-point load maxima remain at the0.5 kg lower grid boundary and do not measure effort or load accuracy. No cohort supports the eight-per-side break search. All72 frozen programme prefixes, prior M100 and insufficient-five-prior outcomes reconcile with the unchanged oracle/hash.

## Numerical checks and gates

Seeded standalone method checks pass at sigma0/0.5/1/2; both development-only quick simulations and the read-only historical replay pass. An independent Python math.erfc oracle checks528 discrete-probability cells, including204 impossible cells and38 tiny/underflow cells retaining finite log scores. Maximum absolute log-probability difference is1.891e−9 on representable comparisons. Its first tsx eval attempt emitted no JSON; the saved artifact script ran successfully. No likelihood change was needed.

Agreed finished-code gates: fast PASS,286 suites/3,930 tests plus aggregate checks; jest-coverage PASS,86.56% branches/94.41% lines; complexity PASS; dependencies PASS,525 modules/2,637 edges with13 unchanged known violations. The final documentation check is recorded in `docs-check.log` after this report is saved. No production code, dependency or native behavior changed, so existing native chart evidence is retained without rerunning simulator lanes. Raw logs, full JSON, compact summary, input/output hash manifest and regenerated figures are under the separate artifact directory above.

## Review and limits

Initial independent Codex review confirms generator/likelihood coherence and requires explicit all-zero nonidentification, pre-rounding sigma semantics, load discrepancy retention and composition/dependence sensitivities. Independent Codex source/product and full-output/figure review is clean after correcting the phrase “zero specificity”. The reviewer verified raw synthetic results, counts and disjoint calibration/evaluation seeds, all-zero suppression, hashes, figures and gate logs without reading private rows or rerunning simulations. Agreed lanes remain fast, jest-coverage, complexity, dependencies and docs-check for this research/test-only revision. No UI/native/backend contract changes justify additional slow lanes.

Research calibration remains conditional on its generator, prior, finite grids and declared prefixes; it does not establish real-user effort accuracy, latent strength changes or unrestricted weekly monitoring. The approved future likelihood-evidence/curve-emphasis direction still requires direct segmented likelihood research and its own validation.
