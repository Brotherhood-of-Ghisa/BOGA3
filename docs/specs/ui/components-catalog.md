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

## Refactor convergence notes (Task `T-20260226-06`)

1. Current user-facing route screens now consume `uiTokens.colors` for route-level screen styles (including modal scrims and status surfaces) instead of screen-local raw color literals.
2. No reusable primitives were removed in Task `T-20260226-06`; existing shared primitives/components (`UiButton`, `UiText`, `UiSurface`, `TopLevelTabs`, `SessionContentLayout`) remain the canonical reuse surface.
3. Some repeated button/row/modal patterns remain route-local one-offs to avoid behavioral churn; they stay tracked as candidate primitives in the pending list above.

## Maintenance rule

If a task adds/removes/renames reusable UI components or changes their role, update this doc in the same session.
