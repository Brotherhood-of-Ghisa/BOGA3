# Components Catalog (Authoritative Current UI Components)

## Purpose

Brief entrypoint inventory of the current reusable UI component set.

- This doc answers: "what exists, where it lives, and what it is for?"
- Source files remain the authority for exact props, variants, and implementation details.

## Sources

- UI docs index: `docs/specs/ui/README.md`
- UX rules/semantics: `docs/specs/ui/ux-rules.md`

## Canonical locations (current)

- `apps/mobile/components/ui/`
  - canonical tokens + primitive UI building blocks
- `apps/mobile/components/navigation/`
  - shared navigation-specific UI (app-specific, not generic primitives)
- `apps/mobile/components/exercise-catalog/`
  - shared exercise-catalog editing and list UI reused by the catalogue route,
    the session view's exercise picker and the exercise page's swap sheet
- `apps/mobile/components/session-recorder/`
  - the exercise picker and supporting UI modules; the folder name predates
    the session view
- `apps/mobile/components/session-complete/`
  - the completion presentation: summary, PR and volume cards, share sheet and
    share image
- `apps/mobile/components/session-detail/`
  - the read-only session cards shared by the session view, View Session and
    the group session view (set row, exercise card, facts card)
- `apps/mobile/components/view-session/`
  - View Session, the completed-session detail's composition
- `apps/mobile/components/session-list/`
  - shared building blocks originally extracted from the retired session-list
    screen (summary line, active-session row, history list, data hook); now
    consumed by Progress/`stats-history`, Today, and session-list flows
- `apps/mobile/components/muscle-analytics/`
  - shared muscle analytics UI components for Stats/History surfaces

## Current component set (authoritative)

### Tokens and primitive exports

1. `uiTokens` (and token groups)
- File: `apps/mobile/components/ui/tokens.ts`
- Purpose:
  - single source of truth for shared UI token values (colors, spacing, radius, typography, border)
  - includes the shared semantic/status/overlay color palette used by current route screens after the M8 convergence refactor (Task `T-20260226-06`)
  - includes token-backed green family and warm individual-muscle background palettes for Stats / History failure intensity; each row selects one uniform shade from its palette
  - carries the collapsed scales the UI guardrail enforces (8 type sizes with a
    matching `lineHeight` per size, 6 spacing steps, 3 radii); values and
    rationale: `docs/specs/ui/ux-rules.md` §9a. (`uiElevation` was deleted
    2026-09-24 with no user.)
  - also carries the design-language vocabularies, adopted so far by the exercise
    page, the session view, the Gyms screen and View Session: `uiRoles` (colour roles), `uiFonts` (the three embedded typefaces
    and their shipped weights) and `uiGeometry` (card / sheet / control / pill radii,
    the 44pt tap target, the 38pt metric column, the sheet handle, the 50pt
    labelled-field height, micro-label tracking); rationale:
    `docs/specs/ui/design-language.md` §2–§4
  - `uiIconSize` (`xs` 12 / `sm` 16 / `md` 20 / `lg` 24), the icon edge lengths
    `Icon` takes

2. `UiText`
- File: `apps/mobile/components/ui/text.tsx`
- Purpose:
  - shared text primitive for semantic text roles used across reusable UI components
  - enforces fixed font sizes, including when callers spread props; app-wide
    text/input policy: `ux-rules.md` §9a

3. `UiSurface`
- File: `apps/mobile/components/ui/surface.tsx`
- Purpose:
  - shared surface/card/panel wrapper for bordered rounded containers

4. `UiButton`
- File: `apps/mobile/components/ui/button.tsx`
- Purpose:
  - shared semantic button primitive (including tab-style usage for top-level navigation)

5. `SegmentedChips`
- File: `apps/mobile/components/ui/segmented-chips.tsx`
- Purpose:
  - shared segmented choice row whose default `pills` presentation preserves
    existing callers
  - exposes an opt-in joined, equal-width variant used by the Stats / History
    `Breakdown` control so both choices remain visibly grouped and accessible

