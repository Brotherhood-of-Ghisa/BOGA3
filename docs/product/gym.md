# Gym

### gym.split · definition · accepted

An exercise set to `Track each gym separately` (exercise editor) keeps its
whole-exercise figures and adds one set per gym. A session counts in its
current gym; a session with no gym counts only in the whole exercise.

| Figure | Split exercise |
| --- | --- |
| A session's records and PRs: recorder, completion, share image, Today | its gym's; no gym: the whole exercise's |
| Repeat last and plan prefill | newest session at the same gym; no gym: the whole exercise's newest |
| Progress, exercise history, catalog stats, heatmaps, 1RM curve | the whole exercise until a gym is chosen |
| Session, muscle and period totals; groups | the whole exercise |
| Coaching | the whole exercise by default, or one gym |

The setting is synced and retroactive: changing it recomputes history and PRs.

Why: one exercise on different gyms' equipment is not comparable, yet the whole
exercise stays the default so a split never multiplies rows. A session with no
gym is usually a gym not worth recording, so it is compared with everything.
Approved 2026-10-18.
Pending: not implemented ([#707](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/707)).

### gym.split-progress-prs · presentation · open

How a split exercise's gym PRs show in Progress. Wanted visible, probably
behind a setting; mock first. Showing gym PRs and whole-exercise PRs side by
side is parked.

### gym.split-label · presentation · accepted

A split exercise's name carries its gym (`Bench Press · Home`,
`Bench Press · No gym`) only in lists mixing gyms: Progress, catalog,
exercise history, heatmaps. Screens already showing the gym keep it plain;
the share image never shows a gym; coaching returns it as a field.

Why: the gym is repeated only where it tells two rows apart. Approved 2026-10-17.
Pending: not implemented ([#707](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/707)).
