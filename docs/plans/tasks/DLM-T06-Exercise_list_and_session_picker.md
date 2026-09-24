---
task_id: DLM-T06-Exercise_list_and_session_picker
milestone_id: "none (plan: docs/plans/design-language-migration.md)"
status: planned
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/{components-catalog,ux-rules,screen-map}.md, docs/specs/08-ux-delivery-standard.md (pattern 10 wording), docs/specs/ui/design-targets/exercise-catalogue.md (new)"
---

# DLM-T06 The shared exercise list and the session view's picker

- Status: `planned`, **approved 2026-09-24** (decisions as recommended).
- Depends on: T01, T02. T07 depends on this card.
- Design target (G1): brief + gallery → `design-targets/exercise-catalogue.md`
  (T07 extends the same record).
- Files: `components/exercise-catalog/exercise-list-controls.tsx` (356),
  `components/session-recorder/exercise-picker.tsx` (704),
  `components/groups/picker-group-section.tsx` (114).
- **Why first:** these are the legacy pieces inside the design-language
  screens. The session view's `+ Add exercise` opens a legacy centred modal, and
  the exercise page's swap sheet (already a `Sheet`) renders legacy list rows.

## Today → becomes

### `ExerciseListContent` / `ExerciseListPreferenceControls` (catalogue, picker, swap sheet)

| Today (line) | Becomes |
| --- | --- |
| Row: a bordered `surfaceDefault` card per row (radius sm), name, **"Deleted" chip in `textWarning`/`surfaceWarning`** (:345), muscle summary, stats line in `textAccentMuted` (:341), `renderActions` slot | `ListRow density="list"` hairline rows inside one `Card` per group (or per list when flat). Name Archivo 600 `ink`; muscles `ink-muted`; the stats line in Plex Mono `ink-muted`; "Deleted" becomes `Tag tone="faint"` and the row is faded. `renderActions` becomes the trailing slot. Default a11y "Select exercise <name>" is kept (Maestro taps it) |
| Grouped mode: family header "Family · N" on a `surfaceMuted` fill, expanded state, disabled at N=0 (opacity 0.62), no chevron | A `ListRow` header with a `chevron-down` / `chevron-right` glyph, the count in mono, and `expanded` state. `exercise-family-group-<slug>` and its a11y label are kept |
| Preference controls: "DATE RANGE" + single-select blue pills; "LIST" + two toggle pills ("Group by muscle", "Recents on top") with a11y "Turn grouping off/on" | Date range → `SegmentedControl`. The two toggles → `ChipGroup mode="multi"`, keeping the a11y labels **"Turn grouping off/on"** and **"Turn recents on top off/on"** (Maestro and `groups-link-exercise.yaml` tap them) |

### The exercise picker (session view `+ Add exercise`)

| Today (line) | Becomes |
| --- | --- |
| RN `Modal` (slide) holding a **centred card at 80% height** in a `KeyboardAvoidingView`; backdrop a11y "Dismiss exercise modal overlay" (:319) | A tall `Sheet` (T06-D1). `Sheet` gains `keyboardAvoiding` and a `headerActions` slot (G5). `dismissLabel` stays "Dismiss exercise modal overlay" (`exercise-picker.test.tsx:659`) |
| Header: title "Select Exercise" (no colour) + three 28pt buttons: ⋮ "Exercise picker options", **"≡" text glyph** "Open exercise catalog manage flow", **"+" text glyph** "Open inline exercise create" | The `Sheet` title "Select Exercise" (Maestro taps the title to dismiss the keyboard; it stays tappable text). Three `IconButton`s (`more-vertical`, `list`, `plus`) keeping their a11y labels |
| Search row: filter input + `PickerGroupsToggle` (a pill **filled `actionPrimary` when active**, :104-113) | `SearchField` ("Exercise filter input" kept) + the toggle as a `ChipGroup`-style single toggle chip (`ink` selected, not accent; `accessibilityRole="switch"` and `exercise-picker-groups-toggle` kept) |
| Inline options panel on `surfacePage` | The restyled preference controls on `surface-subtle` inside the sheet |
| Preselection panel: name, **Add empty set (outline) + Append plan (primary)**, "From <date>", plan rows "Set N · weight · reps · quality", dismiss area | Name in Archivo 700. `Add empty set` outline and `Append plan` the sheet's one `accent`. "From <date>" as a micro-label. Plan rows → `SetSummaryRow` with `state="planned"` (T06-D2). testIDs kept: `-preselection-panel`, `-add-empty-set-button`, `-append-plan-button`, `-plan-source`, `-plan-set-row-N`, `-preselection-dismiss-area` |
| `PickerGroupSectionList`: header `textSecondary` + bordered card rows; status text "linked: …" / "not linked" | A micro-label section header + `ListRow`s. Status text unchanged (`08` pattern 10). `exercise-picker-group-row-<id>` kept |
| States: "Loading exercises...", errors, empties in `textMuted` | `StatePanel` inside the sheet, copy unchanged |
| Child overlays: `ExerciseEditorModal` (T07), `GroupExercisePickSheet` (T14) | Unchanged here. The picker still hides itself while a child is open. The pick sheet stays legacy until T14 |

