# Accepted target — the exercise list, picker and catalogue (repo-native brief)

Target record per `../ai-design-policy.md`, for DLM-T06 (the shared exercise
list, the session view's exercise picker and the exercise page's swap sheet)
of the design-language migration. DLM-T07 extends it with the catalogue and the
exercise editor. Chosen by the user on 2026-09-24 (plan decision G1 (a)): a
brief plus the gallery states the user accepts. **Accepted** by the user in
the DLM-T06 gallery on 2026-09-25.

## Target

- Vocabulary: `../design-language.md` and the app frame (`app-frame.md`).
- This brief, plus the gallery states below. No artboards.

## Brief

- The exercise list is hairline `ListRow`s (density `list`) in one `Card`, or
  one `Card` per muscle family when grouped. A family is headed by a disclosure
  row: its name, the count in Plex Mono, a `chevron-right` / `chevron-down`
  glyph and the expanded state; an empty family is disabled. A row is the name
  (Archivo 600 `ink`), the muscles (`ink-muted`) and the stats line (Plex Mono
  `ink-muted`). A deleted exercise gets a faint `Deleted` `Tag` and faint text,
  never a warning hue (G3). The catalogue's row actions sit in the trailing slot.
- The list options are a micro-label over a `SegmentedControl` (the stats
  window) and a micro-label over a multi `ChipGroup` (`Group by muscle`,
  `Recents on top`), each chip labelled by what tapping it does.
- The picker is a tall `Sheet` (T06-D1) that lifts above the keyboard: the
  title `Select Exercise` with ⋮, Manage (`list`) and Add new (`plus`)
  `IconButton`s on its row, a `SearchField`, and the `Groups` toggle chip
  (solid `ink` while on, never `accent`). ⋮ opens the list options on a
  `surface-subtle` band. The backdrop dismisses it; there is no Cancel.
- Tapping an exercise opens its preselection `Card`: the name in Archivo 700,
  the plan's `From <date>` as a micro-label over its sets as set rows, faded as
  planned (T06-D2), and an action strip with `Add empty set` (outline) and
  `Append plan`, the sheet's one `accent` (G6).
- `From your groups` is a micro-label over one `Card` of `ListRow`s per group,
  each saying its link state in words (`08` pattern 10). Loading, errors and
  empties are `StatePanel`s with the copy unchanged.
- The swap sheet on the exercise page renders the same list (T06-D3).

## States

Device: iPhone simulator at 390pt width, light.

| Screenshot (lane) | State |
| --- | --- |
| `picker-default` (`ios-session-view`) | the picker as it opens: grouped, every family collapsed |
| `picker-options` (`ios-session-view`) | ⋮: the list options |
| `picker-preselection` (`ios-session-view`) | a picked exercise with a plan from history |
| `03-session-view-exercise-added` (`ios-session-view`) | the session view after `Add empty set` |
| `exercise-swap-sheet` (`ios-exercise-page`) | ⋮ → Swap exercise: the shared list in the swap sheet |
| `groups-link-03-picker-search` (`ios-groups-e2e`) | a search with `From your groups` |

Jest only (no flow reaches them): a deleted row (the picker and swap sheet hide
deleted exercises; the catalogue shows them from T07), the catalogue's row
actions, the loading and error panels, and the `Groups`-only list.

No target screenshots are committed; runtime captures stay in the gitignored
`apps/mobile/artifacts/maestro/` tree and are linked as PR evidence.
