# Accepted target — the exercise list, picker and catalogue (repo-native brief)

Target record per `../ai-design-policy.md`, for DLM-T06 (the shared exercise
list, the session view's exercise picker and the exercise page's swap sheet)
of the design-language migration, extended by DLM-T07 with the catalogue and
the exercise editor. Chosen by the user on 2026-09-24 (plan decision G1 (a)): a
brief plus the gallery states the user accepts. **Accepted** by the user in
the DLM-T06 gallery on 2026-09-25.

Behavior simplified by the user-agreed repo-native brief on 2026-09-25: mandatory families, two sorts and all-time row history. This intentionally replaces the earlier optional grouping, periods and Recents controls; typography, surfaces, row and disclosure styling are retained.

## Target

- Vocabulary: `../design-language.md` and the app frame (`app-frame.md`).
- This brief, plus the gallery states below. No artboards.

## Brief

- The exercise list is hairline `ListRow`s (density `list`) in one `Card` per muscle family. A family is headed by a disclosure
  row: its name, the count in Plex Mono, a `chevron-right` / `chevron-down`
  glyph and the expanded state; an empty family is disabled. A row is the name
  (Archivo 600 `ink`), the muscles (`ink-muted`) and the stats line (Plex Mono
  `ink-muted`). A deleted exercise gets a faint `Deleted` `Tag` and faint text,
  never a warning hue (G3). The catalogue's row actions sit in the trailing slot.
- Search is followed by a visible Sort `SegmentedControl` (`Favourite`,
  `Name A–Z`) and checked `Show never-done` chip. No range, muscle filter,
  grouping toggle or redundant status chips. Both preferences are local,
  persistent and shared by catalogue, add and swap. Semantics: `ux-rules.md` §4.
- The row history line is `Last: 23 Sep · 18 sessions`; include the year for
  prior-year dates, use singular `1 session`, and `Never done` without history.
  Favourite uses a fixed 180-day scoring window; history stays all-time.
- Search expands matching families and hides empty ones; clearing restores
  pre-search expansion. Empty results and history loading/failure have explicit
  `StatePanel`s; failures offer Retry and never claim Never done.
- The picker is a tall keyboard-aware `Sheet`: `Select Exercise` with Manage
  (`list`) and Add new (`plus`) actions, Search and the separate `Groups` toggle
  (solid `ink` while on), then the common browsing controls. The backdrop
  dismisses it. Catalogue ⋮ contains management-only deleted visibility.
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
| `picker-options` (`ios-session-view`) | visible sort and never-done controls |
| `picker-preselection` (`ios-session-view`) | a picked exercise with a plan from history |
| `03-session-view-exercise-added` (`ios-session-view`) | the session view after `Add empty set` |
| `exercise-swap-sheet` (`ios-exercise-page`) | ⋮ → Swap exercise: the shared list in the swap sheet |
| `groups-link-03-picker-search` (`ios-groups-e2e`) | a search with `From your groups` |

Additional browser comparison states: Favourite and A–Z, never-done on/off,
expanded search and no matches, current/prior-year dates, history older than
180 days and loading/error, at 390pt plus smaller/larger phone widths.

Jest coverage also includes a deleted row (the picker and swap sheet hide
deleted exercises; the catalogue shows them from T07), the loading and error
panels, and the `Groups`-only list.

## The catalogue and the exercise editor (DLM-T07)

**Accepted** by the user in the DLM-T07 gallery on 2026-09-25.

### Brief

- The catalogue (`/exercise-catalog`) has the in-content title `Exercises`
  (T07-D1), then one row: a `SearchField`, `+` as an `accent` `IconButton` (the
  screen's one primary, T07-D2) and ⋮. The shared Sort and Show never-done
  controls stay beneath it. An outcome is a `Notice` above the list:
  `Exercise created.` / `updated.` / `deleted.` / `restored.` with the
  `success` glyph (G3), and a failure in `danger`. Loading and error are
  `StatePanel`s. An empty list says why above its disabled family cards.
- **Manage exercises** is a `Sheet` with no Done (G5), containing only
  Show deleted, a multi `ChipGroup` solid `ink` while on. Changes apply live.
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
| `catalogue-management-sheet` (`ios-ui-regression`) | ⋮: Manage exercises |
| `catalogue-name-sort` (`ios-ui-regression`) | Name A–Z within families |
| `catalogue-row-actions-sheet` (`ios-ui-regression`) | a row's ⋮, signed out |
| `editor-create-empty` (`ios-ui-regression`) | `+`: the editor, empty |
| `editor-validation-errors` (`ios-ui-regression`) | Save with no name or primary muscle |
| `editor-muscle-selector` (`ios-ui-regression`) | the primary-muscle list in the same sheet |
| `editor-filled` (`ios-ui-regression`) | a name, `Per side`, a primary and a secondary |
| `catalogue-created-notice` (`ios-ui-regression`) | saved: the notice and the new row |
| `groups-link-01-link-screen` (`ios-groups-e2e`) | reached through a row's ⋮ `Link to group exercise…` |

The `browser-*` captures in `ios-ui-regression` cover search, no matches,
prior-year/old history, shared preferences, old plan suggestions and real
history loading/error/Retry. Jest additionally covers deleted actions,
save failure and `Back to exercise`.

No target screenshots are committed; runtime captures stay in the gitignored
`apps/mobile/artifacts/maestro/` tree and are linked as PR evidence.