### The exercise page's swap sheet

No code change beyond what `ExerciseListContent` brings: its rows become
`ListRow`s.

## Decisions

| # | Question | Recommendation |
| --- | --- | --- |
| **T06-D1** | The picker: (a) a tall `Sheet` (bottom-anchored, handle, backdrop, keyboard-avoiding) or (b) a full-screen modal with its own top bar | **(a).** It is already a slide-up card dismissed by its backdrop with no Cancel, so (a) changes the least, and it matches the swap sheet on the exercise page. `Sheet` gains the two props, covered in `ui-design-primitives.test.tsx` |
| T06-D2 | Plan rows in the preselection: keep "Set N · weight · reps · quality", or use the set row (`type · weight × reps · 1RM · VOL`, planned = faded)? | **The set row.** Same data, the app's one presentation of a set; it adds the projected 1RM/VOL (`design-language` §6). The testIDs stay on the rows |
| T06-D3 | Card-per-row lists become hairline rows in one `Card` everywhere the list renders (catalogue, picker, swap sheet) | **Yes.** One list recipe, and it fixes the swap sheet's mismatch |

## UX contract

- **Add an exercise from the session view.** Trigger: `+ Add exercise`. Steps:
  search → tap a row → `Add empty set` or `Append plan`. Success: the sheet
  closes and the card appears. Edge: no matches shows the empty copy; a load
  failure shows the error panel.
- **Options.** Trigger: ⋮. Success: the preference panel toggles; grouping and
  recents apply at once.
- **Groups section** (signed in). Trigger: search text, or the `Groups`
  toggle. Success: matches from groups follow your own; tapping one resolves or
  opens the pick sheet (still legacy until T14).
- **Swap on the exercise page.** Trigger: ⋮ → Swap. Success: the same list rows
  inside the existing `Sheet`.

## Gallery

- **New** in `session-view.yaml` (it already opens the picker): `picker-default`
  (after open), `picker-options` (after "Exercise picker options"),
  `picker-preselection` (after tapping a row, before `Add empty set`). Each is
  asserted on its testID.
- `groups-link-03-picker-search` (the groups section, `groups-link-exercise`).
- **New** in `exercise-page.yaml`: `exercise-swap-sheet` (⋮ → Swap, assert
  `exercise-swap-list`, capture, dismiss by backdrop point).
- `03-session-view-exercise-added`, `set-logger-empty`: the after state,
  unchanged.

## Maestro and jest

- The flows keep every tapped label: "Exercise picker options", "Turn grouping
  off", "Exercise filter input", "Select Exercise", "Select exercise <name>",
  `exercise-picker-add-empty-set-button`. The dismiss-keyboard tap on the title
  must still land. Verify it in the lane.
- `exercise-picker.test.tsx`: the backdrop label is kept. Add: the ⋮ / manage /
  create `IconButton`s carry their labels; `Append plan` is the only `accent`.
- `exercise-page-screen.test.tsx`, `session-view-screen.test.tsx`: green.
- `ui-icon.test.tsx`: the "≡" and "+" text glyphs are gone. Add "≡" to the
  retired list if it is not there.

## Docs

- `components-catalog.md` specialized 5 (`ExerciseListContent`) and 14
  (exercise picker: "a `Sheet`"); `PickerGroupSectionList`.
- `ux-rules.md` §2 (modal semantics: the picker is a `Sheet`).
- `design-targets/exercise-catalogue.md`: new.

## Gates

`./boga test fast` + `./boga test frontend` (`ios-session-view`,
`ios-exercise-page`, `ios-groups-e2e` including `groups-link-exercise`).

## Acceptance

1. No legacy identifier in the three files.
2. The picker is a `Sheet`; the flows are green unchanged apart from the new
   captures.
3. Gallery accepted.
4. Estimate: about 1,000 lines.
