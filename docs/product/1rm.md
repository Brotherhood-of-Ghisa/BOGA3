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

The exercise RM curve chart starts with confirmed personal working sets
([[set.performed]], [[set.eligibility]]) recorded as RIR 0. Other RIR cohorts,
ranges or all current working sets require explicit filter selection; sparse
data never widens the cohort automatically. Missing/Unspecified and unknown
effort stay distinct and never imply RIR 0; neither supplies the reference.
Canonical historical RIR keeps its recorded numerical value. Observed points
retain all valid rep counts. Reference and observation cohorts match exercise
definition, effort and gym; missing gym is separate. Existing global set,
record and loading rules remain unchanged.

Why: compare recorded effort without inventing effort or pooling different gyms.
Approved 2026-10-13 as the first analytical deliverable; empirical reliability
remains to be tested.
Pending: the chart and its filters are not implemented.

### 1rm.curve-reference · calculation · accepted

The initial reference is fixed before the selected evaluation range starts.
Its prior interval starts at History look-back's calendar start computed at
that instant and ends strictly before it. Take the six most recent qualifying
completed sessions in that interval. Each supplies its maximum finite positive
total estimated RM from 1–10 reps; their median is the reference. Fewer than six
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
factor: one for total-load entry, two for per-side entry. Its reference is total
estimated RM divided by that same factor. Ordinary points coincide with entered
Weight; when bodyweight contributes, the chart coordinate includes its applicable
dated contribution. This is a chart-only exception to hiding calculated load:
the axis must distinguish its coordinate from Weight. Point details keep raw
Weight and the existing displayed 1RM. Logging, records, reading selection and
personal missing-reading fallback retain their existing meaning.

Why: one curve can represent observations with different dated bodyweight contexts.
Approved 2026-10-13 as the first analytical deliverable; visual design approval
is still required.
Pending: the chart coordinate, labels and page are not implemented.
