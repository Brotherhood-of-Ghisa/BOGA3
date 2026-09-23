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
  - shared exercise-catalog editing UI reused across route and recorder flows
- `apps/mobile/components/session-recorder/`
  - shared session-recorder/session-detail UI composition components and supporting UI modules
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
    matching `lineHeight` per size, 6 spacing steps, 3 radii) plus `uiElevation`
    (`flat` / `raised` / `overlay`); values and rationale: `docs/specs/ui/ux-rules.md` §9a
  - also carries the design-language vocabularies, adopted so far only by the exercise
    page and the session view (behind the new-screens setting): `uiRoles` (colour roles), `uiFonts` (the three embedded typefaces
    and their shipped weights) and `uiGeometry` (card / sheet / control radii,
    the 44pt tap target, the 38pt metric column, the sheet handle, the 50pt
    labelled-field height, micro-label tracking); rationale:
    `docs/specs/ui/design-language.md` §2–§4
  - `uiIconSize` (`xs` 12 / `sm` 16 / `md` 20 / `lg` 24), the icon edge lengths
    `Icon` takes

2. `UiText`
- File: `apps/mobile/components/ui/text.tsx`
- Purpose:
  - shared text primitive for semantic text roles used across reusable UI components

3. `UiSurface`
- File: `apps/mobile/components/ui/surface.tsx`
- Purpose:
  - shared surface/card/panel wrapper for bordered rounded containers
  - optional `elevation` prop (`flat` default / `raised` / `overlay`) over
    `uiElevation`; `flat` adds no style keys, so existing callers are unchanged

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

6. Design-language primitives: `Card`, `Stat`, `ListRow`, `Sheet`
- Files: `apps/mobile/components/ui/card.tsx`, `stat.tsx`, `list-row.tsx`, `sheet.tsx`
- Purpose:
  - the building blocks of the exercise page and session view, drawn from
    `uiRoles` / `uiFonts` / `uiGeometry` only (`docs/specs/ui/design-language.md`);
    adopted by the exercise page (`components/exercise-page/`) and the session view
    (`components/session-view/`), behind the new-screens setting
  - `Card` — `surface` on `paper`, 1px `rule`, card radius, no shadow, no
    padding (content owns its insets); with `onPress` the whole card is one
    labelled `link` target
  - `Stat` — a micro-label legend with a monospaced value; `stacked` (label
    above value: summary card, records panel) or `inline` (legend left of the
    fixed-width right-aligned metric column: the set row, `rank` primary 1RM /
    secondary VOL); `state="planned"` fades it, `emphasis` `best` (bold `ink`)
    or `record` (bold `record`); `kind="text"` for a non-figure value
  - `ListRow` — `[leading][label or children][meta][trailing]`, the trailing
    control always in a fixed tap-target-wide column so controls share one
    vertical axis; `density` `sheet` (option rows) or `list` (dense rows in a
    card, e.g. the set row); `selected` (`accent-wash`), `tone="danger"`,
    `divider`; pressable as one row only when given `onPress`. The trailing
    control is a slot, so the row carries no icon dependency
  - `Sheet` — bottom-anchored panel over a `scrim` backdrop, sheet radius,
    38×4 handle, optional title; the backdrop tap, Android back and the
    VoiceOver escape gesture dismiss it — there is no Cancel button
  - covered by `apps/mobile/app/__tests__/ui-design-primitives.test.tsx`

7. `Icon`
- Files: `apps/mobile/components/ui/icon.tsx`, `icon-glyphs.ts` (geometry),
  `LICENSE.lucide`
