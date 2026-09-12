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
  - shared building blocks originally extracted from the retired session-list screen (summary line, active-session row, history list, data hook); now consumed by the `stats-history` History sub-view and the Log tab
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

2. `UiText`
- File: `apps/mobile/components/ui/text.tsx`
- Purpose:
  - shared text primitive for semantic text roles used across reusable UI components

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

6. `ui` barrel exports
- File: `apps/mobile/components/ui/index.ts`
- Purpose:
  - single import entrypoint for current tokens and UI primitives

### Specialized shared components (reusable, not generic primitives)

1. `TopLevelTabs`
- File: `apps/mobile/components/navigation/top-level-tabs.tsx`
- Purpose:
  - app-specific top-level `History`, `Log`, `Exercises`, `Groups` tab strip with a right-side `Settings` utility action (fixed 12 pt labels so four tabs fit a 375 pt phone); used as the body of `BottomTray` inside `(tabs)/_layout.tsx`, and rendered directly by detail screens (`exercise-history`) until they migrate into the tabs group

2. `BottomTray`
- File: `apps/mobile/components/navigation/bottom-tray.tsx`
- Purpose:
  - collapsible bottom navigation tray that wraps `TopLevelTabs`; exposes a drag handle (React Native `PanResponder` + `Animated`) to collapse to a peek strip and `useTrayVisibility()` hook plus `TrayVisibilityProvider` so screens can imperatively expand/collapse
  - snap math lives in the pure helper `apps/mobile/src/navigation/tray-snap.ts` so it can be unit-tested without gesture plumbing

3. `ExerciseEditorModal`
- File: `apps/mobile/components/exercise-catalog/exercise-editor-modal.tsx`
- Purpose:
  - shared create/edit exercise editor modal reused by `exercise-catalog` and `session-recorder` add-new flow

4. `ExerciseListContent` / `ExerciseListPreferenceControls`
- File: `apps/mobile/components/exercise-catalog/exercise-list-controls.tsx`
- Purpose:
  - shared exercise list row/header rendering and shared grouping/date-range/recents controls for `exercise-catalog` and the `session-recorder` exercise picker
  - composes the non-visual list model/preference modules under `apps/mobile/src/exercise-catalog/` so both surfaces share grouping, filtering, sorting, row stats, collapsed-group state behavior, and local-only preference behavior while each route keeps its surface-specific actions

5. `SessionContentLayout`
- File: `apps/mobile/components/session-recorder/session-content-layout.tsx`
- Purpose:
  - shared layout scaffold for session exercise/set content used by `session-recorder` and completed-session detail screens
  - supports optional per-exercise metadata injection (`renderExerciseMeta`) so recorder mode can render tag chips/actions without duplicating card structure
  - supports optional per-exercise collapse state and a caller-provided collapsed-summary renderer while preserving header actions outside the hidden body
  - exports `ExerciseCardCollapsedSummary` for the shared performed-set/working-set presentation and optional live PR line

6. `SessionMuscleLoad`
- File: `apps/mobile/components/session-recorder/session-muscle-load.tsx`
- Purpose:
  - reusable active-session compact summary and in-route detail sheet over the shared current-session muscle calculation
  - owns mapped, partially mapped, unmapped, catalog loading/error/retry, accessible exact-volume, relative-bar, dismissal, and reversal-close presentation while the recorder route supplies live counts and data

7. `SessionSummaryLine`
- File: `apps/mobile/components/session-list/session-summary-line.tsx`
- Purpose:
  - shared two-line summary row (date/duration/gym + sets/exercises) reused by `ActiveSessionRow` and `HistoryList`, and available to the upcoming Stats/History and Log tabs

8. `ActiveSessionRow`
- File: `apps/mobile/components/session-list/active-session-row.tsx`
- Purpose:
  - active-session row plus its overflow menu (resume / complete / delete) used by the Log tab

9. `HistoryList`
- File: `apps/mobile/components/session-list/history-list.tsx`
- Purpose:
  - completed-session history list with delete/undelete modal and deleted-visibility toggle, consumed by the `stats-history` History sub-view

