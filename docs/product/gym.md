# Gym

### gym.split · definition · accepted

An exercise set to `Track each gym separately` (exercise editor) keeps its
whole-exercise figures and adds one set per gym. A session counts in its
current gym; a session with no gym counts only in the whole exercise.

| Figure | Split exercise |
| --- | --- |
| A session's records and PRs: recorder, completion, share image, Today | its gym's; no gym: the whole exercise's |
| Repeat last and plan prefill | newest session at the same gym, else the whole exercise's newest |
| Progress, exercise history, catalog stats, heatmaps | the whole exercise until a gym is chosen |
| 1RM curve | [[1rm.curve-scope]] |
| Session, muscle and period totals; groups | the whole exercise |
| Share image name | plain, never a gym |
| Coaching | the whole exercise by default, or one named gym |

The setting is synced and retroactive: changing it recomputes history and PRs.

Why: one exercise on different gyms' equipment is not comparable, yet the whole
exercise stays the default so a split never multiplies rows. A session with no
gym is usually a gym not worth recording, so it is compared with everything.
Approved 2026-10-18; Repeat last's fallback and the 1RM curve row the same day.
Code: `GymSplitField` in `apps/mobile/components/exercise-catalog/exercise-editor-modal.tsx`.

### gym.split-choice · principle · accepted

Which exercises a coach tracks per gym ([[gym.split]]): an exercise on a
machine or station, which differs from gym to gym, is split; free weights
(dumbbells, barbells, kettlebells) and bodyweight exercises, the same
everywhere, stay whole.

- **Test:** would the same load feel different on another gym's equipment?
- **Good:** `Leg Press` split; `Dumbbell Curl` whole.

Why: machines change a lot between gyms; dumbbells are always the same.
Approved 2026-10-19.
Code: `EXERCISE_WRITE_RULES` in `services/boga-mcp/src/tools.ts`.

### gym.view-filter · definition · accepted

Progress's exercise table, exercise history, catalog stats and the exercise
heatmap offer a gym picker for every exercise, split or not, opening on all
gyms. A chosen gym counts only its sessions; no gym is a choice of its own.
Muscle totals have none.

Why: the 1RM curve already offered a gym for every exercise, so one behaviour
everywhere; being split only changes which PRs a chosen gym shows
([[gym.split-progress-prs]]). Approved 2026-10-18.
Code: `GymPicker` in `apps/mobile/components/gyms/gym-picker.tsx`.

### gym.split-progress-prs · presentation · accepted

A split exercise's gym PRs show in Progress when that gym is chosen: a view
with a gym chosen marks each session's own PRs — that gym's — and a view of
every gym marks the whole exercise's. No setting. Showing gym PRs and
whole-exercise PRs side by side is parked.

Why: choosing the gym is the question "what are my PRs here", so no second
switch is needed. Approved 2026-10-18 (mock option A).
Code: `computeSelectedExerciseHistoryEffort` in `apps/mobile/src/data/exercise-analytics.ts`.

### gym.split-label · presentation · superseded-by: gym.split

Replaced by [[gym.split]] with owner approval on 2026-10-18: views show the
whole exercise until a gym is chosen, so no list mixes per-gym rows to label.
Its share-image and coaching rules moved there; how a chosen gym is named is
left to the design.
