# Accepted target — Progress (brief + data-viz palette)

Target record per `../ai-design-policy.md`. Chosen by the user on 2026-09-24:
a brief for the tables and controls, plus a data-viz
palette picked from on-device renders. **Palette accepted** by the user on
2026-09-25 (`B2`). **Accepted** by the user in the screen gallery on
2026-09-25; the history sheets, heatmaps, exercise history and Sessions
**accepted** on 2026-09-26.

The landing portion is superseded by [Progress tables](progress-tables.md).
This record continues to own the palette and retained exercise browsing,
individual history sheets, exercise-history route and Sessions presentation.

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

- The landing's controls, muscle/contribution tables and quiet links follow
  [Progress tables](progress-tables.md). Its pinned By Exercise / By Muscle
  switch opens retained exercise search and sortable rows on `paper`.
- Deltas are Plex Mono `ink-muted` with their sign; `new` is `ink` (G3). Figures take the one display format (`tech/training-metrics-contract.md`
  §4) in Plex Mono, never `2.5k`.
- The exercise table is a `Card`: a header row of micro-labels (the active sort
  in `ink` with an `arrow-up` / `arrow-down`, `Recent` for the Exercise sort,
  no wash; inactive indicators keep their width, transparent), then
  `ListRow density="list"` rows with the name wrapping and the figures in
  right-aligned Plex Mono columns.
- Family headers are static, individual names open history, and a separate
  chevron selects contributions. A muscle with working sets takes a uniform
  target-attainment shade, `viz1`–`viz4`; on it every text is `ink`.
- Loading, error and empty states use inline `StatePanel`s; the table's Retry
  and metric-specific contribution emptiness follow the replacement brief.

### History sheets and heatmaps

- One `HistorySheet` (`components/stats/`) is a sub-page `PageSheet`
  ([History popup](history-popup.md), amended container): swipe down, X,
  Android back and VoiceOver escape. The older three-quarter
  container/backdrop prescription is superseded; charts retain the semantics
  below.
- Eyebrow micro-label and the name in Archivo 800; a `Metric`
  `SegmentedControl` under its micro-label and a static saved view/window label;
  Daily/Weekly is chosen only in Settings; in Weekly a `rule-soft` banner with
  the week's range in Source Sans `ink-muted` and the value in Plex Mono `ink`.
- Loading, error and no history are inline `StatePanel`s; the empty heatmap
  still shows under the no-history panel.
- Cells and bars are on `viz0`…`viz4`; an empty day is `viz0` with a `rule`
  hairline. **Today (the current week) is a 1px `ink` ring; the selected day or
  week a 2px `ink` border** with the selected state, and the selected week has a
  filled `ink` caret above it.
- Titles are Archivo 700; gutter, month axis, legend and the `12-wk avg` label
  are Archivo micro-labels (`ink-faint`; the average label `ink-muted` on
  `surface`, since it sits over bars). The average line is `ink-faint` dashes.
- The day detail is a `Card`: a `Today` / weekday kicker, the date, a `viz`
  swatch and `<metric>: <value>` in Plex Mono `ink`, or `Rest day`.

### Exercise history and Sessions

- Exercise history is one `ScreenScroll` over `MainTabs`: the period
  `SegmentedControl`, the tag `ChipGroup` on one sideways-scrolling line (a
  deleted tag a faint `<name> (deleted)` chip), a deleted exercise's `Notice`
  (`warning` glyph), then the cards.
- `All-time bests` is a `Card` of two `ListRow` links, `1RM` and `Top weight`:
  the figure in bold Plex Mono `record` (brass) over its date in Plex
  Mono `ink-muted`. `1RM`, never `Est. 1RM` (G7).
- Each session is View Session's `ExerciseSetsCard` as a link: the
  completion stamp in Plex Mono and `<n> sets` (working sets); the gym, `Tag`s
  and stacked `Stat`s (`1RM`, `Top set`, `Vol`, `Sets`); then `SetSummaryRow`s
  (`type · weight × reps · 1RM · VOL`), warm-ups like working sets.
- Sessions is one `ScreenScroll`: `Active` and `History` micro-labels; the
  active session a `Card` with the `set-current` glyph and 44pt `check` and ⋮;
  completed sessions `ListRow`s in one `Card`, a deleted one faded with a
  `Deleted` `Tag`; `Show deleted` / `Hide deleted` a text button (`checked`).