10. `DailyHeatmap` / `WeeklyHeatmap`
- Files: `apps/mobile/components/heatmaps/DailyHeatmap.tsx`, `apps/mobile/components/heatmaps/WeeklyHeatmap.tsx`
- Purpose:
  - reusable daily-cell and weekly-bar views over the same `HeatmapData`, used by both muscle- and exercise-history overlays
  - renders horizontally scrollable one-year history with token-backed zero/green/today/selected states and tappable accessible cells
  - the Stats overlay integration keeps both views mounted, with the inactive view transparent, non-interactive, and accessibility-hidden, so toggling does not rebuild the chart tree

11. Group components (M22)
- Folder: `apps/mobile/components/groups/` (barrel `index.ts`); data comes from `@/src/groups` hooks and the pure view model
- Purpose:
  - `GroupStreamSessionCard` — the stream card (member, status pill, start · gym, sets · kg · exercises computed on the device, group names in All); one press target
  - `GroupStreamMembershipItem` — "X joined / left the group / was removed" row; pressable only where it opens another screen
  - `GroupFilterChips` — `All` + per-group `SegmentedChips`, wrapping rather than scrolling sideways
  - `GroupStreamList` — `FlatList` with `RefreshControl`, online older-page loading, and a Retry footer
  - `GroupOfflineBanner` — the `Offline · last updated HH:MM` marker
  - `GroupMemberRow`, `GroupSummaryRow` — Members-segment and My groups rows; `GroupMemberRow` takes an optional `onPress` (set only when my role offers actions on that member) and then shows a chevron
  - `GroupMemberActionSheet` (M22-T05) — in-route bottom `Modal` for one member offering exactly `groupMemberActionsFor(myRole, me, member)` (contract §4.3): `Make admin` / `Remove admin` (secondary), `Transfer ownership` / `Remove from group` (danger; the caller confirms with `Alert.alert`), `Cancel`. testIDs `group-member-actions-sheet`, `group-member-action-<action>`
  - `UsernameGate` + `useUsernameGate(userId)` (M22-T05) — the inline username field shown before create / join when the profile username is blank (`loadUserProfile` / `saveUsername`); errors inline under the field; `require(notice)` re-opens it on a server `USERNAME_REQUIRED`; a profile that fails to load does not block the form
  - `GroupDetailsForm` (M22-T05) — the shared create / edit form: name (1–50) and optional description (≤280, counter) with inline validation, the write's failure above the submit button
  - `GroupWriteNotice` (M22-T05) — inline error / success outcome of a group write
  - `GroupsEmptyActions` (M22-T05) — the empty state's `Create group` / `Join with a code` buttons
  - `FriendSessionContent` — the friend's session body composing `SessionContentLayout` read-only
  - `GroupStateView`, `GroupsEmptyState` (children slot for `GroupsEmptyActions`), `GroupMissingDataState`, `GroupInlineError`, `GroupsSignInRequired` — feature-scoped state panels (not the pending generic `EmptyState`)
  - `usePullToRefresh`, `groupScreenStyles`, `groupFormStyles` — pull spinner state, the shared page shell and action row, and the write-form field styles

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
  - `ExerciseHistoryScreenShell` is exported separately from `apps/mobile/app/exercise-history.tsx` so the per-exercise history surface can be wired from any future route (currently entered from `/stats-history`); the component remains a route-level shell, not a reusable primitive

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
2. No reusable primitives were removed in Task `T-20260226-06`; existing shared primitives/components (`UiButton`, `UiText`, `UiSurface`, `TopLevelTabs`, `BottomTray`, `SessionContentLayout`) remain the canonical reuse surface.
3. Some repeated button/row/modal patterns remain route-local one-offs to avoid behavioral churn; they stay tracked as candidate primitives in the pending list above.

## Maintenance rule

If a task adds/removes/renames reusable UI components or changes their role, update this doc in the same session.
