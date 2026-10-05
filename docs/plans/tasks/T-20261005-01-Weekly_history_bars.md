# T-20261005-01 — Weekly history as a vertical bar list

- Status: `planned`
- Depends on: none
- Milestone: none
- Areas: frontend; UI impact: yes

## Objective

Replace the horizontally scrolling weekly heatmap in Progress history with
horizontal bars stacked vertically, newest week first. Make dates and values
readable together while retaining week selection, the average reference and
the existing history-sheet dismissal.

## Scope

- In: the shared weekly chart for exercise and individual-muscle history,
  its sheet integration, Jest coverage, authoritative UI docs and runtime
  screenshot comparison.
- Out: Daily redesign, Settings changes, new session drilldowns, new
  dismissal gestures/buttons, metric calculations, database/sync changes,
  new chart dependencies or speculative Maestro flows.

## Decided

- Accepted target: [Weekly history bars](../../specs/ui/design-targets/weekly-history-bars.md),
  selected by the operator on 2026-10-05: Product Design option 3, with
  Daily/Weekly remaining in Settings and all tap-instruction text removed.
- One horizontal bar per Monday-start week, newest at the top; older history
  is reached by vertical scrolling within the existing sheet.
- Dates occupy a left gutter; proportional bars share a zero origin;
  formatted values occupy a right-aligned column. The average is a dashed
  vertical reference on the same scale, with readable axis/units.
- Retain the current aggregation, availability, target-based muscle colour,
  formatting and average eligibility rules. Zero-based bar length deliberately
  replaces the old observed-range height scale; colour keeps its existing
  independent meaning. No statistical rule changes.
- A row tap selects the week and updates the existing full-date-range/value
  banner in this sheet; a second tap clears it. Show no instruction or empty
  banner when unselected. There is no navigation to another detail screen.
- Current and selected weeks remain distinct: current label/1px ink outline,
  selected 2px ink outline/caret and accessible selected state. If both apply,
  retain the current label with the selected treatment.
- The dimmed parent backdrop dismisses the sheet; Android back and VoiceOver
  escape retain their existing behavior. The parent retains its browsing state.
- Preserve Settings-owned view/look-back and the read-only window caption
  already on main. Do not add an in-sheet Daily/Weekly selector.

## Open — resolve at session start

No product decisions remain open. Check the target against latest `origin/main`,
report any material conflicts, and agree the implementation lane set with the
operator before running lanes beyond `fast`.

## Deliverables and acceptance

1. Integrate the accepted layout into `WeeklyHeatmap` and `HistorySheet`,
   using existing React Native/UI primitives and tokens. Preserve the adapter's
   chronological data order; reverse only the display order so the recent
   12-week average still uses the most recent observations.
2. Show every week in the saved look-back, including rest, known-zero training
   and unavailable/incomplete metrics, with distinct copy/accessibility.
   Unknown values never become numeric zero or full bars. All-zero/empty
   windows produce finite layout and no misleading average.
3. Size the date/plot/value columns for small and large phones and long metric
   values. Provide at least 44pt row targets; no horizontal overflow, nested
   competing vertical scrollers or inaccessible hidden Daily view. Check the
   maximum supported 520-week look-back for usable scrolling and rendering.
4. Add/update meaningful Jest coverage for descending week order, proportional
   lengths/average placement, selection/clear, no helper text/view toggle,
   current-vs-selected marks, Settings look-back, empty/error/unavailable states
   and parent-state preservation. Read the tests directory's `README.md` first.
5. Capture the integrated selected state at the target viewport and compare
   directly with the accepted screenshot. Also inspect unselected/current,
   rest/unavailable, empty/error and small/large-phone states. Link evidence and
   intentional deviations in the implementation PR.
6. Update owning docs, pass the agreed gates and review the finished diff.
   Delete this task card in the implementation PR; keep the accepted target.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Open weekly history | Open an exercise/muscle history with Weekly saved in Settings | Newest week first; dates, values, metric selector and saved window visible | Loading, error/retry and no-history remain inline; Daily preference still renders Daily |
| Browse older weeks | Scroll down within the history sheet | Older weeks are reachable across the saved look-back | Small phone, long values, 520 weeks and rest weeks remain usable |
| Select/clear | Tap a week; tap it again | Mark and date/value banner update, then clear; stay in the same sheet | Current/selected differ; unavailable details report coverage; no instructional copy |
| Compare values | Read bars and average | One shared zero-based scale; average uses existing eligibility | Zero, equal values, insufficient observations and unknown values remain honest |
| Return to parent | Tap the dimmed backdrop, Android back or VoiceOver escape | Sheet closes; parent browsing state remains intact | No new route, close button or assumed drag-to-dismiss behavior |

## Specs to update

- `docs/specs/ui/ux-rules.md` — weekly layout, zero-based lengths, selection
  without helper text; preserve current Settings and metric semantics.
- `docs/specs/ui/screen-map.md` — vertical weekly history and selection state.
- `docs/specs/ui/components-catalog.md` and
  `apps/mobile/components/heatmaps/README.md` — shared weekly component layout/API
  as needed; remove outdated horizontal/height descriptions.
- `docs/specs/ui/design-targets/weekly-history-bars.md` — implementation status,
  comparison evidence and any operator-agreed deviations.

## Gates

`./boga test for` on the expected component paths currently defaults to
`./boga test fast` + `./boga test frontend-ui`. Re-run for the finished diff and
propose the smallest relevant device set to the operator; this card does not
pre-authorize a slower lane or a new Maestro scenario. Jest proves aggregation,
ordering and interactions; runtime captures prove layout/scrolling fidelity.
Run `jest-coverage`, `complexity` and `dependencies` once before the
implementation PR, as required by AGENTS.md. No native dev-client rebuild is
expected for this React Native-only change.