- Row menus are `Sheet`s dismissed by the backdrop: completed `Edit` /
  `Append` / `Delete` (`danger`) or `Undelete`, titled with the start stamp;
  active `Delete`, which confirms in an `Alert`.
- Loading, error (`Retry` on Sessions) and empty states are
  `StatePanel`s in a `Card`, with `…` for the ellipsis.

One shared weekly working-set target grades each muscle against quota × selected
weeks. The configured N-week window and This week start at
local Monday and run through now; the default is the configured window, with
no quota proration and no separate “So far” label. A one-week configuration has one range choice.
History uses the saved look-back in both views. Muscle Sets cells compare daily
or weekly counts against that same weekly target; other metric scaling stays unchanged.
Legends and accessibility labels explain target colouring.

Personal metrics use the operator's independent Working set and Volume effort
columns (2026-10-04; `tech/training-metrics-contract.md`). Volume-only exercise
rows remain visible with zero Sets and unavailable 1RM; heatmaps retain their
volume cells without creating working-set counts or strength values. Per-set
figures and recorded effort labels stay visible regardless of the two choices.

## States

Device: iPhone simulator at 390pt width, light.

| Screenshot (lane) | State |
| --- | --- |
| `01-exercise-view-default` (ad hoc) | retained By Exercise table, sorted by Sets |
| `01a-exercise-table-working-sets`, `01b-exercise-table-most-recent`, `01c-exercise-table-volume-ascending` (ad hoc) | the sort header states |
| `04-back-to-exercise-view` (ad hoc) | back to By Exercise |
| `05-exercise-heatmap-daily` (ad hoc) | exercise history sheet, Daily, today selected |
| `05a-heatmap-today-and-selected` (ad hoc) | Daily with yesterday selected: today's ring beside the selected border |
| `05b-exercise-heatmap-weekly` (ad hoc) | exercise history sheet with a valid saved Weekly choice, Volume |
| `05c-exercise-heatmap-1rm` (ad hoc) | Weekly, 1RM |
| `06-muscle-heatmap-weekly`, `06b-muscle-heatmap-daily` (ad hoc) | a single muscle's history (Chest), Weekly then Daily |
| `07-overlay-dismissed` (ad hoc) | the sheet dismissed from its backdrop, back on By Muscle |
| `05-data-runtime-smoke-exercise-list` (`ios-data-smoke`) | a workout just logged through the session screens |
| `exercise-history-default` (`ios-exercise-page`) | exercise history from the exercise page's `History`: last 30 days, the bests and one session card with a warm-up |
| `exercise-history-all-time` (ad hoc) | All time: both fixture sessions |
| `04-data-runtime-smoke-success` (ad hoc) | Sessions after a workout is logged: one completed row |
| `sessions-row-menu` (ad hoc) | a completed row's ⋮ sheet: Edit / Append / Delete |
| `20-first-run-roundtrip-restored-from-remote` (ad hoc) | Sessions after a restore from the server |

`(ad hoc)` states are no longer captured by a lane: their flow keeps only
the claims that need a device (spec 06, "Maestro scope policy") and Jest
proves the rest. When the screen changes, capture them with a one-off flow
run (`apps/mobile/scripts/maestro-ios-run-flow.sh --flow …`); git history
holds the flow steps that reached them.

Absent from committed regression flows: the loading and error states (the
screen's and the history sheets'), a filtered list with no match, the shade and delta
colours (`__tests__/stats-screen.test.tsx`), and the today and selected
marks on every cell kind (`__tests__/heatmap-marks.test.tsx`);
the bests in `record`, the tag chips, the deleted-exercise notice and
exercise history's states (`__tests__/exercise-history-screen.test.tsx`);
the active session, the `Deleted` tag, the discard confirm and the `Retry`
(`__tests__/sessions-screen.test.tsx`).

Jest owns these assertions; ad hoc native captures in shipping PRs supplement
the layout evidence without adding regression flows.

No target screenshots are committed; runtime captures stay in the gitignored
`apps/mobile/artifacts/maestro/` tree and are linked as PR evidence.