- Purpose:
  - the app's icon set: `<Icon name size color label testID />` over
    `react-native-svg`. `name` is a closed union (`IconName`); `size` a
    `uiIconSize` key (default `md`); `color` a token value (default
    `uiColors.textPrimary`)
  - decorative by default (hidden from assistive tech, never takes touches); a
    `label` makes it an accessible image, for the rare icon no surrounding text
    or control label explains
  - `delete` (Lucide `trash-2`) marks a destructive menu option
  - geometry is vendored from Lucide 1.47.0 (ISC; notice in `LICENSE.lucide`),
    plus `chevron-left` (back), `pencil` (edit), `swap` (Lucide
    `arrow-left-right`) and `trash` (Lucide `trash-2`) for the exercise page,
    plus BoGa glyphs: `caret-down`, `radio-on` / `radio-off`, and the
    design-language §5 set-state glyphs `set-done` (filled `ink` disc, knocked-out
    check), `set-current` (`accent` ring), `set-planned` (dashed `planned` ring),
    which carry their role colour by default and are meant for `ListRow`'s
    trailing slot on the set row (step 4). Add icons from the same Lucide
    release, named by role
  - replaced the improvised Unicode glyphs on every shipped screen except the
    recorder (deleted by the exercise/session rebuild); `app/__tests__/ui-icon.test.tsx`
    fails if a retired glyph comes back

8. `ui` barrel exports
- File: `apps/mobile/components/ui/index.ts`
- Purpose:
  - single import entrypoint for current tokens and UI primitives

### Specialized shared components (reusable, not generic primitives)

1. `BottomTray`
- File: `apps/mobile/components/navigation/bottom-tray.tsx`
- Purpose:
  - collapsible bottom navigation tray that wraps `MainTabs`; exposes a drag handle (React Native `PanResponder` + `Animated`) to collapse to a peek strip and `useTrayVisibility()` hook plus `TrayVisibilityProvider` so screens can imperatively expand/collapse
  - remains mounted in focused recorder contexts and collapses to its peek
    handle on recorder entry
  - snap math lives in the pure helper `apps/mobile/src/navigation/tray-snap.ts` so it can be unit-tested without gesture plumbing

2. `MainTabs`
- File: `apps/mobile/components/navigation/main-tabs.tsx`
- Purpose:
  - token-backed, accessible four-tab presentation for `Today`, `Train`,
    `Progress`, and `More`, driven by the single declarative model in
    `apps/mobile/src/navigation/main-tabs.ts`
  - production navigation body inside `BottomTray` and the matching direct
    navigation strip on the `exercise-history` detail screen
  - the non-visual model owns canonical order, labels, routes, test IDs,
    canonical/legacy ownership resolution, unknown-route null fallback, and
    focused-recorder collapse behavior

3. `MoreHubBackButton`
- File: `apps/mobile/components/navigation/more-hub-back-button.tsx`
- Purpose:
  - source-aware `Back to More` action shared by the tab-owned Exercise
    Catalog and Settings destinations; renders only for `source=more` and
    replaces to the hub (Groups does not use it)

