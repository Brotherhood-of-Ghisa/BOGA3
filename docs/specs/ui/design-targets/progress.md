# Accepted target — Progress (brief + data-viz palette)

Target record per `../ai-design-policy.md`, for DLM-T08, DLM-T09 and DLM-T10
of the design-language migration. Chosen by the user on 2026-09-24
(plan decision G1 (c)): a brief for the tables and controls, plus a data-viz
palette picked from on-device renders. **Palette accepted** by the user on
2026-09-25 (`B2`). **Accepted** by the user in the DLM-T08 screen gallery on
2026-09-25; the history sheets and heatmaps **accepted** in the DLM-T09 gallery
on 2026-09-26.

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

### History sheets and heatmaps (DLM-T09)

- The two legacy overlays are one `HistorySheet` (`components/stats/`), a
  `Sheet` over about three quarters of the screen with no close button: the
  backdrop, Android back and the VoiceOver escape dismiss it (G5, T09-D1/D2).
- Eyebrow micro-label and the name in Archivo 800; `Metric` and `View`
  `SegmentedControl`s under micro-labels; in Weekly a `rule-soft` banner with
  the week's range in Source Sans `ink-muted` and the value in Plex Mono `ink`.
- Loading, error and no history are inline `StatePanel`s; the empty heatmap
  still shows under the no-history panel.
- Cells and bars are on `viz0`…`viz4`; an empty day is `viz0` with a `rule`
  hairline. **Today (the current week) is a 1px `ink` ring; the selected day or
  week a 2px `ink` border** with the selected state, and the selected week has a
  filled `ink` caret above it (T09-D3).
- Titles are Archivo 700; gutter, month axis, legend and the `12-wk avg` label
  are Archivo micro-labels (`ink-faint`; the average label `ink-muted` on
  `surface`, since it sits over bars). The average line is `ink-faint` dashes.
- The day detail is a `Card`: a `Today` / weekday kicker, the date, a `viz`
  swatch and `<metric>: <value>` in Plex Mono `ink`, or `Rest day`.

### Exercise history and Sessions (DLM-T10)

- Exercise history is one `ScreenScroll` over `MainTabs`: the period
  `SegmentedControl`, the tag `ChipGroup` on one sideways-scrolling line (a
  deleted tag a faint `<name> (deleted)` chip), a deleted exercise's `Notice`
  (`warning` glyph), then the cards.
- `All-time bests` is a `Card` of two `ListRow` links, `1RM` and `Top weight`:
  the figure in bold Plex Mono `record` (brass, T10-D2) over its date in Plex
  Mono `ink-muted`. `1RM`, never `Est. 1RM` (G7).
- Each session is View Session's `ExerciseSetsCard` as a link (T10-D1): the
  completion stamp in Plex Mono and `<n> sets`; the gym, `Tag`s and stacked
  `Stat`s (`1RM`, `Top set`, `Vol`, `W/sets`); then `SetSummaryRow`s
  (`type · weight × reps · 1RM · VOL`), warm-ups like working sets.
- Sessions is one `ScreenScroll`: `Active` and `History` micro-labels; the
  active session a `Card` with the `set-current` glyph and 44pt `check` and ⋮;
  completed sessions `ListRow`s in one `Card`, a deleted one faded with a
  `Deleted` `Tag`; `Show deleted` / `Hide deleted` a text button (`checked`).
- Row menus are `Sheet`s dismissed by the backdrop: completed `Edit` /
  `Append` / `Delete` (`danger`) or `Undelete`, titled with the start stamp;
  active `Delete`, which confirms in an `Alert` (T10-D4).
- Loading, error (`Retry` on Sessions, T10-D6) and empty states are
  `StatePanel`s in a `Card`, with `…` for the ellipsis.

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
| `05-exercise-heatmap-daily` (`ios-ui-regression`) | exercise history sheet, Daily, today selected |
| `05a-heatmap-today-and-selected` (`ios-ui-regression`) | Daily with yesterday selected: today's ring beside the selected border |
| `05b-exercise-heatmap-weekly`, `05c-exercise-heatmap-1rm` (`ios-ui-regression`) | Weekly, Volume then 1RM |
| `06-muscle-heatmap-weekly`, `06b-muscle-heatmap-daily` (`ios-ui-regression`) | a single muscle's history (Chest), Weekly then Daily |
| `06c-muscle-family-history` (`ios-ui-regression`) | a multi-muscle family's history (Legs, `Muscle Group History`) |
| `07-overlay-dismissed` (`ios-ui-regression`) | the sheet dismissed from its backdrop, back on By Muscle |
| `03-m26-progress` (`ios-smoke`) | Progress from the tab bar, no data |
| `05-data-runtime-smoke-exercise-list` (`ios-data-smoke`) | a workout just logged through the session screens |
| `exercise-history-default` (`ios-exercise-page`) | exercise history from the exercise page's `History`: last 30 days, the bests and one session card with a warm-up |
| `exercise-history-all-time` (`ios-exercise-page`) | All time: both fixture sessions |
| `04-data-runtime-smoke-success` (`ios-data-smoke`) | Sessions after a workout is logged: one completed row |
| `sessions-row-menu` (`ios-data-smoke`) | a completed row's ⋮ sheet: Edit / Append / Delete |
| `20-first-run-roundtrip-restored-from-remote` (`ios-sync-e2e`) | Sessions after a restore from the server |

Jest only (no flow reaches them): the loading and error states (the screen's
and the history sheets'), a filtered list with no match, the shade and delta
colours (`app/__tests__/stats-screen.test.tsx`), and the today and selected
marks on every cell kind (`app/__tests__/heatmap-marks.test.tsx`). For
DLM-T10: the bests in `record`, the tag chips, the deleted-exercise notice and
exercise history's states (`app/__tests__/exercise-history-screen.test.tsx`);
the active session, the `Deleted` tag, the discard confirm and the `Retry`
(`app/__tests__/sessions-screen.test.tsx`).

No target screenshots are committed; runtime captures stay in the gitignored
`apps/mobile/artifacts/maestro/` tree and are linked as PR evidence.
