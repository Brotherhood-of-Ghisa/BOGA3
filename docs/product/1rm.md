# 1RM

### 1rm.formula · calculation · accepted

The estimated one-rep max of a set is Wathan's formula, shown to one decimal:

```text
1RM = 100 × load / (48.8 + 53.8 × e^(−0.075 × reps))
```

A single (reps = 1) is not estimated: its 1RM is its load. A zero load gives
`0.0`, a valid figure that is never a record. `load` is the calculated load
when bodyweight contributes (`docs/specs/tech/bodyweight-load-contract.md`).

| Load kg | Reps | 1RM shown |
| --- | --- | --- |
| 100 | 1 | 100.0 |
| 100 | 5 | 116.6 |
| 100 | 10 | 134.7 |
| 60 | 12 | 84.9 |
| 0 | 8 | 0.0 |

Why: a single is a measured max; estimating above it would invent strength.
Code: `estimateOneRepMax` in `apps/mobile/src/exercise-calculations/index.ts`; `formatOneRepMax` in `apps/mobile/src/exercise-calculations/format.ts`.
