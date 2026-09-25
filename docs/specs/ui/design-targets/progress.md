# Accepted target — Progress (brief + data-viz palette)

Target record per `../ai-design-policy.md`, for DLM-T08 of the design-language
migration (DLM-T09 and DLM-T10 extend it). Chosen by the user on 2026-09-24
(plan decision G1 (c)): a brief for the tables and controls, plus a data-viz
palette picked from on-device renders. **Palette accepted** by the user on
2026-09-25 (`B2`). **Accepted** by the user in the DLM-T08 screen gallery on
2026-09-25.

## Target

- Vocabulary: `../design-language.md` (the `viz` roles are §2 "Data
  visualisation") and the app frame (`app-frame.md`).
- This brief, plus the gallery states below. No artboards.

## Palette (iteration 0)

Three candidate ramps were rendered on device on shaded family and muscle rows
at shades 0–4, the real weekly and daily heatmaps (recoloured in a throwaway
branch), and the today and selected marks on every step: **A** a muted teal
(G2 a), **B** a warm monochrome (G2 b), **C** a warm green (G2 c). The user
chose B and asked for warmer takes on it towards bronze; of B1 (warmer), **B2
(bronze taupe)** and B3 (bronze), **B2 was accepted**: `viz0` `#F0ECE7`,
`viz1` `#E7D7CA`, `viz2` `#D3BDAB`, `viz3` `#BCA18A`, `viz4` `#A4866B`. The
rule that comes with it: text on a `viz` ground is `ink`.

## Brief

- One `ScreenScroll` on `paper`: `Time range` and `Breakdown` micro-labels
  (rendered uppercase), each over a `SegmentedControl` (T08-D1); then two
  summary `Card`s with stacked `Stat`s, Sessions a link `Card` with a
  `chevron-right`; then a `SearchField`.
- Deltas are Plex Mono `ink-muted` with their sign; `new` is `ink` (G3,
  T08-D4). Figures are full integers in Plex Mono, never `2.5k` (T08-D2).
- The exercise table is a `Card`: a header row of micro-labels (the active sort
  in `ink` with an `arrow-up` / `arrow-down`, `Recent` for the Exercise sort,
  no wash; inactive indicators keep their width, transparent), then
  `ListRow density="list"` rows with the name wrapping and the figures in
  right-aligned Plex Mono columns.
- Each muscle family is a `Card`: the family row, then its nested muscles
  indented one step, each a `ListRow` with two stacked `Stat`s (`Sets`,
  `Volume`) and their deltas. A row with near-failure sets takes one uniform
  failure shade, `viz1`–`viz4`, the same ramp for families and muscles
  (T08-D3); on it every text is `ink`.
- Loading, error and empty states are `StatePanel`s inside a `Card`; the copy
  is unchanged.
- The history overlays and heatmaps are unchanged here (DLM-T09).

## States

Device: iPhone simulator at 390pt width, light.

| Screenshot (lane) | State |
| --- | --- |
| `00-stats-empty-state` (`ios-ui-regression`) | no history: the empty table |
| `01-exercise-view-default` (`ios-ui-regression`) | By Exercise, 7 days, sorted by Sets |
| `01a-exercise-table-working-sets`, `01b-exercise-table-most-recent`, `01c-exercise-table-volume-ascending` (`ios-ui-regression`) | the sort header states |
| `02-exercise-view-30-days` (`ios-ui-regression`) | 30 days |
| `03-muscle-breakdown-7-days` (`ios-ui-regression`) | By Muscle: the family cards and failure shades |
| `04-back-to-exercise-view` (`ios-ui-regression`) | back to By Exercise |
| `03-m26-progress` (`ios-smoke`) | Progress from the tab bar, no data |
| `05-data-runtime-smoke-exercise-list` (`ios-data-smoke`) | a workout just logged through the session screens |

Jest only (no flow reaches them): the loading and error states, a filtered
list with no match, and the shade and delta colours
(`app/__tests__/stats-screen.test.tsx`).

No target screenshots are committed; runtime captures stay in the gitignored
`apps/mobile/artifacts/maestro/` tree and are linked as PR evidence.
