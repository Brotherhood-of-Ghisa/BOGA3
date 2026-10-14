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

The RM curve chart includes confirmed personal working sets
([[set.performed]], [[set.eligibility]]) with any canonical known RIR by default.
Effort filters may narrow this population; sparse data never widens it.
Missing/Unspecified and unknown labels remain distinct and supply neither an
RIR-normalized point nor the reference. Preserve canonical high RIR numerically.
Observation and reference cohorts match exercise definition, effort and gym;
missing gym is separate. A programme phase called Technique/reset recorded as
RIR 4 remains working under the existing policy; it does not become a Technique
or warm-up effort label.

Why: compare all recorded efforts under the revised analytical assumption.
Revised with product-owner authorization on 2026-10-13; empirical reliability
remains unproven.
Pending: the chart and filters are not implemented.

### 1rm.curve-effort · calculation · accepted

For RM curve analysis only, assume performed m reps at recorded RIR n equal
u = m + n reps at RIR 0. Require u to be a positive safe integer. Resolve load L
and existing metrics using actual m; analytical total RM is
`estimateOneRepMax(L, u)`. Never substitute u into logged sets, global 1RM or
records. X is explicitly RIR0-equivalent reps; details preserve m, n and the
existing displayed 1RM. A raw single with positive RIR uses u above one
analytically while its global single-rep figure remains unchanged.

Why: the product owner requested effort normalization on 2026-10-13 as a
modelling assumption, not empirical proof. RIR uncertainty must be tested.
Pending: analytical transformations and chart labels are not implemented.

### 1rm.curve-reference · calculation · accepted

The initial reference is fixed before the selected evaluation range starts.
Its prior interval starts at History look-back's calendar start computed at
that instant and ends strictly before it. Take the six most recent qualifying
completed sessions in that interval. Each supplies its maximum finite positive
analytical total RM from 1–10 RIR0-equivalent reps; their median is the reference. Fewer than six
sessions means observed points without a curve, with no automatic fallback.
Evaluated sessions, tied cutoff timestamps and later workouts cannot enter the
fit. Keep the reference fixed during evaluation; source edits, account policy
or filter changes recompute both populations together.

Why: a prior benchmark avoids self-reference while giving sessions equal weight.
Approved 2026-10-13 as an initial choice, not a statistically validated estimator
or reliability threshold.
Pending: reference transformations and the chart are not implemented.

### 1rm.curve-load · presentation · accepted

The RM curve chart plots calculated load divided by the exercise's entry
factor: one for total-load entry, two for per-side entry. Its reference is analytical total
RM divided by that same factor. Ordinary points coincide with entered
Weight; when bodyweight contributes, the chart coordinate includes its applicable
dated contribution. This is a chart-only exception to hiding calculated load:
the axis must distinguish its coordinate from Weight. Point details keep raw
Weight and the existing displayed 1RM. Logging, records, reading selection and
personal missing-reading fallback retain their existing meaning.

Why: one curve can represent observations with different dated bodyweight contexts.
Approved 2026-10-13 as the first analytical deliverable; visual design approved
2026-10-14. Implemented UI acceptance remains pending.
Pending: the chart coordinate, labels and page are not implemented.

### 1rm.curve-scope · definition · accepted

The first-release chart defaults to the latest 12 weeks ending today, bounded
by Settings' History look-back. Use the selected exercise's most recently
trained gym cohort, including Unspecified; stable gym ID resolves ties.
Range choices are 4, 12, 24 weeks or the configured History look-back, all
clamped to those bounds. Effort scope follows [[1rm.curve-population]].
Changing exercise selects its most recent gym. Applied range/gym/effort
changes recompute observations and [[1rm.curve-reference]] coherently.

Why: the product owner approved the chart design and scope defaults on
2026-10-14.
Pending: chart scope controls and transformations are not implemented.
