# Experimental strength regimes

> **Owns:** numerical fitting, snapshot lifecycle and calibration boundaries.
> **Load when:** changing the RM chart or its likelihood assessment.

Product choices are [[1rm.curve-fitting]], [[1rm.curve-population]],
[[1rm.curve-effort]], [[1rm.curve-load]] and [[1rm.curve-scope]].

## Numerical authority

`apps/mobile/src/strength-regimes/` owns the promoted likelihood, multipliers,
bounded multistart optimizer and constant/linear/quadratic/step fits. Research
helpers import these same operations; there is no parallel runtime estimator.
Mixture components use the adopted `estimateOneRepMax` kernel. Optimize the
conditional nonnegative-truncated Gaussian load mixture, retaining raw logged
values. Normalize time/amplitudes and check quadratic positivity continuously.
Shared joint load SD is searched within 0.5–7.5 kg; physical probability endpoints
are allowed. Nonconvergence, rank deficiency or strength/load search boundaries
prevent a displayed fit. A local optimum is not proof of a global maximum.

Search complete-session cuts with at least eight sampled sessions per side;
this is an admissibility constraint, not statistical sufficiency. Preserve
candidate profile, bracketing session times, shared nuisance values and
D=max(0,2(ell_step−ell_best_no_break)). Gradual competitors use identical
observations. Failed competitors invalidate the comparison, even when the
chosen step converged. The renderer uses the first newer session for its date
label, never claiming an exact physiological change time.

## Snapshot and execution

The current SQLite graph supplies actual plotted coordinates and the session
sample of [[1rm.curve-fitting]], retaining gym and dated bodyweight/loading
context. All gyms combines rows once within the other selected filters.

`useRmCurve` scopes reads to account revision, exercise, gym, dates, effort and
source revisions. `useRegimeAssessment` keys results by that immutable model
object and selected mode/method. Both modes yield inside simplex searches, with iteration batches shrinking as
sample size grows (roughly 1,024 point operations per iteration batch, multiplied
by the simplex's bounded evaluations per iteration). Cancelling closes the
iterator at the next chunk boundary. Interactive requests share a two-million
point-evaluation budget across all starts, competitors, refinement and cuts.
Exhaustion publishes no partial curve/profile/evidence: retain all points and
show `Choose a shorter range`. No history subsampling occurs. Research wrappers
drain identical operations synchronously with no default work budget.
Selection remains inspectable while fitting. A failed or insufficient fit
retains points; storage failures hide retained stale values and offer Retry.
No source write, server/schema change or workflow/navigation replacement occurs.

## Calibration boundary

Real-history error mechanisms and independence cannot be certified from their
observed coordinates. Runtime assessments therefore use the approved exploratory
path: no calibrated interval, evidence emphasis or adequacy claim. Raw likelihood
evidence is retained internally; curves stay readable at a uniform emphasis.
Observation halos use the current fit's nuisance values under
[[1rm.curve-uncertainty]]; their faded shape is a scale glyph, not a probability
contour. The marker footprint is padding. Hide Rich halos until a usable fit
is available; an unidentified RIR probability cannot size positive-RIR halos.
The simulated null references and uncertainty radii are conditional on their
validated designs; sample size or joint fitting alone cannot transfer them.
A future matching-context assessment must explicitly establish that scope before
applying its D/(D+c) mapping or the accepted precision gate. This limitation does
not suppress a numerically estimable tentative curve within the interactive budget.

Gym/equipment changes, missing effort, fatigue, serial dependence and changing
noise can mimic strength changes. Neither temporal colour assignment nor a
visually separated pair proves a structural break. Human analytical approval
covers these limits; implemented-UI acceptance and production activation remain
separate owner decisions.
