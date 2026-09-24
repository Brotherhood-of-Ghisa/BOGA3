---
task_id: DLM-T08-Progress_stats_body_and_data_viz_roles
milestone_id: "none (plan: docs/plans/design-language-migration.md)"
status: planned
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/{design-language,ux-rules,screen-map,components-catalog}.md, docs/specs/ui/design-targets/progress.md (new)"
---

# DLM-T08 Progress: summary, controls, tables, and the data-viz roles

- Status: `planned`, **approved 2026-09-24** (decisions as recommended).
- Depends on: T01, T02. T09 depends on this card.
- Design target (G1 (c)): a brief for tables and controls, plus a **data-viz
  palette gallery in iteration 0** (G2) → `design-targets/progress.md`.
- File: `app/(tabs)/stats-history.tsx`, the screen body. The agent's line map:
  shell JSX 361-668, failure palette and muscle list 670-957, exercise table
  1275-1471, `Metric` 1614-1644, and the main-screen style blocks
  1936-2118 / 2137-2230 / 2335-2373. That is about 1,300 lines. The overlays
  (959-1272, 1473-1612) and their styles are T09's.

## Iteration 0: the data-viz roles (G2)

Before any screen change, send a palette gallery. For **2–3 candidate ramps**
(the G2 (a) recommendation, a muted teal around 170–190°; plus the G2 (b) and
(c) alternatives), render on device, in a throwaway branch:

