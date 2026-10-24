# Gym

### gym.split · definition · accepted

An exercise set to `Track each gym separately` (exercise editor) keeps its
whole-exercise figures and adds one set per gym. A session counts in its
current gym; a session with no gym counts only in the whole exercise.

| Figure | Split exercise |
| --- | --- |
| A session's records and PRs: recorder, completion, share image, Today | its gym's; no gym: the whole exercise's |
| Repeat last and plan prefill | newest session at the same gym, else the whole exercise's newest |
| Progress tables, history, catalog stats, exercise heatmaps | the whole exercise until a gym is chosen |
| 1RM curve | [[1rm.curve-scope]] |
| Session/period totals; muscle 3D; groups | the whole exercise |
| Share image name | plain, never a gym |
| Coaching | the whole exercise by default, or one named gym |

The setting is synced and retroactive: changing it recomputes history and PRs.

Why: equipment differs between gyms, yet the whole exercise stays the default so
a split never multiplies rows.
Code: `GymSplitField` in `apps/mobile/components/exercise-catalog/exercise-editor-modal.tsx`.

### gym.split-choice · principle · accepted

A coach splits ([[gym.split]]) machine and station exercises; free weights
and bodyweight exercises stay whole.

- **Good:** `Leg Press` split; `Dumbbell Curl` whole.

Why: machines change between gyms; dumbbells do not.
Code: `EXERCISE_WRITE_RULES` in `services/boga-mcp/src/tools.ts`.

### gym.view-filter · definition · accepted

Both Progress tables, exercise and muscle history, catalog stats and the exercise
heatmap offer a gym picker, split or not, opening on all gyms. A chosen gym counts
only its sessions; no gym is a separate choice. History links carry that scope.
From the exercise page, history opens on the session's gym, if any, when
the exercise is split or `Current gym only` is on. Muscle 3D remains all gyms.

Why: gym scope answers where the effort happened; splitting only changes which
PRs show ([[gym.split-progress-prs]]).
Code: `GymPicker` in `apps/mobile/components/gyms/gym-picker.tsx`;
`exerciseHistoryOpeningGym` in `apps/mobile/src/session-recorder/exercise-history-view.ts`.

### gym.split-progress-prs · presentation · accepted

A split exercise's gym PRs show in Progress and exercise history when that gym
is chosen: a view with a gym chosen marks each session's own PRs — that gym's —
and a view of every gym marks the whole exercise's. No setting. Showing gym PRs and
whole-exercise PRs side by side is parked.

Why: choosing the gym asks "what are my PRs here", so no second switch.
Code: `computeSelectedExerciseHistoryEffort` in `apps/mobile/src/data/exercise-analytics.ts`;
`withBlockRecords` in `apps/mobile/src/data/exercise-history.ts`.

### gym.split-label · presentation · superseded-by: gym.split

Replaced by [[gym.split]] on 2026-10-18: no list mixes per-gym rows to label.
