# Accepted target — the exercise list, picker and catalogue (repo-native brief)

Target record per `../ai-design-policy.md`, for DLM-T06 (the shared exercise
list, the session view's exercise picker and the exercise page's swap sheet)
of the design-language migration, extended by DLM-T07 with the catalogue and
the exercise editor. Chosen by the user on 2026-09-24 (plan decision G1 (a)): a
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
deleted exercises; the catalogue shows them from T07), the loading and error
panels, and the `Groups`-only list.

## The catalogue and the exercise editor (DLM-T07)

**Pending acceptance** in the DLM-T07 gallery.

### Brief

- The catalogue (`/exercise-catalog`) has the in-content title `Exercises`
  (T07-D1), then one row: a `SearchField`, `+` as an `accent` `IconButton` (the
  screen's one primary, T07-D2) and ⋮. The active filters are `Tag`s beneath
  it, and each one opens Filters. An outcome is a `Notice` above the list:
  `Exercise created.` / `updated.` / `deleted.` / `restored.` with the
  `success` glyph (G3), and a failure in `danger`. Loading and error are
  `StatePanel`s. A grouped list with nothing in it says why beneath the
  family cards.
- **Filters** is a `Sheet` with no Done (G5): the shared list options (T06),
  then `Muscle groups` with a text `Clear`, then `Visibility`. Both are multi
  `ChipGroup`s, solid `ink` while on. Changes apply live.
- **A row's ⋮** opens a `Sheet` titled with the exercise's name: `Edit`
  (`pencil`), `Link to group exercise…` (`link`, signed in only) and `Delete` in
  `danger` (`trash`). A deleted exercise gets `Undelete` instead of `Delete`,
  and `Edit` and `Link` are disabled. Delete does not confirm (T07-D4).
- **The exercise editor** is a tall `Sheet` that lifts above the keyboard, with
  no Cancel. The name is a `FormField`. The weight entry is a micro-labelled
  `SegmentedControl`. The primary muscle is a `ListRow` framed like a field,
  with a faint placeholder and `chevron-right`, turning `danger` when missing.
  Secondary muscles are `ListRow`s in a `Card`, each with a `danger` `x`, over
  an outline `Add secondary muscle`. `Save Exercise` is the sheet's one
  `accent` (G6); a save failure is a `danger` `Notice` under it.
- **Choosing a muscle** swaps the sheet's body for the muscle list (T07-D3):
  the title names the choice, and a `chevron-left` `Back to exercise` sits
  before it. Rows carry `radio-on` / `radio-off` (primary) or `plus` (a
  secondary not yet chosen), with the family on the right in `ink-muted`.

### States

| Screenshot (lane) | State |
| --- | --- |
| `catalogue-list-grouped` (`ios-ui-regression`) | grouped, one family open |
| `catalogue-filters-sheet` (`ios-ui-regression`) | ⋮: Filters |
| `catalogue-list-flat` (`ios-ui-regression`) | grouping off, the sheet closed by its backdrop |
| `catalogue-row-actions-sheet` (`ios-ui-regression`) | a row's ⋮, signed out |
| `editor-create-empty` (`ios-ui-regression`) | `+`: the editor, empty |
| `editor-validation-errors` (`ios-ui-regression`) | Save with no name or primary muscle |
| `editor-muscle-selector` (`ios-ui-regression`) | the primary-muscle list in the same sheet |
| `editor-filled` (`ios-ui-regression`) | a name, `Per side`, a primary and a secondary |
| `catalogue-created-notice` (`ios-ui-regression`) | saved: the notice and the new row |
| `groups-link-01-link-screen` (`ios-groups-e2e`) | reached through a row's ⋮ `Link to group exercise…` |

Jest only (no flow reaches them, or they last under a second): the loading and
error panels, a deleted exercise's actions, the muscle filter with `Clear`, the
save failure, and the `Back to exercise` return.

No target screenshots are committed; runtime captures stay in the gitignored
`apps/mobile/artifacts/maestro/` tree and are linked as PR evidence.
