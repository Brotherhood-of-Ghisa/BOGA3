---
task_id: DLM-T09-Progress_history_overlays_and_heatmaps
milestone_id: "none (plan: docs/plans/design-language-migration.md)"
status: planned
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/{ux-rules,screen-map,components-catalog}.md, apps/mobile/components/heatmaps/README.md, docs/specs/ui/design-targets/progress.md"
---

# DLM-T09 Progress: the history overlays and the heatmaps

- Status: `planned`, **approved 2026-09-24** (decisions as recommended).
- Depends on: T08, which owns the `viz` roles.
- Design target: extends `design-targets/progress.md`.
- Files:
  - `app/(tabs)/stats-history.tsx`: the overlays at SH:959-1272 and
    1473-1612, their styles at 2119-2136 and 2231-2334, about 700 lines;
  - `components/heatmaps/{DailyHeatmap,WeeklyHeatmap}.tsx`, `heatmap-metric.ts`
    and `README.md`.

## Today → becomes

| Today (line) | Becomes |
| --- | --- |
| `MuscleHistoryOverlay` and `ExerciseHistoryOverlay`, about 95% duplicate code (SH:1131-1272, 1473-1612). Each is an **in-route absolute `View`** with a scrim, a card at 75% height anchored to the bottom, radius `md`, and a 32×32 bordered "x" close (`stats-*-history-close`) | **One `HistorySheet`**, moved to `components/stats/` (T09-D2), presented as a `Sheet` with a scroll body at about 75% (T09-D1). It has no close button; the backdrop dismisses it. Its title and eyebrow ("Muscle History" / "Muscle Group History" / "Exercise History") are kept |
| Metric chips (compact pills: Volume / W/sets / 1RM / Top weight) and view chips (Weekly / Daily) | Two `SegmentedControl`s under micro-labels. The prefixes keep `stats-*-history-metric-chip-*` / `-view-chip-*` |
| `WeekSelectionBanner`: a date range, plus "Volume: 1.1k" in `actionPrimary` or the placeholder | A `rule-soft` band: the range in Source Sans `ink-muted` and the value in Plex Mono `ink`. The number format follows T08-D2. testIDs are kept |
| State panels on `surfaceInfo` ("Loading … history...", "Could not load …", "No history yet") | `StatePanel` (inline). Copy is kept; the heatmap still renders under the empty panel |
| **Daily heatmap**: green `HEAT_RAMP`, neutral `#edf2f6` with a `#cfdae5` border, **today = `actionPrimary` border, selected = `heatmapSelectedBorder`, both `#0f5cc0` at 1.6px** (DH:160-167); M/W/F gutter; month axis; a detail card with swatch and "Volume: 1.2k" / "Rest day"; legend Less…More | Cells on `viz0`…`viz4` (T08). **Today: a 1px `ink` ring. Selected: a 2px `ink` border with the selected accessibility state** (T09-D3), so they differ. Gutter and axis labels are Archivo micro-labels in `ink-faint`. The detail card uses the `Card` recipe with a Plex Mono value. The legend uses the `viz` steps |
| **Weekly bars**: bucket colour, opacity 0.92 when unselected, a dashed "12-wk avg" in `textMuted`, a caret in accent (current) or `textSecondary` (selected) | Bars on `viz` steps. The average line is `ink-faint` dashed. The current week gets an `ink` ring caret, the selected week a filled `ink` `caret-down` |
| Stale docs: `ux-rules` §11.1 ("Mon Tue…" labels; the grid shows M/W/F), §11.2 ("latest first, 8 rows"; actually 13 columns, today at the right), §11.5 (light-blue today; unused), §12.2 (multi-muscle headers are not actionable; they are), §12.5-6 (a day detail that does not exist); README :35 ("max-of-window"; it is min–max), :53-54, :59 | Rewritten to match the code (T09-D4) |

## Decisions

| # | Question | Recommendation |
| --- | --- | --- |
| **T09-D1** | The overlay's presentation: (a) the design-language `Sheet` (a `Modal`: it covers the tab tray, takes modal accessibility scope, has no close X, and the backdrop dismisses); (b) keep the in-route panel, restyled, with an `IconButton` `x` | **(a)**, per G5. One overlay recipe app-wide. Maestro's `stats-*-history-close` taps (`stats-screen-ux`) become a backdrop tap by point, and jest presses `<testID>-backdrop` |
| T09-D2 | Merge the two overlays into one component while restyling them | **Yes.** It is a no-behaviour refactor that removes about 140 duplicate lines and keeps this card small. The testIDs stay parameterised (`stats-muscle-…` / `stats-exercise-…`) |
| T09-D3 | Today vs selected: identical today (a bug) | Today = a 1px `ink` ring; selected = a 2px `ink` border + a11y `selected`; the detail card's "Today" kicker stays |
| T09-D4 | Fix the stale heatmap docs here, or leave them for T15? | **Here.** This card changes those surfaces, so its docs must describe them (`ux-rules` §15) |
| T09-D5 | Three date formats across these views (`YYYY-MM-DD HH:mm`, `5 May 2026 – 11 May 2026`, `May 13, 2026`) | **Out of scope** (copy, not style). Noted for a follow-up |

## UX contract

- **Open history.** Trigger: an exercise row or a muscle family or row (T08).
  Success: the sheet rises with the weekly view and default metric. Edge:
  loading, error and empty panels show in place; the empty panel still shows
  the heatmap.
- **Switch metric or view.** Trigger: a segment. Success: the chart re-renders
  without rebuilding (both views stay mounted; the inactive one is transparent
  and hidden from a11y).
- **Select a day or week.** Trigger: a cell or bar tap. Success: the 2px `ink`
  border and the banner or detail values. Edge: a rest day reads "Rest day".
- **Dismiss.** Trigger: the backdrop, Android back or VoiceOver escape.
  Success: back on Stats with the table state intact.

## Gallery

`stats-screen-ux`: `05-exercise-heatmap-daily`, `05b-exercise-heatmap-weekly`,
`05c-exercise-heatmap-1rm`, `06-muscle-heatmap-weekly`,
`06b-muscle-heatmap-daily`, and `07-overlay-dismissed`, which now dismisses by
a backdrop point. **New:** `heatmap-today-and-selected` (tap a day other than
today in daily view and capture, asserting the selected cell's
`accessibilityState`).

## Tests

- `stats-screen.test.tsx`:
  - :886-890 (the panel's position and opacity) are kept;
  - :873, :935, :939, :952, :979, :981, :992 (copy and formats) follow
    T08-D2;
  - the overlay close-button presses become backdrop presses.
- `heatmap-data.test.ts`: unchanged (buckets, not colours).
- **Add** a heatmap test: a selected cell renders a different border from
  today's.

## Docs

- `ux-rules.md` §11, §12 and §13 (the sheet presentation, today and selected,
  the corrected layout facts).
- `components/heatmaps/README.md`.
- `components-catalog.md` specialized 10 (`DailyHeatmap` / `WeeklyHeatmap`) and
  the new `HistorySheet`.

## Gates

`./boga test fast` + `./boga test frontend`.

## Acceptance

1. `stats-history.tsx` and `components/heatmaps/**` hold no legacy identifier.
2. Today and selected are visibly and accessibly distinct.
3. Gallery accepted. The stale docs are corrected.
4. Estimate: about 1,200 lines.