6. Design-language primitives: `Card`, `Stat`, `ListRow`, `Sheet`, `ActionButton`
- Files: `apps/mobile/components/ui/card.tsx`, `stat.tsx`, `list-row.tsx`, `sheet.tsx`, `action-button.tsx`
- Purpose:
  - the building blocks of the exercise page and session view, drawn from
    `uiRoles` / `uiFonts` / `uiGeometry` only (`docs/specs/ui/design-language.md`);
    adopted by the exercise page (`components/exercise-page/`), the session view
    (`components/session-view/`, including its `Gym` picker sheet
    `session-gym-sheet.tsx`), the Gyms screen (`components/gyms/`) and View
    Session (`components/view-session/`, `components/session-detail/`,
    `components/session-complete/`)
  - `Card` — `surface` on `paper`, 1px `rule`, card radius, no shadow, no
    padding (content owns its insets); with `onPress` the whole card is one
    labelled `link` target
  - `Stat` — a micro-label legend with a monospaced value; `stacked` (label
    above value: summary card, records panel) or `inline` (legend left of the
    fixed-width right-aligned metric column: the set row, `rank` primary 1RM /
    secondary VOL); `state="planned"` fades it, `emphasis="record"` sets it
    bold `record` (the only emphasis — `design-language.md` §5);
    `kind="text"` for a non-figure value; a stacked `rank="secondary"` is a
    figure in a list row (Plex Mono 600 `base`, Progress muscle rows), and
    `ground="viz"` turns the legend `ink` on a data-viz ground (DLM-T08)
  - `ListRow` — `[leading][label or children][meta][trailing]`, the trailing
    control always in a fixed tap-target-wide column so controls share one
    vertical axis; `density` `sheet` (option rows) or `list` (dense rows in a
    card, e.g. the set row); `selected` (`accent-wash`), `tone="danger"`,
    `divider`; pressable as one row only when given `onPress`. The trailing
    control is a slot, so the row carries no icon dependency. `expanded`
    (DLM-T06) announces a disclosure row's state: the exercise list's family
    headers
  - `Sheet` — bottom-anchored panel over a `scrim` backdrop, sheet radius,
    38×4 handle, optional title; the backdrop tap, Android back and the
    VoiceOver escape gesture dismiss it — there is no Cancel button. It never
    grows past the top of the screen (a taller body shrinks to fit). DLM-T06
    added `headerActions` (controls on the title's row, `<testID>-header`) and
    `keyboardAvoiding` (lifts the panel above the keyboard), for the exercise
    picker. DLM-T07 added `headerLeading` (one control before the title): the
    exercise editor's `chevron-left` `Back to exercise` from its muscle list
  - `ActionButton` — `primary` (`accent` ground: the screen's one primary),
    `outline` (`ink` hairline) or `text` (caps label); `tone="danger"` recolours
    an outline or text button. Control radius, 44pt tall, Archivo caps label.
    Replaced the session view's `OutlineButton` and the Gyms screen's
    `GymButton` (View Session was its third consumer). DLM-T10 added `checked`
    for a text button that toggles a view (Sessions' `Show deleted`)
  - covered by `apps/mobile/app/__tests__/ui-design-primitives.test.tsx`

6a. Design-language primitives for the remaining screens (DLM-T01, 2026-09-24)
- Files: `apps/mobile/components/ui/icon-button.tsx`, `state-panel.tsx`,
  `screen.tsx`, `form-field.tsx`, `search-field.tsx`, `segmented-control.tsx`,
  `chip-group.tsx`, `tag.tsx`, `notice.tsx`
- Purpose: what the screens still on the legacy vocabulary need to move over;
  each has two or more consumers. `uiRoles` / `uiFonts` / `uiGeometry` only
  - `IconButton` — a labelled 44pt icon-only control; `tone` `default` (`ink`),
    `muted`, `danger`, or `accent` (a filled square: the screen's one primary as
    an icon). Every top bar's back and ⋮, View Session's card ⋮, and the
    exercise picker's ⋮ / Manage / Add new (DLM-T06), and the catalogue's `accent`
    `+`, ⋮ and row ⋮ and the editor's back and remove controls (DLM-T07)
  - `StatePanel` — a loading / message / error state: optional spinner, title
    (Archivo), body (`ink-muted`), one outline action and optional children;
    `fill` (centred in its space, the default) or inline. The session view's,
    exercise page's and View Session's non-content states; the catalogue's
    and the exercise editor's loading and error (DLM-T07); Progress's
    loading, error and empty states (DLM-T08) and the history sheets' (inline,
    DLM-T09); every group state panel, wrapped by `GroupStateView` and friends
    (DLM-T11)
  - `Screen` / `ScreenScroll` — the `paper` ground; the scroll body with the page
    gutter (`lg`, or `md` for the exercise page) and the `md` card gap, passing
    other `ScrollView` props through (refresh, keyboard insets). Used by the
    session view, exercise page, View Session, Gyms and the group session view;
    the Groups tab (`ScreenScroll` with `refreshControl`, DLM-T11)
  - `FormField` — a micro-label inside a field one `fieldHeight` tall, `rule-strong`
    turning `danger` while invalid, the error below (`<testID>-error` or
    `errorTestID`), an optional hint or counter; `face` `figure` (Plex Mono) or
    `text`. The completed edit's Start / End (`session-times-fields`), and the
    credential and profile fields of Sign in and Profile (DLM-T05), and the
    exercise name in `ExerciseCoreFields` (DLM-T07)
  - `SearchField` — search glyph, text, and a clear control while there is text;
    `accessibilityLabel` required. The swap sheet's search, the exercise
    picker's filter (DLM-T06), the Progress filter (DLM-T08) and the
    catalogue's filter (DLM-T07)
  - `SegmentedControl` — one choice from a few, joined in a `rule-strong` frame,
    the selected segment solid `ink`; `layout` `fill` (equal width), `inline`,
    or `fit` (across the row, label-sized segments sharing the rest: the
    exercise history's four metrics, DLM-T09);
    `tablist` / `tab` / `selected` and the `<prefix>-row` / `<prefix>-<value>`
    testIDs of the legacy `SegmentedChips`. The records panel's `Records` | `Last`,
    Settings' date format (DLM-T04), the exercise list's Favourite/Name A–Z
    (`exercise-list-sort-*`), Progress's Time range and
    Breakdown (DLM-T08) and its history sheets' Metric and View
    (`stats-<kind>-history-metric-chip-*` / `-view-chip-*`, DLM-T09), and
    `ExerciseCoreFields`' weight entry
    (`<prefix>-load-mode-*`, DLM-T07, which added `disabled` for the group
    exercise form's pending state), and the Groups tab's `Stream` |
    `Leaderboards` (`groups-segment-*`, DLM-T11)
  - `ChipGroup` — wrapping pills, `single` (a tab list, `selected`) or `multi`
    (checkboxes, `checked`), the same testID contract, per-chip accessibility
    labels. Logs' level filter (DLM-T04), the exercise list's `Show never-done` (`multi`, `exercise-list-visibility-*`),
    the catalogue's Show deleted control (`multi`), and the Groups tab's group
    chips (`single`, `groups-stream-filter-*`, DLM-T11). DLM-T10 added a
    per-option `faint` (a deleted tag) and `single` mode's `clearValue`
    (pressing the selected chip selects the clear value: exercise history's
    tag filter, where tapping the selected tag returns to `All tags`)
  - `Tag` — a static micro-label pill naming a state (`Archived`, `Deleted`, a
    role); `neutral` or `faint`. Connected agents' `AI` tag (DLM-T05), the
    exercise list's `Deleted` (`faint`, DLM-T06), and a group record card's
    boards (DLM-T11)
  - `Notice` — a `surface-subtle` band on a `rule` hairline: optional glyph, words,
    optional action; `neutral` or `danger` (`alert`); `live` announces it. There
    is no success or warning hue: the glyph and words carry the state. An
    optional `title` (Archivo 700, a `header`) names a message that is a reason
    ("Sign-in unavailable"). Settings' developer-tool outcomes (DLM-T04);
    Sign-in, the first-sync gate and Profile (DLM-T05); the catalogue's outcome
    and the exercise editor's save failure (DLM-T07); the group offline marker,
    write notice and inline error (DLM-T11)
  - `PageHeader` / `SectionHeader` (`page-header.tsx`, DLM-T03) — a tab
    screen's in-content title (Archivo 800 `xxl`) and optional `ink-muted`
    intro; a section's heading (Archivo 700 `lg`) with an optional caps text
    action. Today and Train; `PageHeader` also More and Settings (DLM-T04),
    Sign in (DLM-T05) and Groups (DLM-T11)
  - `ListRow` also takes an `accessibilityHint` for a pressable row (DLM-T03),
    and a `description` (a wrapping `ink-muted` second line) and
    `accessibilityRole="link"` for a row that opens the browser (DLM-T04: the
    More and Settings destinations)
  - covered by `apps/mobile/app/__tests__/ui-design-primitives.test.tsx`

7. `Icon`
- Files: `apps/mobile/components/ui/icon.tsx`, `icon-glyphs.ts` (geometry),
  `LICENSE.lucide`
- Purpose:
  - the app's icon set: `<Icon name size color label testID />` over
    `react-native-svg`. `name` is a closed union (`IconName`); `size` a
    `uiIconSize` key (default `md`); `color` a token value (default
    `uiRoles.ink`)
  - decorative by default (hidden from assistive tech, never takes touches); a
    `label` makes it an accessible image, for the rare icon no surrounding text
    or control label explains
  - `delete` (Lucide `trash-2`) marks a destructive menu option
  - geometry is vendored from Lucide 1.47.0 (ISC; notice in `LICENSE.lucide`),
    plus `chevron-left` (back), `pencil` (edit), `swap` (Lucide
    `arrow-left-right`) and `trash` (Lucide `trash-2`) for the exercise page,
    `link` (Lucide `link`) for its ⋮ `Link to group exercise…`, `location`
    (Lucide `map-pin`) for a gym's saved location and the gym sheet's nearby
    suggestion, `search` and `list` (Lucide `search`, `list`), and the status
    glyphs `offline` (Lucide `wifi-off`), `success` (`circle-check`) and
    `warning` (`triangle-alert`), which stay `ink` — the design language has no
    success or warning hue,
    plus BoGa glyphs: `caret-down`, `radio-on` / `radio-off`, and the
    design-language §5 set-state glyphs `set-done` (filled `ink` disc, knocked-out
    check), `set-current` (`accent` ring), `set-planned` (dashed `planned` ring),
    which carry their role colour by default and are meant for `ListRow`'s
    trailing slot on the set row. Add icons from the same Lucide
    release, named by role
  - replaced the improvised Unicode glyphs on every screen;
    `app/__tests__/ui-icon.test.tsx` fails if a retired glyph comes back
    anywhere in `app/`, `components/` or `src/` (no file is exempt)

8. `ui` barrel exports
- File: `apps/mobile/components/ui/index.ts`
- Purpose:
  - single import entrypoint for current tokens and UI primitives

### Specialized shared components (reusable, not generic primitives)

1. `BottomTray`
- File: `apps/mobile/components/navigation/bottom-tray.tsx`
- Purpose:
  - collapsible bottom navigation tray that wraps `MainTabs`; exposes a drag handle (React Native `PanResponder` + `Animated`) to collapse to a peek strip and `useTrayVisibility()` hook plus `TrayVisibilityProvider` so screens can imperatively expand/collapse
  - snap math lives in the pure helper `apps/mobile/src/navigation/tray-snap.ts` so it can be unit-tested without gesture plumbing
  - the handle is the sheet handle's recipe (38×4, `rule-strong`, `radius.pill`; DLM-T02)

2. `MainTabs`
- File: `apps/mobile/components/navigation/main-tabs.tsx`
- Purpose:
  - token-backed, accessible four-tab presentation for `Today`, `Train`,
    `Progress`, and `More`, driven by the single declarative model in
    `apps/mobile/src/navigation/main-tabs.ts`
  - production navigation body inside `BottomTray` and the matching direct
    navigation strip on the session view and the `exercise-history` detail screen
  - design language (DLM-T02): one `Card`-recipe strip (`surface`, `rule`,
    card radius) of plain Archivo labels; the active tab is `ink` 700 over a
    2pt `ink` underline (`<tab testID>-indicator`), the others `ink-muted` 600;
    never `accent`
  - the non-visual model owns canonical order, labels, routes, test IDs,
    canonical/legacy ownership resolution, and unknown-route null fallback

3. `MoreHubBackButton`
- File: `apps/mobile/components/navigation/more-hub-back-button.tsx`
- Purpose:
  - source-aware `Back to More` action shared by the tab-owned Exercise
    Catalog and Settings destinations; renders only for `source=more` and
    replaces to the hub (Groups does not use it); a caps text `ActionButton`
    (`back-to-more-button`) at the top left

4. `ExerciseEditorModal`
- File: `apps/mobile/components/exercise-catalog/exercise-editor-modal.tsx`
- Purpose:
  - shared create/edit exercise editor reused by `exercise-catalog`, the exercise picker's `Add new` and group `Add as new`, the exercise page and the group exercises page
  - optional `prefill` (name, weight entry, muscles for a new exercise), `onSave` (replaces the default save; a rejection shows inline), and `title` (M25-T07: the picker's group `Add as new` prefills from the group exercise and saves through `createExerciseWithGroupLink`); the fields are unchanged
  - in the design language (DLM-T07): a tall `Sheet` (`keyboardAvoiding`, testID `exercise-editor`, backdrop `Dismiss exercise editor overlay`, no Cancel) holding `ExerciseCoreFields`, a field-framed `ListRow` for the primary muscle (`exercise-editor-primary-muscle-trigger`), the secondary muscles as `ListRow`s in a `Card` with a `danger` `x` each, an outline `Add secondary muscle` (`exercise-editor-secondary-muscle-trigger`), and `Save Exercise`, the sheet's one `accent`. The muscle list is a panel swap in the same sheet (T07-D3): the title changes, `headerLeading` is a `chevron-left` `Back to exercise` (`exercise-editor-muscle-selector-back`), and the rows are `ListRow`s (`exercise-editor-muscle-option-<id>`, `radio-on` / `radio-off` for the primary, `plus` for a secondary) in `exercise-editor-muscle-selector-list`. Target: `design-targets/exercise-catalogue.md`

5. `ExerciseListContent` / `ExerciseListPreferenceControls`
- File: `apps/mobile/components/exercise-catalog/exercise-list-controls.tsx`
- Purpose:
  - shared exercise list row/header rendering and shared Favourite/Name A–Z and Show never-done controls for `exercise-catalog`, the exercise picker and the exercise page's `ExerciseSwapSheet`
  - in the design language (DLM-T06): hairline `ListRow`s in one `Card` per muscle family, headed by a disclosure row (count in Plex Mono, `chevron-right` / `chevron-down`, `expanded`, testID `exercise-family-group-<slug>`); a row is the name, the muscles and the Plex Mono stats line, a deleted one a faint `Deleted` `Tag` with faint text; `renderActions` fills the trailing slot beside the row's own target. The visible controls are a Sort `SegmentedControl` (Favourite/Name A–Z) and a checked Show never-done `ChipGroup`. The compact history line shows Last performed plus all-time session count (or Never done). Search expands nonempty matching families without mutating saved expansion; initial history loading/failure replaces personal rows with a `StatePanel` and Retry on failure. Target: `design-targets/exercise-catalogue.md`
  - covered by `apps/mobile/app/__tests__/exercise-list-controls.test.tsx`
  - composes the non-visual list model/preference modules under `apps/mobile/src/exercise-catalog/` so all three surfaces share grouping, filtering, sorting, row stats, collapsed-group state behavior, and local-only preference behavior while each route keeps its surface-specific actions

6. Session completion (the completion presentation of `/completed-session/<id>`)
- Folder: `apps/mobile/components/session-complete/`
- Purpose:
  - `SessionCompletionScreen` — the post-submit composition on `paper`:
    `SessionTopBar mode="complete"` (`Session complete` · Done), a
    `SessionFactsCard` (Duration / Exercises / Sets / Working, then Gym) with
    the working-sets-by-muscle pills under a `rule-soft` divider, every
    `PersonalRecordCard`, shared exercise/muscle comparisons and the
    `Share session` outline `ActionButton`. Muscle pills are informational,
    never analytics links; all PRs stay visible together
  - `SessionMuscleBreakdown` / `SessionSummaryContent` (`session-summary-content.tsx`)
    share muscle pills, records, comparisons and Share between completion and
    historical review. Hosts own their facts/top bar; completion keeps its
    post-Finish composition and share-image content.
  - `SessionInsightPresentation` (`components/session-recorder/`) — shared by
    live, completion and historical Summary; `SegmentedControl` selects exercise
    or muscle `ExerciseVolumeCard`s, defaulting to exercise. Keeps the completion
    flow's `session-completion-exercise-volume` selector and explicit empty states.
    Historical View Session controls grouping across local section changes and
    uses its shared top-bar Edit action. Separate history/catalog states isolate
    optional enrichment failures; active sessions keep uncontrolled grouping.
  - `PersonalRecordCard` — a `Card` with a `record` band (`New 1RM record ·
    <1RM>`), the exercise and its set (`185.0 × 8`), the 1RM bold `record`;
    read as one accessibility element
  - `ExerciseVolumeCard` — name, set counts, the `Vol` figure (no separator,
    no unit) and its delta from the median, and the P5–P95 range (`rule-strong`
    track, `ink-muted` median tick, `ink` current dot) or the single/equal
    baseline and no-history states; no `accent`. `variant="share"` for the share
    image
  - `SessionShareSheet` / `SessionShareCard` — a `Sheet` (`Share session`)
    previewing the exact privacy-limited image, `Share image` its one action,
    inline retryable failure and temporary-file cleanup; no Close or Cancel.
    The card (`paper`, `ink` mark, record band, mono figures) includes all PRs
    and exercise comparisons, never gym or location data
  - covered by `apps/mobile/app/__tests__/completed-session-detail-screen.test.tsx`
    and the `ios-ui-regression` lane (`session-completion-states-fixture`)

7. `SessionSummaryLine`
- File: `apps/mobile/components/session-list/session-summary-line.tsx`
- Purpose:
  - shared two-line summary row (date/duration/gym + sets/exercises) reused by
    `ActiveSessionRow`, `HistoryList`, Today recents, and Progress history
  - figures in Plex Mono (`ink` for the start and duration, `ink-muted` for the
    counts), the gym in Source Sans, `·` separators in `ink-faint` (DLM-T03)

8. `ActiveSessionRow`
- File: `apps/mobile/components/session-list/active-session-row.tsx`
- Purpose:
  - the active session on `/sessions` as a `Card` (DLM-T10): a `ListRow` with
    the `set-current` glyph and `SessionSummaryLine` (resume), then `check`
    (review and complete) and ⋮ `IconButton`s
  - ⋮ opens a `Sheet` with one `danger` `Delete`, which confirms in an `Alert`
    before discarding (T10-D4)

9. `HistoryList`
- File: `apps/mobile/components/session-list/history-list.tsx`
- Purpose:
  - the completed-session history on `/sessions`, rendered inside its host's
    scroll (DLM-T10): a `History` micro-label with the `Show deleted` / `Hide
    deleted` text `ActionButton` (`checked`), the rows as `ListRow`s in one
    `Card` (a deleted row faded, with a `Deleted` `Tag`), and `StatePanel`s for
    loading, the load error (`Retry`) and the empties
  - a row's ⋮ opens a `Sheet` titled with the session's start stamp: `Edit`,
    `Append`, `Delete` (`danger`) or `Undelete`

10. `DailyHeatmap` / `WeeklyHeatmap`, and `HistorySheet`
- Files: `apps/mobile/components/heatmaps/` (`DailyHeatmap.tsx`,
  `WeeklyHeatmap.tsx`, `HeatmapLegend.tsx`, `heatmap-style.ts`,
  `heatmap-metric.ts`, `heatmapData.ts`; `README.md`) and
  `apps/mobile/components/stats/history-sheet.tsx`
- Purpose:
  - `DailyHeatmap` / `WeeklyHeatmap` — daily-cell and weekly-bar views over one
    `HeatmapData`, horizontally scrollable over the loaded history, in the
    design language (DLM-T09): cells and bars on the `viz0`–`viz4` ramp
    (`HEAT_RAMP`), an empty day `viz0` with a `rule` hairline; **today (or the
    current week) a 1px `ink` ring, the selected cell a 2px `ink` border** plus
    the selected state, and a filled `ink` `caret-down` over the selected week
    (`<prefix>-heatmap-selected-marker`). The daily view's detail is a `Card`
    with a Plex Mono value; gutter, axis and the Less…More `HeatmapLegend` are
    `ink-faint` micro-labels. testIDs `<prefix>-heatmap`,
    `-heatmap-cell-<dateKey | weekStartDateKey>`, `-heatmap-bar-<weekStartDateKey>`,
    `-heatmap-day-detail` (`-date`, `-value`). Semantics: `ux-rules.md` §11
  - `HistorySheet` — the Progress history of one exercise, muscle or muscle
    family (DLM-T09-D2, which merged the two legacy overlays): a `Sheet` at
    about three quarters of the screen, no close button (G5); eyebrow and name;
    `Metric` and `View` `SegmentedControl`s under micro-labels; a `rule-soft`
    week banner in Weekly; inline `StatePanel`s for loading, error and no
    history; both heatmap views kept mounted, the inactive one transparent,
    inert and hidden from accessibility. `kind` (`muscle` | `exercise`) names
    the testIDs: `stats-<kind>-history` (the `Sheet`; `-backdrop`, labelled
    `Dismiss <kind> history`), `-overlay` (the body), `-title`,
    `-metric-chip-<metric>`, `-view-chip-<view>`, `-week-banner` (`-range`,
    `-value`, `-placeholder`), `-loading`, `-error`, `-empty`, `-scroll`,
    `-heatmap-panel-<view>`. Semantics: `ux-rules.md` §12. Target:
    `design-targets/progress.md`

11. Group components (M22)
- Folder: `apps/mobile/components/groups/` (barrel `index.ts`); data comes from `@/src/groups` hooks and the pure view model
- Purpose:
  - `GroupStreamSessionCard` — the stream card, a `Card` link (design language DLM-T11): member (Archivo 700), status in words (`Training now` beside the `set-current` ring, `Completed · 45m` in `ink-muted`), start · gym, sets · kg · exercises computed on the device in Plex Mono, the `N records` label in `record` (M25-T10, `-records`), group names in All; one press target
  - `GroupStreamMembershipItem` — "X joined / left the group / was removed" light row behind a `rule` hairline, `ink-muted` (`streamRowStyles`, shared with `GroupStreamSentenceItem`); pressable only where it opens another screen
  - `GroupFilterChips` — a single `ChipGroup` with one chip per group, exactly one selected (no `All`), wrapping rather than scrolling sideways; the Groups screen's group selector
  - `GroupStreamList` — `FlatList` on `groupScreenStyles` with `RefreshControl`, online older-page loading, and an inline `StatePanel` Retry footer; (M25-T10) it renders every stream kind and owns the one certification write state (`useRecordSetCertification`) shared by the inline `Certify` buttons and the row detail sheet
  - `GroupStreamRecordCard` (M25-T10) — a record card under its session card (indented): a `Card` whose `record` band (`-band`) carries the title (`dave — group record` / `— PR`), then the group exercise and its value in bold `record` Plex Mono (`140.0 × 1 · 1RM 142.5`), board `Tag`s, `Session in progress`, the status via `GroupCertificationStatus` (`Not certified yet` / `Certified by …` / `Voided · set …`), and its group where names are shown (Today). A voided card has no band, fades to `ink-faint` and puts its status first (DLM-T11-D2). The summary is one press target (opens the sheet, or on Today the Groups screen via `pressHint`), and an outline `Certify` sits beside it with its inline notice. Without `onCertify` (Today) the card is read-only. testID `group-stream-record-card-<key>` with `-open`, `-band`, `-title`, `-value`, `-provisional`, `-status`, `-group`, `-certify`, `-notice`
  - `GroupStreamSentenceItem` (M25-T10) — a record-removed or link item: a light row with one sentence behind a `rule` hairline, not pressable. testIDs `group-stream-record-removed-<key>` / `group-stream-link-<key>` with `-sentence`
  - `RecordSetSheet` (M25-T10; a `Sheet` since DLM-T11) — the row detail (E2) shared by record cards and board rows, titled with the lifter and the exercise: the set and 1RM as `record` `Stat`s, then the logged, date · gym, logged-as, provisional and status lines, the lifter note, the write notice, `Certify` (the sheet's one `accent`), `Remove my certification` / `Cancel certification` as `danger` `ListRow`s (confirmed with `Alert.alert`), and `View full session` as a `ListRow` with a chevron. No Close: the backdrop (`Close set details`) dismisses it (G5). Gym and logged-as come from the `session:<memberId>:<sessionId>` resource. testIDs `group-record-sheet` with `-backdrop`, `-header` (the title), `-value`, `-logged`, `-date`, `-logged-as`, `-provisional`, `-status`, `-lifter-note`, `-notice`, `-certify`, `-withdraw`, `-cancel`, `-view-session`
  - `GroupOfflineBanner` — the `Offline · last updated HH:MM` marker: a neutral `Notice` with the `offline` glyph, live (08 pattern 7)
  - `GroupMemberRow`, `GroupSummaryRow` — Members-screen and My groups rows; `GroupMemberRow` takes an optional `onPress` (set only when my role offers actions on that member) and then shows a chevron
  - `GroupMemberActionSheet` (M22-T05) — `GroupActionSheet` for one member offering exactly `groupMemberActionsFor(myRole, me, member)` (contract §4.3): `Make admin` / `Remove admin` (secondary), `Transfer ownership` / `Remove from group` (danger; the caller confirms with `Alert.alert`), `Cancel`. testIDs `group-member-actions-sheet`, `group-member-action-<action>`
  - `GroupActionSheet` (M25-T08) — the in-route bottom `Modal` behind both action sheets: title, optional subtitle, one button per action (danger when destructive), `Cancel`. testIDs `<prefix>-sheet` / `-overlay` / `-cancel` and `<actionPrefix>-<key>`
  - `GroupExercisesPage` (M25-T08) — the group screen's Exercises section: rows, empty and missing-data states, owner/admin `Add exercise`, and the exercise sheet (`Rename` / `Archive` / `Unarchive`)
  - `GroupExerciseRow` (M25-T08) — name, weight entry, my link status (`Linked: …` / `Not linked`), and an `Archived` badge; pressable with a chevron for owner/admin only; optional `Link your exercise` and `Unlink…` buttons (`group-exercise-link-button-<id>` / `group-exercise-unlink-button-<id>`) sit outside that press target; `personalLinks` retains stable IDs and labels, and unlink pending disables repeat taps
  - `GroupExerciseUnlinkSheet` — scrollable in-route chooser for multiple personal links, showing target/group context and stable-ID `Unlink` actions, with duplicate/missing-name identifiers; the host waits for native dismissal before the shared confirmation, then restores focus to the row
  - `GroupExerciseForm` (M25-T08) — the add / edit group-exercise form over `ExerciseCoreFields`, validated by `validateExerciseCore`, with the write's failure above the submit button
  - `StandardExercisePicker` (M25-T08) — search and list of the bundled standard exercises to copy into a group
  - `GroupLostAccessState` (M25-T08) — the shared "You're no longer a member of this group" panel
  - `GroupLeaderboardsPage`, `GroupPodiumCard` (M25-T09) — the Groups screen's Leaderboards segment: one whole-card press target per group exercise (name, view label, `Archived` tag, up to three podium rows, empty label, `You: …`). testIDs `group-leaderboards-page`, `group-leaderboards-empty`, `group-podium-card-<exerciseId>` with `-name`, `-view`, `-archived`, `-row-<rank>`, `-empty`, `-you`
  - `GroupCertificationStatus` — a record's certification state: a check `Icon` in `ink` (certified), a ring in `ink-muted` (not yet) or none (voided) beside its label, no success hue; `size` `body` (cards, sheet) or `meta` (a board row's mark); the label keeps the caller's testID. Used by `GroupStreamRecordCard`, `RecordSetSheet` and `GroupBoardRow`
  - `GroupBoardRow` (M25-T09) — one full-board row as a single accessibility element (rank, member, value, e1RM detail, date, the certification mark on All); my row on the muted panel; (M25-T10) a press target that opens the row detail sheet. testID `group-board-row-<rank>` with `-member`, `-value`, `-detail`, `-date`, `-mark` (the icon `-mark-certified` / `-mark-uncertified`)
  - `GroupBoardHistoryItem` (M25-T09) — one lead change: date and sentence. testID `group-board-history-item-<seq>` with `-date`, `-sentence`
  - `GroupPagesFooter` (M25-T09) — the footer of an online paged list: an inline `StatePanel`, loading, or the failure with an outline `Retry` (`<prefix>-loading-more`, `-load-more-error`, `-load-more-retry`)
  - `UsernameGate` + `useUsernameGate(userId)` (M22-T05) — the inline username field shown before create / join when the profile username is blank (`loadUserProfile` / `saveUsername`); errors inline under the field; `require(notice)` re-opens it on a server `USERNAME_REQUIRED`; a profile that fails to load does not block the form
  - `GroupDetailsForm` (M22-T05) — the shared create / edit form: name (1–50) and optional description (≤280, counter) with inline validation, the write's failure above the submit button
  - `GroupWriteNotice` (M22-T05) — inline outcome of a group write: a `danger` `Notice`, or a neutral one with the `success` glyph (08 pattern 9)
  - `GroupsEmptyActions` (M22-T05) — the empty state's `Create group` (the screen's one primary) / `Join with a code` (outline) buttons
  - `FriendSessionContent` — the friend's session body on View Session's cards (`components/session-detail/`): a `SessionFactsCard` headed by the member and status, then an `ExerciseSetsCard` per exercise (rows `group-session-set-row-<setId>`), read-only, no record band
  - `PickerGroupSectionList`, `PickerGroupsToggle` (M25-T07; design language DLM-T06) — the exercise picker's `From your groups` section, a micro-label over one `Card` of `ListRow`s per group (rows `exercise-picker-group-row-<groupExerciseId>`, status text "linked: …" / "not linked"), and the `Groups` switch beside the filter, a chip solid `ink` while on (`exercise-picker-groups-toggle`); 08 pattern 10
  - `GroupExercisePickSheet` (M25-T07) — in-route bottom `Modal` for an unlinked group exercise: suggestion, `Choose another of your exercises…` (search; exercises already linked in the group are disabled with the reason), `Add "<name>" as a new exercise`, the retroactivity and weight-entry notes, `Link and add` with an inline error; in `choose-linked` mode it lists my linked exercises to add. testIDs `group-pick-sheet`, `group-pick-sheet-option-*`, `group-pick-sheet-choice-<id>`, `group-pick-sheet-confirm`; `purpose="link-only"` (M25-T08 group page) confirms with `Link` and adds nothing to a session
  - `GroupStateView`, `GroupLoadingState`, `GroupsEmptyState` (children slot for `GroupsEmptyActions`), `GroupMissingDataState`, `GroupInlineError`, `GroupsSignInRequired` — feature-scoped state panels, thin wrappers over `StatePanel` (inline; the sign-in panel centres on the page) since DLM-T11, so their call sites did not change; `GroupInlineError` is a `danger` `Notice` with an outline `Retry`
  - `groupScreenStyles` (`screen-styles.ts`) — the group routes' page shell: `paper`, the `lg` gutter and `md` between blocks, as `Screen` / `ScreenScroll`, for the `FlatList`s and the routes not yet on `ScreenScroll` (DLM-T11). `groupFormStyles` in the same file is still legacy (DLM-T13)
  - `usePullToRefresh`, `groupScreenStyles`, `groupFormStyles` — pull spinner state, the shared page shell and action row, and the write-form field styles

12. Exercise core fields (M25)
- File: `apps/mobile/components/exercise-core/exercise-core-fields.tsx`
- Purpose:
  - `ExerciseCoreFields` — the exercise-name input and the `Total load` / `Per side` weight-entry control (labels from `LOAD_INPUT_MODE_LABELS`), shared by the personal exercise editor (`exercise-catalog/exercise-editor-modal.tsx`) and the group exercise form; both validate with `validateExerciseCore`. testIDs `<prefix>-name-input`, `<prefix>-name-error`, `<prefix>-load-mode-<mode>` (the editor keeps `exercise-editor-*`). In the design language (DLM-T07): a `FormField` (`face="text"`) for the name and a micro-labelled `SegmentedControl` (`<prefix>-load-mode`, `disabled` while not editable) for the weight entry, each segment labelled `<label> weight entry`

13. Exercise page
- Folder: `apps/mobile/components/exercise-page/`; rules in `apps/mobile/src/session-recorder/exercise-page-model.ts`, records in `exercise-records.ts`, persistence in `session-exercise-draft.ts` + `use-session-exercise-draft.ts`
- Purpose:
  - `ExercisePageScreen` — the page's composition (route: `app/session/[sessionId]/exercise/[sessionExerciseId].tsx`)
  - `ExerciseTopBar` — back · title · ⋮, each control a 44pt target
  - `RecordsPanel` — a `Card` with the `Records` | `Last` selector (control radius), the `History` link, three stacked `Stat`s collapsed, record lines or the previous session's sets expanded
  - `SetRow` — the set-row recipe: `ListRow density="list"`, the effort label in `leading`, weight × reps in `children` (the row-body target that opens the logger), the inline 1RM / Vol `Stat`s in `meta`, the set-state glyph (a checkbox) in `trailing`
  - `SetLogger` — the open set in place: Weight / Reps / Effort fields at `uiGeometry.fieldHeight`, the `accent` commit tick on the control axis; effort tap cycles W-Up → blank → configured maximum RIR down to RIR 0, and long press opens `EffortSheet`
  - `EffortSheet`, `ExerciseOptionsSheet` — `Sheet` + `ListRow`; effort includes all configured cycle choices with `None` for blank and scrolls for longer ranges; the options sheet shows `Link to group exercise…` only when its host passes `onLink` (signed in)
  - `ExerciseSwapSheet` — `Sheet` over the shared `ExerciseListContent` / `buildExerciseListModel` and list preferences
  - `pageText` — the page's shared type roles (micro-label, control label, running / detail / headline figures)
  - covered by `app/__tests__/exercise-page-screen.test.tsx`, `exercise-page-model.test.ts`, `exercise-page-persistence.test.ts` and the `ios-exercise-page` lane

14. Exercise picker
- File: `apps/mobile/components/session-recorder/exercise-picker.tsx`
- Purpose:
  - the session view's exercise picker (`+ Add exercise`), its only consumer:
    a tall `Sheet` (`exercise-picker`, keyboard-avoiding; backdrop label
    `Dismiss exercise modal overlay`) titled `Select Exercise` with Manage /
    Add new `IconButton`s,
    search and visible shared Sort/Show never-done controls, the add preselection (`Add empty set`
    outline / `Append plan`, the sheet's one `accent`; the plan's sets as
    planned `SetSummaryRow`s), `From your groups` with its pick sheet, inline create and
    Manage (`/exercise-catalog?source=session&intent=manage`). It only adds —
    there is no replace mode (the exercise page swaps through
    `ExerciseSwapSheet`). It owns its own state and reports a choice
    (`onSelectExercise` / `onAppendPlan` / `onOpenManage`); the host bumps
    `openRequestId` for a fresh open and applies the choice
  - covered by `apps/mobile/app/__tests__/exercise-picker.test.tsx`

15. Session view components
- Folder: `apps/mobile/components/session-view/`
- Purpose:
  - `SessionTopBar` — `mode="active"`: `Session` · ⋮ · `Finish` (`accent`);
    `mode="completed"`: `Edit session` · `Done` (`accent`, testID
    `session-view-done-button`), no ⋮; `mode="complete"`: `Session complete` ·
    `Done` (testID `session-completion-done`) on the completion screen, Done
    omitted on its unavailable states. Under the status bar; the primary is
    an `ActionButton`
  - `SessionSummaryCard` — `Card` with stacked `Stat`s Time (ticking) / Gym /
    Sets / Volume; given `times`, `SessionTimesFields` replace Time
  - `SessionTimesFields` — a completed session's `Start` / `End` text fields
    (`YYYY-MM-DD HH:mm`, the logger's field style: `fieldHeight`,
    `radius.control`, `ruleStrong`, `danger` while invalid), each field's error
    below it and the autosave-paused notice. testIDs `session-view-start-time`,
    `session-view-end-time` (`-error`), `session-view-times-notice`
  - `SessionExerciseCard` — `ExerciseSetsCard` as a link per exercise: name,
    `n/m`, a chevron, the read-only set rows and the `record` band. testID
    `session-view-exercise-<id>` with `-count`, `-set-<n>` (`-values`, `-1rm`,
    `-vol`), `-record`
  - `SessionOptionsSheet` — `Sheet` + one danger `ListRow` (`Abandon session`)
  - `SessionGymSheet` — `Sheet` + `ListRow`s: the optional `Nearby · <gym>`
    suggestion row (its host runs the lookup and passes `suggestion`), `No gym`
    and the gyms with the current one checked, and a `Manage gyms` footer row.
    testIDs `session-view-gym-sheet`, `-suggestion`, `-option-<id>` /
    `-option-none`, `-manage`
  - covered by `apps/mobile/app/__tests__/session-view-screen.test.tsx`

16. Session detail (shared by the session view, View Session and the group session view)
- Folder: `apps/mobile/components/session-detail/`; the row and card models in
  `apps/mobile/src/session-recorder/session-view-model.ts` (`formatSetRow`, one
  set as plain values) and `completed-session-detail-model.ts`
- Purpose:
  - `SetSummaryRow` — one read-only set: effort label, weight × reps
    (`-values`), inline `Stat` 1RM / VOL with legends, all at the row's colour
    and weight; only a record 1RM in `record`; planned rows faded
  - `ExerciseSetsCard` — `Card` per exercise: name, a count, an inline
    `accessory` (the session view's chevron) or a 44pt `control` (View Session's
    ⋮), the set rows and the `record` band (`New 1RM record · <1RM>`). Given
    `onPress` the whole card is one link. testID `<prefix>-count`, `-set-<n>`
    (or the caller's `rowTestID`), `-record`. DLM-T10 added `nameFace="figure"`
    (a date as the name, in Plex Mono) and a `summary` slot under the header
    (exercise history's gym, tags and session `Stat`s)
  - `SessionFactsCard` — `Card` with an optional header slot, a finished
    session's `Start` / `End` read-only (the completed edit's field layout),
    one or more rows of stacked `Stat`s (a `text` fact takes the spare width)
    and an optional footer (the completion's muscle pills)
  - covered by `completed-session-detail-screen.test.tsx`,
    `session-view-screen.test.tsx`, `completed-session-detail-model.test.ts`
    and `exercise-history-screen.test.tsx`

17. View Session (the completed-session detail)
- Folder: `apps/mobile/components/view-session/` (route
  `app/completed-session/[sessionId].tsx`)
- Purpose:
  - `ViewSessionScreen` — the detail's composition on `paper`: top bar, the
    deleted band, an inline write error, `SessionFactsCard`, then the shared
    `SegmentedControl` (`view-session-section-summary` / `-sets`). Summary
    composes `SessionMuscleBreakdown` and `SessionSummaryContent` from
    `components/session-complete/session-summary-content.tsx`; Sets shows one
    `ExerciseSetsCard` per exercise with a ⋮ `control`. The route owns section
    and chart grouping so refocus and section switches retain them. testIDs
    `completed-session-detail-screen`, `-summary`, `-times` (`-start` /
    `-end`), `-duration`, `-gym`, `-sets`, `-volume`, `-deleted-band`,
    `-error-notice`, `-no-exercises`, `-exercise-<id>` (and its `-count`,
    `-set-<n>`, `-record`), `-exercise-options-<id>`
  - `ViewSessionTopBar` — back · `View Session` · ⋮ · `Edit` (`accent`,
    `ActionButton`); ⋮ and Edit omitted while loading, Edit while deleted.
    testIDs `completed-session-detail-back`, `-options-button`, `-edit-button`
  - `ViewSessionOptionsSheet` — `Sheet` `Session`: `Delete session` (danger) or
    `Undelete session`, both `completed-session-detail-delete-button`
  - `ViewSessionExerciseSheet` — `Sheet` titled with the exercise:
    `Append to current session`
    (`completed-session-detail-append-exercise-button-<id>`)
  - covered by `apps/mobile/app/__tests__/completed-session-detail-screen.test.tsx`
    and the `ios-ui-regression` lane (`session-completion-states-fixture`)

18. Gyms
- Folder: `apps/mobile/components/gyms/`; the gym directory and writes in
  `apps/mobile/src/session-recorder/gym-options.ts`, the location reads in
  `apps/mobile/src/location/gym-location-reads.ts`
- Purpose:
  - `GymsScreen` — the Gyms screen's composition (route `app/gyms.tsx`): a
    `Card` of `ListRow density="list"` rows (location glyph, name, `Location
    saved` / `No location saved`), `+ Add gym`, `Show archived` and the
    `Archived` card; takes an injectable `readPosition`. testIDs
    `gyms-screen`, `gyms-list`, `gyms-row-<id>` (`-status`), `gyms-add`,
    `gyms-toggle-archived`, `gyms-archived-list`
  - `GymEditor` — one gym's editor in place of its row: name field at `uiGeometry.fieldHeight`, the location
    status and actions with inline Replace / Clear confirmation and feedback,
    and the `Archive` / `Unarchive` · `Cancel` · `Save` footer. testIDs
    `gym-editor`, `-name`, `-location-status`, `-location-save` / `-replace` /
    `-clear` / `-confirm` / `-cancel`, `-feedback`, `-archive` / `-unarchive`,
    `-cancel`, `-save`
  - covered by `apps/mobile/app/__tests__/gyms-screen.test.tsx`,
    `gym-directory.test.ts`, `gym-location-reads.test.ts` and the
    `ios-session-view` lane

### UI-supporting shared module (non-visual)

1. `session-recorder/types.ts`
- File: `apps/mobile/components/session-recorder/types.ts`
- Purpose:
  - the session/exercise/set/location types and the seeded gyms
    (`SEEDED_LOCATIONS`) shared by the session repository, the session view,
    the exercise page and the Gyms screen

2. `session-list/types.ts` and `session-list/history-data.ts`
- Files:
  - `apps/mobile/components/session-list/types.ts` — `SessionListItem`, `SessionListDataClient`, `DEFAULT_SESSION_LIST_ITEMS`, and the `formatCompactDuration` re-export
  - `apps/mobile/components/session-list/history-data.ts` — `DEFAULT_SESSION_LIST_DATA_CLIENT` and `useSessionListData` (loads/refreshes buckets via the data layer)
- Purpose:
  - shared data plumbing so any screen that needs the session list buckets can
    reuse the same hook and data client without re-implementing repository
    mapping
  - the hook accepts focus enablement as its sole automatic-load trigger and
    generations automatic/explicit requests so superseded or unmounted results
    cannot update the consumer

## Excluded from this catalog (document elsewhere)

- Route-level screen shells (for example `CompletedSessionDetailScreenShell`, `ExerciseHistoryScreenShell`)
  - Document in `docs/specs/ui/screen-map.md` and `docs/specs/ui/navigation-contract.md`
  - Reason: they are route composition/test helpers, not reusable UI building blocks
  - `ExerciseHistoryScreenShell` is exported separately from `apps/mobile/app/exercise-history.tsx` so the per-exercise history surface can be wired from any future route (currently entered from Progress and the preserved `/stats-history` path); the component remains a route-level shell, not a reusable primitive

## Pending / planned (not current components)

Audit-approved candidates (the M8 UI pattern audit, deleted 2026-06-10; in git
history), revisited 2026-09-24 when the exercise/session redesign closed. Build
one only when a screen being moved to the design language asks for it, in the
design-language vocabulary (`uiRoles` / `uiFonts` / `uiGeometry`):

- `IconActionButton` → built as `IconButton`; `EmptyState` / state panels →
  `StatePanel`; `ScreenContainer` / `ScreenScrollContainer` → `Screen` /
  `ScreenScroll`; `FormField` → `FormField` (DLM-T01, 2026-09-24). The group
  state panels (`components/groups/`) wrap `StatePanel` (DLM-T11).
- Covered, no longer pending: `ModalSurface` / `ModalBackdrop` → `Sheet`;
  `PressableRowCard` → `Card` with `onPress`, or `ListRow` with `onPress`.

## Refactor convergence notes (Task `T-20260226-06`)

1. Current user-facing route screens now consume `uiTokens.colors` for route-level screen styles (including modal scrims and status surfaces) instead of screen-local raw color literals.
2. The later M26 navigation cutover replaced the retired `TopLevelTabs` with
   `MainTabs`; current shared primitives/components (`UiButton`, `UiText`,
   `UiSurface`, `MainTabs`, `BottomTray`) remain the
   canonical reuse surface.
3. Some repeated button/row/modal patterns remain route-local one-offs to avoid behavioral churn; they stay tracked as candidate primitives in the pending list above.

## Maintenance rule

If a task adds/removes/renames reusable UI components or changes their role, update this doc in the same session.
