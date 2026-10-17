# Gym

### gym.split · definition · accepted

An exercise set to `Track each gym separately` (exercise editor) reports one
exercise per gym; sessions without a gym form a `No gym` bucket. A session
counts in its current gym's bucket.

| Figure | Split exercise |
| --- | --- |
| Records, PRs, comparisons, counts, `Last`, history, Progress rows, 1RM curve | per bucket |
| Repeat last and plan prefill | newest session in the same bucket |
| Session, muscle and period totals; groups | the whole exercise |
| Coaching | per bucket, with its gym |

The setting is synced and retroactive: changing it recomputes history and PRs.

Why: one exercise on different gyms' equipment is not comparable. Approved 2026-10-17.
Pending: not implemented ([#707](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/707)).

### gym.split-label · presentation · accepted

A split exercise's name carries its gym (`Bench Press · Home`,
`Bench Press · No gym`) only in lists mixing gyms: Progress, catalog,
exercise history, heatmaps. Screens already showing the gym keep it plain;
the share image never shows a gym; coaching returns it as a field.

Why: the gym is repeated only where it tells two rows apart. Approved 2026-10-17.
Pending: not implemented ([#707](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/707)).
