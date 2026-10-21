# 1RM

### 1rm.formula · calculation · accepted

The estimated one-rep max of a set is Wathan's formula, shown to one decimal:

```text
1RM = 100 × load / (48.8 + 53.8 × e^(−0.075 × reps))
```

A single (reps = 1) is not estimated: its 1RM is its load. A zero load gives
`0.0`, a valid figure that is never a record. `load` is the calculated load
when bodyweight contributes (`docs/specs/tech/bodyweight-load-contract.md`).

<!-- fact-table: 1rm.formula -->

| Load kg | Reps | 1RM shown |
| --- | --- | --- |
| 100 | 1 | 100.0 |
| 100 | 5 | 116.6 |
| 100 | 10 | 134.7 |
| 60 | 12 | 84.9 |
| 0 | 8 | 0.0 |

Why: a single is a measured max; estimating above it would invent strength.
Code: `estimateOneRepMax` in `apps/mobile/src/exercise-calculations/index.ts`; `formatOneRepMax` in `apps/mobile/src/exercise-calculations/format.ts`.
Signature: `48.8`, `53.8`, `0.075`

### 1rm.curve-population · definition · accepted

Include confirmed personal working sets ([[set.performed]], [[set.eligibility]])
with known canonical RIR; preserve numeric high RIR. Effort filters may narrow
this population; sparse data never widens it. Missing/Unspecified and unknown
labels remain distinct; neither supplies a normalized point or fit.
Plot and fit within the selected exercise/time/effort/gym scope. All gyms pools
including No gym; individual gyms remain selectable. Programme Technique/reset
recorded as RIR4 remains working, not a Technique/warm-up label.

Why: compare efforts; reliability unproven. Approved 2026-10-13.
Code: `RmCurveContent` in `apps/mobile/components/rm-curve/content.tsx`.

### 1rm.curve-effort · calculation · accepted

For RM analysis only, performed m reps at logged RIR n imply u=m+n RIR0-equivalent
reps, a positive safe integer. Resolve load L and existing metrics with actual m;
analytical total RM is `estimateOneRepMax(L, u)`. Never replace logged reps,
global 1RM or records. X names RIR0-equivalent reps; details retain m, n and
existing 1RM. A positive-RIR single uses u>1 analytically; its global figure stays unchanged.

Why: effort normalization; test uncertainty. Approved 2026-10-13.
Code: `projectRmCurveSet` in `apps/mobile/src/exercise-calculations/rm-curve.ts`.

### 1rm.curve-reference · calculation · superseded-by: 1rm.curve-fitting

Replaced by [[1rm.curve-fitting]] with owner approval on 2026-10-15.

### 1rm.curve-fitting · calculation · accepted

Replace Reference with One curve / Two curves and Parsimonious / Rich; default
One curve + Parsimonious. One fits constant total 1RM; Two fits two free positive
total 1RMs and a complete-session boundary against constant/linear/quadratic
no-break alternatives. Only 1RM changes amplitude; no minimum increment.

Fit each completed session’s highest unrounded displayed 1RM
([[1rm.formula]], logged reps) among qualifying sets after exercise/time/gym/RIR
filters. Ties keep the first in session order (block, set, then set ID).
Omit sessions without qualifying sets. Plot all qualifying sets.
Unavailable fits retain observations without historical fallback. Keep logged metrics.

Why: approved 2026-10-15; filtered maximum approved 2026-10-17; activation separate.
Code: `apps/mobile/src/strength-regimes/`.

### 1rm.curve-uncertainty · calculation · accepted

Parsimonious fixes uncertainty; Rich jointly estimates shared uncertainty across
periods. Logged RIR0 is exact; positive n permits actual n−1/n/n+1, symmetric
extremes, initial central probability 0.50. Fixed total-load SD: 2.50 kg (1.25 kg
per-side entry). Shading conveys relative evidence, never break/membership
probability. Unverified real histories remain exploratory, without calibrated
shading or confidence claims.

Why: owner approved 2026-10-15.
Code: `apps/mobile/src/strength-regimes/assessment.ts`.

### 1rm.curve-periods · presentation · accepted

Before/From dates, distinct markers and matching point/curve hues identify
complete-session periods. Selected details use the current fitted period's
label/hue; invalidated fits remove it. Selection follows chart activation and
Previous/Next, persists while valid, and never automatically chooses a
representative. No set-list popup.

Why: approved 2026-10-15; set-list removal approved 2026-10-17.
Code: `apps/mobile/components/rm-curve/`.

### 1rm.curve-load · presentation · accepted

Chart load is calculated load divided by entry factor (total:1, per-side:2);
analytical total 1RM uses the same factor. Ordinary points equal Weight;
bodyweight points include the applicable dated contribution. This chart-only
exception to hiding calculated load requires an axis distinct from Weight.
Details retain raw Weight/existing 1RM. Logging, records, reading selection and
personal missing-reading fallback retain their meaning.

Why: shared curve across bodyweight contexts. Approved 2026-10-13; design 2026-10-14.
Code: `projectRmCurveSet` in `apps/mobile/src/exercise-calculations/rm-curve.ts`.

### 1rm.curve-scope · definition · accepted

Each fresh chart defaults to Settings' configured History look-back through
today, All gyms (including No gym) and All known RIR. Manual choices last for
that mounted chart; opening another exercise resets the defaults. Offer
4/12/24 weeks and configured History look-back, clamped to bounds.
Effort follows [[1rm.curve-population]]; range/gym/effort changes coherently
recompute points and [[1rm.curve-fitting]].
All gyms preserves provenance; pooling establishes neither equipment equivalence
nor reliable strength changes.

Why: owner approved scope/design defaults 2026-10-14; broader initial scope approved 2026-10-21.
Code: `apps/mobile/components/rm-curve/screen.tsx`; `rmCurveWindow` and `buildRmCurveModel` in `apps/mobile/src/rm-curve/model.ts`.
