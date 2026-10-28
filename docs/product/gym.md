# Gym

### gym.split · definition · accepted

An exercise set to `Track each gym separately` (exercise editor) keeps its
whole-exercise figures and adds one set per gym. A session counts in its
current gym; a session with no gym counts only in the whole exercise.

| Figure | Split exercise |
| --- | --- |
| A session's records and PRs: recorder, completion, share image, Today | its gym's; no gym: the whole exercise's |
| Repeat last and plan prefill | newest session at the same gym, else the whole exercise's newest |
| Progress tables, history, catalog stats, exercise heatmaps | the whole exercise; with a gym chosen, that gym's sessions and PRs |
| Session/period totals; muscle 3D; groups | the whole exercise |
| Share image name | plain, never a gym |
| Coaching | the whole exercise by default, or one named gym |

The setting is synced and retroactive: changing it recomputes history and PRs.

Why: equipment differs between gyms, yet the whole exercise stays the default so
a split never multiplies rows.
Code: `OptionsSection` in `apps/mobile/components/exercise-catalog/exercise-editor-screen.tsx`.

### gym.view-filter · definition · accepted

Both Progress tables, exercise and muscle history, catalog stats and the exercise
heatmap offer a gym picker, split or not, opening on all gyms. A chosen gym counts
only its sessions; no gym is a separate choice. History links carry that scope.
From the exercise page, history opens on the session's gym, if any, when
the exercise is split or `Current gym only` is on. Muscle 3D remains all gyms.

Why: gym scope answers where the effort happened; splitting only changes which
PRs show ([[gym.split]]).
Code: `GymPicker` in `apps/mobile/components/gyms/gym-picker.tsx`;
`exerciseHistoryOpeningGym` in `apps/mobile/src/session-recorder/exercise-history-view.ts`.