4. `ExerciseEditorModal`
- File: `apps/mobile/components/exercise-catalog/exercise-editor-modal.tsx`
- Purpose:
  - shared create/edit exercise editor modal reused by `exercise-catalog` and `session-recorder` add-new flow
  - optional `prefill` (name, weight entry, muscles for a new exercise), `onSave` (replaces the default save; a rejection shows inline), and `title` (M25-T07: the recorder's group `Add as new` prefills from the group exercise and saves through `createExerciseWithGroupLink`); the fields are unchanged

5. `ExerciseListContent` / `ExerciseListPreferenceControls`
- File: `apps/mobile/components/exercise-catalog/exercise-list-controls.tsx`
- Purpose:
  - shared exercise list row/header rendering and shared grouping/date-range/recents controls for `exercise-catalog` and the `session-recorder` exercise picker
  - composes the non-visual list model/preference modules under `apps/mobile/src/exercise-catalog/` so both surfaces share grouping, filtering, sorting, row stats, collapsed-group state behavior, and local-only preference behavior while each route keeps its surface-specific actions

6. `SessionContentLayout`
- File: `apps/mobile/components/session-recorder/session-content-layout.tsx`
- Purpose:
  - shared layout scaffold for session exercise/set content used by `session-recorder` and completed-session detail screens
  - supports optional per-exercise metadata injection (`renderExerciseMeta`) so recorder mode can render tag chips/actions without duplicating card structure
  - supports optional per-exercise collapse state and a caller-provided collapsed-summary renderer while preserving header actions outside the hidden body
  - exports `ExerciseCardCollapsedSummary` for the shared performed-set/working-set presentation and optional collapsed `ExercisePersonalRecordCelebration`

7. `SessionMuscleLoad`
- File: `apps/mobile/components/session-recorder/session-muscle-load.tsx`
- Purpose:
  - reusable active-session compact summary and in-route detail sheet over the shared current-session muscle calculation
  - owns mapped, partially mapped, unmapped, catalog loading/error/retry, accessible exact-volume, relative-bar, dismissal, and reversal-close presentation while the recorder route supplies live counts and data

8. `ExercisePersonalRecordCelebration`
- File: `apps/mobile/components/session-recorder/exercise-personal-record-celebration.tsx`
- Purpose:
  - reusable, non-interactive exercise-scoped success surface for a shared `ExercisePersonalRecord`, with exercise, best-set, and rounded estimated-1RM facts in expanded, collapsed, or compact-completion form

9. `SessionCompletionPresentation`
- File: `apps/mobile/components/session-recorder/session-completion-presentation.tsx`
- Purpose:
  - shared post-submit and historical-summary composition with one consolidated
    totals/muscle-working-set card, every compact PR, every per-exercise volume
    comparison, and the session-image share preview
  - muscle chips are informational views rather than analytics links; Done is
    supplied only by the post-submit caller, while historical navigation stays
    in the route header
  - keeps all PRs visible together instead of paging them

10. `ExerciseVolumeComparisonRow`
- File: `apps/mobile/components/session-recorder/exercise-volume-comparison.tsx`
- Purpose:
  - presents exercise name, performed/working-set counts, current entered volume
    versus median, and descriptive P5/P95 range or explicit sparse-history state
  - reused by in-app completion and the captured share card

11. `SessionSharePreview` / `SessionShareCard`
- File: `apps/mobile/components/session-recorder/session-share-preview.tsx`
- Purpose:
  - previews the exact privacy-limited session card captured to PNG and opens the
    native image share sheet with inline retry and temporary-file cleanup
  - includes all PRs and exercise comparisons, but never gym/location data

12. `SessionSummaryLine`
- File: `apps/mobile/components/session-list/session-summary-line.tsx`
- Purpose:
  - shared two-line summary row (date/duration/gym + sets/exercises) reused by
    `ActiveSessionRow`, `HistoryList`, Today recents, and Progress history

13. `ActiveSessionRow`
- File: `apps/mobile/components/session-list/active-session-row.tsx`
- Purpose:
  - active-session row plus its overflow menu (resume / complete / delete) used
    by session-list consumers

14. `HistoryList`
- File: `apps/mobile/components/session-list/history-list.tsx`
- Purpose:
  - completed-session history list with delete/undelete modal and deleted-visibility toggle, consumed by the `stats-history` History sub-view

15. `DailyHeatmap` / `WeeklyHeatmap`
- Files: `apps/mobile/components/heatmaps/DailyHeatmap.tsx`, `apps/mobile/components/heatmaps/WeeklyHeatmap.tsx`
- Purpose:
  - reusable daily-cell and weekly-bar views over the same `HeatmapData`, used by both muscle- and exercise-history overlays
  - renders horizontally scrollable one-year history with token-backed zero/green/today/selected states and tappable accessible cells
  - the Stats overlay integration keeps both views mounted, with the inactive view transparent, non-interactive, and accessibility-hidden, so toggling does not rebuild the chart tree

15. Group components (M22)
- Folder: `apps/mobile/components/groups/` (barrel `index.ts`); data comes from `@/src/groups` hooks and the pure view model
- Purpose:
  - `GroupStreamSessionCard` — the stream card (member, status pill, start · gym, sets · kg · exercises computed on the device, the `N records` label (M25-T10, `-records`), group names in All); one press target
  - `GroupStreamMembershipItem` — "X joined / left the group / was removed" row; pressable only where it opens another screen
  - `GroupFilterChips` — one `SegmentedChips` chip per group, exactly one selected (no `All`), wrapping rather than scrolling sideways; the Groups screen's group selector
  - `GroupStreamList` — `FlatList` with `RefreshControl`, online older-page loading, and a Retry footer; (M25-T10) it renders every stream kind and owns the one certification write state (`useRecordSetCertification`) shared by the inline `Certify` buttons and the row detail sheet
  - `GroupStreamRecordCard` (M25-T10) — a record card under its session card (indented): title (`dave — group record` / `— PR`), group exercise and value, board badges, `Session in progress`, the status via `GroupCertificationStatus` (`Not certified yet` / `Certified by …` / `Voided · set …`, first and on the muted panel when voided), and its group where names are shown (Today); the summary is one press target (opens the sheet, or on Today the Groups screen via `pressHint`), and `Certify` sits beside it with its inline notice. Without `onCertify` (Today) the card is read-only. testID `group-stream-record-card-<key>` with `-open`, `-title`, `-value`, `-provisional`, `-status`, `-group`, `-certify`, `-notice`
  - `GroupStreamSentenceItem` (M25-T10) — a record-removed or link item: a light row with one sentence, not pressable. testIDs `group-stream-record-removed-<key>` / `group-stream-link-<key>` with `-sentence`
  - `RecordSetSheet` (M25-T10) — the row detail (E2) shared by record cards and board rows: an in-route bottom `Modal` with the value, logged, date · gym, logged-as, provisional and status lines, the lifter note, the write notice, the actions my relationship allows (`Certify` primary; `Remove my certification` / `Cancel certification` danger, confirmed with `Alert.alert`), `View full session`, and `Close`. Gym and logged-as come from the `session:<memberId>:<sessionId>` resource. testIDs `group-record-sheet` with `-overlay`, `-title`, `-value`, `-logged`, `-date`, `-logged-as`, `-provisional`, `-status`, `-lifter-note`, `-notice`, `-certify`, `-withdraw`, `-cancel`, `-view-session`, `-close`
  - `GroupOfflineBanner` — the `Offline · last updated HH:MM` marker
  - `GroupMemberRow`, `GroupSummaryRow` — Members-screen and My groups rows; `GroupMemberRow` takes an optional `onPress` (set only when my role offers actions on that member) and then shows a chevron
  - `GroupMemberActionSheet` (M22-T05) — `GroupActionSheet` for one member offering exactly `groupMemberActionsFor(myRole, me, member)` (contract §4.3): `Make admin` / `Remove admin` (secondary), `Transfer ownership` / `Remove from group` (danger; the caller confirms with `Alert.alert`), `Cancel`. testIDs `group-member-actions-sheet`, `group-member-action-<action>`
  - `GroupActionSheet` (M25-T08) — the in-route bottom `Modal` behind both action sheets: title, optional subtitle, one button per action (danger when destructive), `Cancel`. testIDs `<prefix>-sheet` / `-overlay` / `-cancel` and `<actionPrefix>-<key>`
  - `GroupExercisesPage` (M25-T08) — the group screen's Exercises section: rows, empty and missing-data states, owner/admin `Add exercise`, and the exercise sheet (`Rename` / `Archive` / `Unarchive`)
  - `GroupExerciseRow` (M25-T08) — name, weight entry, my link status (`Linked: …` / `Not linked`), and an `Archived` badge; pressable with a chevron for owner/admin only; an optional `Link your exercise` button (`group-exercise-link-button-<id>`) sits outside that press target
  - `GroupExerciseForm` (M25-T08) — the add / edit group-exercise form over `ExerciseCoreFields`, validated by `validateExerciseCore`, with the write's failure above the submit button
  - `StandardExercisePicker` (M25-T08) — search and list of the bundled standard exercises to copy into a group
  - `GroupLostAccessState` (M25-T08) — the shared "You're no longer a member of this group" panel
  - `GroupLeaderboardsPage`, `GroupPodiumCard` (M25-T09) — the Groups screen's Leaderboards segment: one whole-card press target per group exercise (name, view label, `Archived` tag, up to three podium rows, empty label, `You: …`). testIDs `group-leaderboards-page`, `group-leaderboards-empty`, `group-podium-card-<exerciseId>` with `-name`, `-view`, `-archived`, `-row-<rank>`, `-empty`, `-you`
  - `GroupCertificationStatus` — a record's certification state: a check `Icon` (certified), a ring (not yet) or none (voided) beside its label; the label keeps the caller's testID. Used by `GroupStreamRecordCard`, `RecordSetSheet` and `GroupBoardRow`
  - `GroupBoardRow` (M25-T09) — one full-board row as a single accessibility element (rank, member, value, e1RM detail, date, the certification mark on All); my row on the muted panel; (M25-T10) a press target that opens the row detail sheet. testID `group-board-row-<rank>` with `-member`, `-value`, `-detail`, `-date`, `-mark` (the icon `-mark-certified` / `-mark-uncertified`)
  - `GroupBoardHistoryItem` (M25-T09) — one lead change: date and sentence. testID `group-board-history-item-<seq>` with `-date`, `-sentence`
  - `GroupPagesFooter` (M25-T09) — the footer of an online paged list: a spinner, or the failure with `Retry` (`<prefix>-loading-more`, `-load-more-error`, `-load-more-retry`)
  - `UsernameGate` + `useUsernameGate(userId)` (M22-T05) — the inline username field shown before create / join when the profile username is blank (`loadUserProfile` / `saveUsername`); errors inline under the field; `require(notice)` re-opens it on a server `USERNAME_REQUIRED`; a profile that fails to load does not block the form
  - `GroupDetailsForm` (M22-T05) — the shared create / edit form: name (1–50) and optional description (≤280, counter) with inline validation, the write's failure above the submit button
  - `GroupWriteNotice` (M22-T05) — inline error / success outcome of a group write
  - `GroupsEmptyActions` (M22-T05) — the empty state's `Create group` / `Join with a code` buttons
  - `FriendSessionContent` — the friend's session body composing `SessionContentLayout` read-only
  - `PickerGroupSectionList`, `PickerGroupsToggle` (M25-T07) — the recorder picker's `From your groups` section (rows `exercise-picker-group-row-<groupExerciseId>`, status text "linked: …" / "not linked") and the `Groups` switch beside the filter (`exercise-picker-groups-toggle`); 08 pattern 10
  - `GroupExercisePickSheet` (M25-T07) — in-route bottom `Modal` for an unlinked group exercise: suggestion, `Choose another of your exercises…` (search; exercises already linked in the group are disabled with the reason), `Add "<name>" as a new exercise`, the retroactivity and weight-entry notes, `Link and add` with an inline error; in `choose-linked` mode it lists my linked exercises to add. testIDs `group-pick-sheet`, `group-pick-sheet-option-*`, `group-pick-sheet-choice-<id>`, `group-pick-sheet-confirm`; `purpose="link-only"` (M25-T08 group page) confirms with `Link` and adds nothing to a session
  - `GroupStateView`, `GroupsEmptyState` (children slot for `GroupsEmptyActions`), `GroupMissingDataState`, `GroupInlineError`, `GroupsSignInRequired` — feature-scoped state panels (not the pending generic `EmptyState`)
  - `usePullToRefresh`, `groupScreenStyles`, `groupFormStyles` — pull spinner state, the shared page shell and action row, and the write-form field styles

14. Exercise core fields (M25)
- File: `apps/mobile/components/exercise-core/exercise-core-fields.tsx`
- Purpose:
  - `ExerciseCoreFields` — the exercise-name input and the `Total load` / `Per side` weight-entry control (labels from `LOAD_INPUT_MODE_LABELS`), shared by the personal exercise editor (`exercise-catalog/exercise-editor-modal.tsx`) and the group exercise form; both validate with `validateExerciseCore`. testIDs `<prefix>-name-input`, `<prefix>-name-error`, `<prefix>-load-mode-<mode>` (the editor keeps `exercise-editor-*`)

16. Exercise page (exercise/session redesign step 4)
- Folder: `apps/mobile/components/exercise-page/`; rules in `apps/mobile/src/session-recorder/exercise-page-model.ts`, records in `exercise-records.ts`, persistence in `session-exercise-draft.ts` + `use-session-exercise-draft.ts`
- Purpose:
  - `ExercisePageScreen` — the page's composition (route: `app/session/[sessionId]/exercise/[sessionExerciseId].tsx`)
  - `ExerciseTopBar` — back · title · ⋮, each control a 44pt target
  - `RecordsPanel` — a `Card` with the `Records` | `Last` selector (control radius), the `History` link, three stacked `Stat`s collapsed, record lines or the previous session's sets expanded
  - `SetRow` — the set-row recipe: `ListRow density="list"`, the effort label in `leading`, weight × reps in `children` (the row-body target that opens the logger), the inline 1RM / Vol `Stat`s in `meta`, the set-state glyph (a checkbox) in `trailing`
  - `SetLogger` — the open set in place: Weight / Reps / Effort fields at `uiGeometry.fieldHeight`, the `accent` commit tick on the control axis
  - `EffortSheet`, `ExerciseOptionsSheet` — `Sheet` + `ListRow`
  - `ExerciseSwapSheet` — `Sheet` over the shared `ExerciseListContent` / `buildExerciseListModel` and list preferences
  - `pageText` — the page's shared type roles (micro-label, control label, running / detail / headline figures)
  - covered by `app/__tests__/exercise-page-screen.test.tsx`, `exercise-page-model.test.ts`, `exercise-page-persistence.test.ts` and the `ios-exercise-page` lane

17. Exercise picker
- File: `apps/mobile/components/session-recorder/exercise-picker.tsx`
- Purpose:
  - the recorder's exercise picker, extracted so the session view's
    `+ Add exercise` reuses it: search and shared list options, the add
    preselection (`Add empty set` / `Append plan`), `From your groups` with its
    pick sheet, inline create and Manage. It owns its own state and reports a
    choice (`onSelectExercise` / `onAppendPlan` / `onOpenManage`); the host
    bumps `openRequestId` for a fresh open and applies the choice

18. Session view components
- Folder: `apps/mobile/components/session-view/`
- Purpose:
  - `SessionTopBar` — `Session` · ⋮ · `Finish` (`accent`), under the status bar
  - `SessionSummaryCard` — `Card` with stacked `Stat`s Time (ticking) / Gym /
    Sets / Volume
  - `SessionExerciseCard` — `Card` link per exercise: name, `n/m`, read-only set
    rows (type · weight × reps · inline `Stat` 1RM / VOL with legends, all at
    the row's colour and weight; only a record 1RM in `record`), and the
    `record` band. testID `session-view-exercise-<id>` with `-count`, `-set-<n>`,
    `-record`
  - `SessionOptionsSheet` — `Sheet` + one danger `ListRow` (`Abandon session`)
  - `OutlineButton` — the ink-outline secondary action (`+ Add exercise`)
  - covered by `apps/mobile/app/__tests__/session-view-screen.test.tsx`

### UI-supporting shared module (non-visual)

1. `session-recorder/types.ts`
- File: `apps/mobile/components/session-recorder/types.ts`
- Purpose:
  - shared UI state/types/constants used by the session-recorder screen flow

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

Audit-approved candidates that are not yet implemented/finalized:

- `ScreenContainer` / `ScreenScrollContainer`
- `EmptyState` / state panels
- `ModalSurface` / `ModalBackdrop`
- `FormField`
- `PressableRowCard`
- `IconActionButton`

Reference: the M8 UI pattern audit (deleted 2026-06-10; in git history)

## Refactor convergence notes (Task `T-20260226-06`)

1. Current user-facing route screens now consume `uiTokens.colors` for route-level screen styles (including modal scrims and status surfaces) instead of screen-local raw color literals.
2. The later M26 navigation cutover replaced the retired `TopLevelTabs` with
   `MainTabs`; current shared primitives/components (`UiButton`, `UiText`,
   `UiSurface`, `MainTabs`, `BottomTray`, `SessionContentLayout`) remain the
   canonical reuse surface.
3. Some repeated button/row/modal patterns remain route-local one-offs to avoid behavioral churn; they stay tracked as candidate primitives in the pending list above.

## Maintenance rule

If a task adds/removes/renames reusable UI components or changes their role, update this doc in the same session.
