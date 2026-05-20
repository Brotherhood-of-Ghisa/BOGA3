# Components Catalog (Authoritative Current UI Components)

## Purpose

Brief entrypoint inventory of the current reusable UI component set.

- This doc answers: "what exists, where it lives, and what it is for?"
- Source files remain the authority for exact props, variants, and implementation details.

## Sources

- UI docs index: `docs/specs/ui/README.md`
- UI pattern audit (candidate rationale): `docs/specs/ui/ui-pattern-audit.md`
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

## Current component set (authoritative)

### Tokens and primitive exports

1. `uiTokens` (and token groups)
- File: `apps/mobile/components/ui/tokens.ts`
- Purpose:
  - single source of truth for shared UI token values (colors, spacing, radius, typography, border)
  - includes the shared semantic/status/overlay color palette used by current route screens after the M8 convergence refactor (Task `T-20260226-06`)

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

5. `ui` barrel exports
- File: `apps/mobile/components/ui/index.ts`
- Purpose:
  - single import entrypoint for current tokens and UI primitives

### Specialized shared components (reusable, not generic primitives)

1. `TopLevelTabs`
- File: `apps/mobile/components/navigation/top-level-tabs.tsx`
- Purpose:
  - app-specific top-level Sessions/Exercises tab strip with a right-side `Settings` utility action, used on `session-list` and `exercise-catalog`

2. `ExerciseEditorModal`
- File: `apps/mobile/components/exercise-catalog/exercise-editor-modal.tsx`
- Purpose:
  - shared create/edit exercise editor modal reused by `exercise-catalog` and `session-recorder` add-new flow

3. `SessionContentLayout`
- File: `apps/mobile/components/session-recorder/session-content-layout.tsx`
- Purpose:
  - shared layout scaffold for session exercise/set content used by `session-recorder` and completed-session detail screens
  - supports optional per-exercise metadata injection (`renderExerciseMeta`) so recorder mode can render tag chips/actions without duplicating card structure

### UI-supporting shared module (non-visual)

1. `session-recorder/types.ts`
- File: `apps/mobile/components/session-recorder/types.ts`
- Purpose:
  - shared UI state/types/constants used by the session-recorder screen flow

## Excluded from this catalog (document elsewhere)

- Route-level screen shells (for example `SessionListScreenShell`, `CompletedSessionDetailScreenShell`, `ExerciseHistoryScreenShell`)
  - Document in `docs/specs/ui/screen-map.md` and `docs/specs/ui/navigation-contract.md`
  - Reason: they are route composition/test helpers, not reusable UI building blocks
  - `ExerciseHistoryScreenShell` is exported separately from `apps/mobile/app/exercise-history.tsx` so the per-exercise history surface can be wired from any future route (currently entered from `/stats`); the component remains a route-level shell, not a reusable primitive

## Pending / planned (not current components)

Audit-approved candidates that are not yet implemented/finalized:

- `ScreenContainer` / `ScreenScrollContainer`
- `EmptyState` / state panels
- `ModalSurface` / `ModalBackdrop`
- `FormField`
- `PressableRowCard`
- `IconActionButton`

Reference: `docs/specs/ui/ui-pattern-audit.md`

### Navigation-redesign target components (plan: `docs/plans/navigation-redesign/plan.md`, tasks t3 and t7)

None of the entries below exist today; they describe the component contract the navigation-redesign tasks will land. Until the tasks land, the current `TopLevelTabs` entry above remains authoritative.

1. `SegmentedChips` (planned — t3)
- File: `apps/mobile/components/ui/segmented-chips.tsx`
- Purpose:
  - shared UI primitive for chip-style segmented selectors
  - typed API for a list of options, a `selected` value, an `onSelect` callback, and a `testIdPrefix`
  - accessibility roles match today's `tablist` / `tab` usage already inlined in `apps/mobile/app/stats.tsx:104-122` (period selector)
- Initial consumers:
  - the `stats.tsx` period selector (refactored to consume the primitive with no visible behavior change)
  - the planned `Stats ↔ History` toggle inside the `/stats-history` tab root (t5)

2. `BottomTray` (planned — t7)
- File: `apps/mobile/components/navigation/bottom-tray.tsx`
- Purpose:
  - the new collapsible bottom-tray component owned by `apps/mobile/app/(tabs)/_layout.tsx` and used as the Tabs layout's tab-bar override
  - wraps an `Animated.View` whose `translateY` is driven by a `PanResponder` attached to a small grab-handle row on top of the tab buttons
  - exposes a thin peek strip when collapsed; tapping or upward-swiping the peek restores the full tray
  - shared visibility state is provided by a `useTrayVisibility()` context exposing the current visibility plus `expand()` / `collapse()` for screens that need to force a state
  - snap thresholds (drag distance, velocity) live in a pure helper at `apps/mobile/src/navigation/tray-snap.ts` so they can be unit-tested without RN gesture plumbing
- Notes:
  - the tray composes the t7-reshaped `TopLevelTabs` (3 tabs + Settings cog) below the grab handle
  - detail screens that need the tray visible (`completed-session/[sessionId]`, `exercise-history`, `profile`) mount `BottomTray` directly rather than relying on inheritance from `(tabs)/_layout.tsx`

3. `TopLevelTabs` reshape (planned — t7)
- File: `apps/mobile/components/navigation/top-level-tabs.tsx` (existing file, reshaped in place)
- Planned API change:
  - `TopLevelTabKey` becomes `'stats-history' | 'log' | 'exercises'` (replacing today's `'sessions' | 'exercises' | 'stats'`)
  - three tab handlers (`onPressStatsHistory`, `onPressLog`, `onPressExercises`) plus the existing `onPressSettings` utility action; the props/labels mirror the new tab order **Stats/History → Log → Exercises**
  - the Settings cog remains a separate accessible button labelled `Open Settings`, not a tab
- Callers to update when t7 lands:
  - `apps/mobile/app/(tabs)/_layout.tsx` (via `BottomTray`)
  - `apps/mobile/app/exercise-history.tsx` (mounts `TopLevelTabs` directly at `apps/mobile/app/exercise-history.tsx:~220` and must be updated to the new 3-tab + cog API)
  - any other detail screen that mounts the tray directly

## Refactor convergence notes (Task `T-20260226-06`)

1. Current user-facing route screens now consume `uiTokens.colors` for route-level screen styles (including modal scrims and status surfaces) instead of screen-local raw color literals.
2. No reusable primitives were removed in Task `T-20260226-06`; existing shared primitives/components (`UiButton`, `UiText`, `UiSurface`, `TopLevelTabs`, `SessionContentLayout`) remain the canonical reuse surface.
3. Some repeated button/row/modal patterns remain route-local one-offs to avoid behavioral churn; they stay tracked as candidate primitives in the pending list above.

## Maintenance rule

If a task adds/removes/renames reusable UI components or changes their role, update this doc in the same session.
