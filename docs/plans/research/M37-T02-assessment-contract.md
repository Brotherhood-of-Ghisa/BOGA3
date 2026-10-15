# Strength-regime assessment contract — analytically approved

Status: product owner approved the analytical handoff on 2026-10-15: “The plan analytics is approved as you describe it to me.” Analytical choices are settled; updated UI design approval remains required before implementation. Read the [current paper](M36-T04-research-review.md) for the sole adopted model and matching evidence. This document defines the proposed handoff, not another paper.

## Identity and scope

Each assessment identifies the input snapshot, model/solver/calibration revision, exercise, gym, selected completed-session time range and canonical loading/bodyweight context. Hash the ordered sampled IDs, timestamps, reps, logged effort and calculated total loads plus relevant context; do not expose private identifiers or bodyweight context in public telemetry. Any input, filter, account, exercise or context change invalidates the result. Never reuse an older result under new controls or silently use the historical reference as a fitted strength.

Inference samples the prespecified first working ordinal per completed session, selected before inspecting effort/load residuals; missing first effort or unavailable calculated load omits that session without substitution. Preserve every qualifying point in the chart independently of the inferential sample. Canonical calculations provide total loads and candidate multipliers. Sampling is not evidence that sessions are independent; report dependence/confounding assumptions.

## Output and numerical states

The derived result contains:

- Status: insufficient / unresolved / estimable, plus calibration scope: matching / unsupported. No detected-break status.
- Snapshot/model/calibration identity and fixed/joint method. Fixed remains the default.
- Counts: input sessions, sampled sessions, omissions and complete-session support per candidate side.
- Best constant/linear/quadratic no-break fit and best one-step fit, their log likelihoods and all searched cuts.
- Older/newer total 1RM, freely fitted without a minimum strength increment, one shared p/tau and corresponding curve coordinates. Uninformed p stays unavailable; exact-zero observations retain load discrepancy.
- Boundary interval between adjacent observed session times. A profile region may contain disjoint candidate intervals; a chart can display their union/envelope only with clear gap wording. Do not label a single observed day as the exact break date.
- Raw D=max(0,2(ell_step−ell_best_no_break)), numerical diagnostics, scoped uncertainty, evidence-emphasis value and explanation of its calibration limits.

Insufficient means no admissible cut with eight sampled sessions per side. Eight is only a search constraint. Unresolved means any compared fit has nonconvergence, rank deficiency or a strength/tau search boundary. Keep raw diagnostics for research but abstain from calibrated assessment/emphasis. Physical p endpoints are allowed; they do not prove effort-reading accuracy. A near-zero continuous quadratic vertex is a strength boundary even when all sampled strengths are positive. Local optimizer convergence is not proof of a global maximum.

## Evidence and uncertainty

The calibration reference is the worst 95% upper order statistic over constant/linear/quadratic no-break histories, maximizing over every cut/model and the declared 16/24/32-session assessments. The nominal 5% convention is a repeated-search reference within that declared family, not a posterior probability, membership probability, visibility threshold or guarantee for arbitrary histories. Report measured evaluation rates and Monte Carlo error from the paper.

For an estimable assessment within that declared scope, approved normalized emphasis is D/(D+c), where c is the method's calibrated reference. It is zero at D=0, 0.5 at D=c and increases monotonically toward one. The renderer supplies a readable baseline style at zero; weak evidence never hides an otherwise estimable tentative candidate. Label both curves as fitted/tentative; retain the gradual-progress competitor so visually separated plateaus do not imply a break. No calibrated emphasis is supplied outside the calibration family. The approved analytical handoff permits explicitly uncalibrated exploratory fits; their presentation remains subject to UI design approval.

Latest-window strength/effect radii are calibrated on 32-session constant/+2/+5/+10 kg histories; cut-profile likelihood-drop references use the +2/+5/+10 steps. A no-break history has no true break date. Interval references account for finite calibration uncertainty using an exact binomial order-statistic tolerance bound: 95% content with simultaneous 95% calibration confidence across the22 component/family references for both methods, rank392/400. This is conditional on independent matching histories, not a guarantee for arbitrary users. Their evaluation coverage is unconditional on successful fitting; failures remain misses. Date regions are conditional on the step family and are not a joint region across strength, effect, date and nuisance parameters, nor proof that a step model is true. The strength radius covers both amplitudes together. Preserve nonfinite/unbounded references as unresolved, never substitute a finite interval. Do not transfer the earlier RSS benchmark or constant-strength grid intervals to this fitter.

Approved strength-precision gate for a calibrated display: finite strength bounds for both regimes with full width no more than 10% of the corresponding estimate, in addition to numerical and support checks. This practical tolerance is an approved owner decision, not something established by eight-per-side sampling or simulation coverage. No effect-size/significance threshold controls candidate visibility. If the scope lacks validated strength uncertainty, mark precision unavailable rather than assert enough information.

## Supported and unsupported use

The measured primary family is one first set per independent session, 32 chronological observations, constant or +2/+5/+10 kg steps around S100 kg, uniformly designed logged RIR0–4, reps2/4/6, symmetric conditional three-point error and total-load SD2.50 kg. Cut/model search and assessments at16/24/32 are included. This is an assumed reference family, never a claim that a real history's unknown mechanism has been verified. Other strengths, nuisance values, rep/RIR designs, missing/gapped/sparse histories and arbitrary weekly monitoring are sensitivities, not automatically supported calibration contexts. Joint estimation does not itself expand calibration scope.

The weekly16–32 sensitivity checks repeated looks using the declared reference; it does not calibrate every possible monitoring schedule. Dependence, asymmetric/wider RIR errors, false-zero labels, changing noise or accuracy and fatigue may invalidate calibration. Gaps only localize a boundary between observed sessions; a searched cut outside the admissible range remains a miss. Available private histories are insufficient and cannot establish independent sessions or the RIR distribution.

## Gates and next action

Human analytical approval has accepted the measured reliability limits, evidence mapping, practical strength-precision rule and handling of unsupported real-history fits. Update the design target with Reference / Strength regimes and Fixed / Joint controls, tentative/readable weak-evidence curves, uncertainty/unsupported states and stale-result handling. Human design approval precedes UI implementation and acceptance testing. Main remains untouched; experimental activation is a separate owner decision.