- the failure-intensity family and muscle rows at shades 0–4;
- the daily heatmap (T09's file, recoloured only for the gallery);
- the weekly bars;
- today and selected marks.

Each tile states its contrast numbers. The accepted ramp lands in this card as
`uiRoles` roles **`viz0` … `viz4`** (`viz0` = empty/rest) and
`design-language.md` §2 gains a "Data visualisation" table.
`ui-design-tokens.test.ts` then gates:

- the step order by luminance;
- adjacent-step ΔL (distinct steps);
- `ink` text on `viz4` ≥ 4.5:1, and `ink` hairline visibility on `viz1`;
- no `viz` step equal to `accent` or `record`.

## Today → becomes

| Today (line) | Becomes |
| --- | --- |
| `surfacePage` ground; "Time range" label + `SegmentedChips` pills (`stats-period-chip-{7,30}`); "Breakdown" + `SegmentedChips` joined (`stats-view-mode-chip-*`) (SH:504-523) | `ScreenScroll`. "Time range" / "Breakdown" become micro-labels, which render uppercase. Maestro asserts the literal text (`stats-screen-ux.yaml:68-69`), so those two asserts change to the rendered `TIME RANGE` / `BREAKDOWN`, as `.*W/SETS.*` already does. Both controls → `SegmentedControl` (T08-D1) with the same prefixes |
| Summary cards: Sessions (pressable → `/sessions`) value + signed delta; "Sets (W/Sets)" `N (W)` + delta pair (SH:527-559). **Deltas: + in `textSuccess`, − in `actionDangerText`, "new" in `actionPrimary`** (SH:347-359) | Two `Card`s with stacked `Stat`s; Sessions is a link `Card` (`chevron-right`). Deltas in Plex Mono **`ink-muted` with the sign**, "new" in `ink` (G3). The label keeps "W/Sets" and its uppercase style, because Maestro matches `.*W/SETS.*` (`stats-screen-ux.yaml:99`) |
| Filter input + round "x" clear | `SearchField` (placeholders "Filter by exercise..." / "Filter by muscle..." kept) |
| **Exercise table**: bordered card; sortable header cells (active: `actionPrimarySubtleBg` wash + blue arrow + "Recent"; inactive indicators at opacity 0, width 64); static "1RM" header; rows: name, `5 (2)`, `2.5k`, 1RM or `—` | A `Card`: a header row of micro-labels, the active sort in `ink` 700 with an `arrow-up`/`arrow-down` glyph and "Recent" in `ink-muted`, no wash. Rows → `ListRow density="list"` with figures in Plex Mono right-aligned columns. `stats-exercise-*` testIDs, `-sort-*-indicator(-down)` and the reserved indicator width (asserted :1339-1346) are kept |
| **Muscle families**: one card per family; header with name + Sets and Volume `Metric`s (label, value, delta); **failure-shade background**: family green `failureBackgroundFamily1-4`, muscle warm `failureBackgroundMuscle1-4` (SH:670-691, 846-909) | A `Card` per family with the header and nested rows as `ListRow`s, and `Metric` → stacked `Stat`s. The failure shade uses **`viz1`–`viz4` for both** families and muscles (T08-D3); shade 0 keeps `surface`. The count and the accessibility copy keep the meaning (`ux-rules` §12.13) |
| Number formats: `formatTotalWeight` → **`2.5k`, `120k`** (SH:338-345); `formatNumber` 1 decimal; `10 (4)` pairs; `−`, `±0`, `+17%` | See **T08-D2** |
| States: "Could not load stats" / "Loading stats…" (muscle mode only); empties | `StatePanel`; copy kept; still muscle-mode only (behaviour stays) |

## Decisions

| # | Question | Recommendation |
| --- | --- | --- |
| T08-D1 | Time range and Breakdown: `ux-rules` §13.1/§13.8 require the Breakdown toggle to look different from the Time range pills (joined vs pills, asserted `stats-screen.test.tsx:1263-1279`). Keep two looks, or both `SegmentedControl` in separately labelled rows? | **Both `SegmentedControl`**, each under its own micro-label. The labels do the separating the two shapes used to do. Rewrite §13.1/§13.8 and replace the geometry assertions with "each control is a `tablist` with its own label" |
| **T08-D2** | **`k` compaction** (`2.5k`) vs `design-language` §6 (real numbers, no suffix, mono). Measured: volume per exercise or muscle over 30 days reaches 6 digits (`123456`, ~43pt in Plex Mono 12, which fits the column) | **Drop `k`: full integers in Plex Mono.** "The numbers are the point." Tests :939, :981, :1290 change from `2.5k` to `2500`. The alternative (keep `k` as a magnitude, not a unit) is acceptable if you prefer density |
| T08-D3 | Failure-intensity rows: two palettes (green families, warm muscles) or one ramp? | **One ramp** (`viz1–4`). Nesting and indentation already tell family from muscle; the colour means only "how much" |
| T08-D4 | Delta colours (G3) | `ink-muted` with the sign; "new" `ink`. The accessibility labels already state the direction |

## UX contract

- **Change the period or breakdown.** Trigger: a segment. Success: the cards
  and table update; the query-string initial values still apply
  (`?period=7&breakdown=muscle`). Edge: invalid params fall back to the
  defaults.
- **Sort the exercise table.** Trigger: a header cell. Success: the arrow and
  "Recent" move; rows re-order. Edge: a cell with no values sorts last.
- **Filter.** Trigger: type. Success: rows narrow; clear restores. Edge: the
  no-match copy.
- **Open an exercise or muscle.** Trigger: a row or family header. Success:
  the history overlay opens (T09's).

## Gallery

- Iteration 0: the palette gallery (above), decided before the screen gallery.
- `stats-screen-ux` (`ios-ui-regression`): `00-stats-empty-state`,
  `01-exercise-view-default`, `01a/01b/01c-exercise-table-*`,
  `02-exercise-view-30-days`, `03-muscle-breakdown-7-days` (the failure shades),
  `04-back-to-exercise-view`; smoke `03-m26-progress`; data-smoke
  `05-data-runtime-smoke-exercise-list`.

## Tests

- `stats-screen.test.tsx`:
  - :568-583 assert `failureBackground*` colours → assert the `viz` roles;
  - :1263-1279 chip geometry → T08-D1;
  - :1290 `2.5k` → T08-D2;
  - :363-401, :524-556 delta strings unchanged (only their colour moves);
  - :1328-1346 sort header geometry kept.
- `ui-design-tokens.test.ts`: the `viz` gates above.

## Docs

- `design-language.md` §2: the data-visualisation roles. §6: "No `k`
  compaction" if T08-D2 is accepted.
- `ux-rules.md` §12.13 (one ramp), §13.1/§13.8 (controls).
- `screen-map.md` 3 (`/stats-history`).
- `design-targets/progress.md`: new, with the palette record.

## Gates

`./boga test fast` + `./boga test frontend`.

## Acceptance

1. The main-screen functions and styles of `stats-history.tsx` hold no legacy
   identifier. The overlay block may, until T09.
2. `viz0`–`viz4` exist, are gated by tests, and are documented in §2.
3. Palette and screen galleries accepted.
4. Estimate: about 1,300 lines.
