# UI Repo Discovery Baseline (M8 Task 01)

## Purpose

Provide a verified, code-referenced baseline of the current mobile UI repo layout and implementation shape before M8 audit/guardrail/refactor tasks proceed.

Verified during `T-20260226-01` on `2026-02-26`.

## Discovery summary

- Navigation is `expo-router` file-based routing with route files under `apps/mobile/app/`.
- User-facing route count is currently small (5 concrete screens + 1 route alias + root layout + 1 dynamic route file), matching the milestone's small-app assumption.
- Styling is currently local, per-file `StyleSheet.create(...)` across route files and shared UI components, with repeated raw literals for colors, spacing, radius, and typography.
- Reusable UI baseline is small and explicit today:
  - `TopLevelTabs`
  - `SessionContentLayout`
  - shared session-recorder UI types/seeded constants in `components/session-recorder/types.ts`

## Docs and template path inventory (verified)

### Core docs folders relevant to M8 UI docs work

- `docs/specs/` is the authoritative specs root (project-level map lists playbook, templates, and future UI-related docs slots): `docs/specs/README.md:1`
- `docs/specs/templates/` contains the milestone/task templates referenced by the playbook and milestone specs: `docs/specs/README.md:18`
- `docs/tasks/` is the active task-card location and `docs/tasks/complete/` is the completed-task archive: `docs/specs/09-project-structure.md:37`

### Exact AI development guidelines document path/name

- AI development guidelines entrypoint (exact path): `AGENTS.md`

### Milestone/task template paths (exact)

- Milestone template: `docs/specs/templates/milestone-spec-template.md`
- Task card template: `docs/specs/templates/task-card-template.md`

## Navigation approach and route locations

- Current navigation approach is `expo-router` (file-based routing):
  - route/layout files import from `expo-router` in `apps/mobile/app/_layout.tsx:1`, `apps/mobile/app/session-list.tsx:1`, `apps/mobile/app/session-recorder.tsx:2`, `apps/mobile/app/exercise-catalog.tsx:2`, and `apps/mobile/app/completed-session/[sessionId].tsx:1`
- project architecture spec records `Expo Router` as adopted: `docs/specs/03-technical-architecture.md:20`
- Route files live under `apps/mobile/app/` (current canonical route location): `docs/specs/03-technical-architecture.md:20`, `docs/specs/09-project-structure.md:17`
- Root layout uses `<Stack>` screen registration and app bootstrap side-effect:
  - stack registration in `apps/mobile/app/_layout.tsx:15`
  - local data bootstrap trigger in `apps/mobile/app/_layout.tsx:9`

## Current route / screen inventory (verified)

### Route files

1. `apps/mobile/app/_layout.tsx`
- Purpose: root app layout for Expo Router stack + local data bootstrap on mount.
- Key refs:
  - root layout export: `apps/mobile/app/_layout.tsx:8`
  - local data bootstrap: `apps/mobile/app/_layout.tsx:9`
  - stack screen declarations for top-level routes: `apps/mobile/app/_layout.tsx:15`

2. `apps/mobile/app/index.tsx`
- Purpose: route alias that re-exports the session list route as the default `/` screen.
- Key refs:
  - direct re-export: `apps/mobile/app/index.tsx:1`

3. `apps/mobile/app/session-list.tsx`
- Purpose: primary sessions history/home screen with active session state, completed session history, delete/undelete/reopen menu actions, and top-level tab navigation.
- Key refs:
  - imports `TopLevelTabs`: `apps/mobile/app/session-list.tsx:23`
  - reusable/testable screen shell export: `apps/mobile/app/session-list.tsx:249`
  - route wrapper export (`SessionListRoute`) with focus-triggered reload token: `apps/mobile/app/session-list.tsx:783`
  - navigation to recorder/detail/edit-detail routes: `apps/mobile/app/session-list.tsx:372`, `apps/mobile/app/session-list.tsx:380`, `apps/mobile/app/session-list.tsx:462`
  - bottom tabs usage: `apps/mobile/app/session-list.tsx:666`

4. `apps/mobile/app/session-recorder.tsx`
- Purpose: active workout/session recorder screen (edit session fields, exercises/sets, modals) with local draft load/autosave/complete integration.
- Key refs:
  - imports shared `SessionContentLayout`: `apps/mobile/app/session-recorder.tsx:5`
  - imports shared session-recorder UI types/constants: `apps/mobile/app/session-recorder.tsx:6`
  - route screen export: `apps/mobile/app/session-recorder.tsx:205`
  - autosave controller setup in screen body: `apps/mobile/app/session-recorder.tsx:217`
  - shared content layout usage for exercise/set rendering: `apps/mobile/app/session-recorder.tsx:927`

5. `apps/mobile/app/exercise-catalog.tsx`
- Purpose: exercise catalog management screen (list/create/edit/delete exercises and muscle mappings) with top-level tab navigation.
- Key refs:
  - imports `TopLevelTabs`: `apps/mobile/app/exercise-catalog.tsx:5`
  - route screen export: `apps/mobile/app/exercise-catalog.tsx:106`
  - bottom tab instance and navigation back to session list: `apps/mobile/app/exercise-catalog.tsx:379`, `apps/mobile/app/exercise-catalog.tsx:382`

6. `apps/mobile/app/completed-session/[sessionId].tsx` (dynamic route)
- Purpose: completed session detail viewer/editor shell for a specific `sessionId`, with `intent=edit` route-param mode toggle support.
- Key refs:
  - dynamic route file path: `apps/mobile/app/completed-session/[sessionId].tsx`
  - imports `useLocalSearchParams` and `Stack`: `apps/mobile/app/completed-session/[sessionId].tsx:1`
  - screen shell export: `apps/mobile/app/completed-session/[sessionId].tsx:150`
  - dynamic route wrapper parses `sessionId` + `intent`: `apps/mobile/app/completed-session/[sessionId].tsx:503`
  - shared content layout usage: `apps/mobile/app/completed-session/[sessionId].tsx:417`
  - route title set via `<Stack.Screen ...>` inside screen states: `apps/mobile/app/completed-session/[sessionId].tsx:296`

### Route count notes (for M8 small-app rule)

- Route/layout files under `apps/mobile/app/` (excluding tests) currently observed:
  - `_layout.tsx`
  - `index.tsx`
  - `session-list.tsx`
  - `session-recorder.tsx`
  - `exercise-catalog.tsx`
  - `completed-session/[sessionId].tsx`
- Source inventory reference: `apps/mobile/app/` file list verified in this task (see task evidence and route file refs above).

## Current styling approach(s) baseline

### Primary styling pattern

- React Native `StyleSheet.create(...)` is the dominant styling approach in current route and shared component files:
  - `apps/mobile/app/session-list.tsx:795`
  - `apps/mobile/app/session-recorder.tsx:1271`
  - `apps/mobile/app/exercise-catalog.tsx:749`
  - `apps/mobile/app/completed-session/[sessionId].tsx:512`
  - `apps/mobile/components/navigation/top-level-tabs.tsx:43`
  - `apps/mobile/components/session-recorder/session-content-layout.tsx:113`

### Composition pattern (local conditional styles)

- Conditional style arrays are used directly in component/screen render code (no centralized style helper abstraction in the current baseline):
  - `TopLevelTabs` tab/button state styles via `style={[...]}`: `apps/mobile/components/navigation/top-level-tabs.tsx:26`
  - session list modal action buttons combine base + variant styles: `apps/mobile/app/session-list.tsx:692`, `apps/mobile/app/session-list.tsx:719`
  - session recorder set inputs combine shared input + row variant styles: `apps/mobile/app/session-recorder.tsx:947`

### Shared style helpers / theme layer status (baseline finding)

- Shared UI components exist (`TopLevelTabs`, `SessionContentLayout`), but no centralized UI tokens/theme/style helper module is part of the current M8 baseline in `apps/mobile/components/**` route usage.
- This is consistent with the milestone's draft assumption that styling is currently screen/component-local and raw-literal-heavy.

### Repeated raw-literal usage patterns (high-level observations)

- Colors: repeated direct hex literals across screens/components (examples include `#0f5cc0`, `#ffffff`, `#f4f7fb`, `#d0d0d0`):
  - `apps/mobile/components/navigation/top-level-tabs.tsx:51`
  - `apps/mobile/components/session-recorder/session-content-layout.tsx:118`
  - `apps/mobile/app/session-recorder.tsx:1319`
  - `apps/mobile/app/session-list.tsx:798`
  - `apps/mobile/app/exercise-catalog.tsx:752`
  - `apps/mobile/app/completed-session/[sessionId].tsx:516`
- Spacing/radius: repeated values such as `8`, `10`, `12`, `14`, `16`, `20` appear in padding/gap/borderRadius across files:
  - `apps/mobile/components/navigation/top-level-tabs.tsx:47`
  - `apps/mobile/components/session-recorder/session-content-layout.tsx:115`
  - `apps/mobile/app/exercise-catalog.tsx:753`
  - `apps/mobile/app/completed-session/[sessionId].tsx:514`
- Typography: repeated `fontSize` and `fontWeight` literals (for example `12/13/14/16` and `600/700`) appear in local style blocks:
  - `apps/mobile/components/navigation/top-level-tabs.tsx:70`
  - `apps/mobile/components/session-recorder/session-content-layout.tsx:132`
  - `apps/mobile/app/completed-session/[sessionId].tsx:531`

## Initial reusable UI component inventory (baseline)

### Shared visual/navigation components

1. `apps/mobile/components/navigation/top-level-tabs.tsx`
- Purpose: reusable two-tab bottom navigation control for `Sessions` and `Exercises`.
- Exported reusable component: `TopLevelTabs` in `apps/mobile/components/navigation/top-level-tabs.tsx:34`
- Internal subcomponent: `TabButton` in `apps/mobile/components/navigation/top-level-tabs.tsx:11`
- Current consumers:
  - `apps/mobile/app/session-list.tsx:23` and usage at `apps/mobile/app/session-list.tsx:666`
  - `apps/mobile/app/exercise-catalog.tsx:5` and usage at `apps/mobile/app/exercise-catalog.tsx:380`

2. `apps/mobile/components/session-recorder/session-content-layout.tsx`
- Purpose: shared session/exercise/set content scaffold used by the recorder and completed-session detail screens.
- Exported reusable component: `SessionContentLayout` in `apps/mobile/components/session-recorder/session-content-layout.tsx:38`
- Generic extension point via render props for set rows / exercise actions / empty state: `apps/mobile/components/session-recorder/session-content-layout.tsx:21`
- Current consumers:
  - `apps/mobile/app/session-recorder.tsx:5` and usage at `apps/mobile/app/session-recorder.tsx:927`
  - `apps/mobile/app/completed-session/[sessionId].tsx:5` and usage at `apps/mobile/app/completed-session/[sessionId].tsx:417`

### Shared UI-supporting types/constants (non-visual but reused by UI screen)

1. `apps/mobile/components/session-recorder/types.ts`
- Purpose: shared session-recorder UI state/types plus seeded locations/exercises used by the recorder screen.
- Exported state/type surface includes `SessionRecorderState`: `apps/mobile/components/session-recorder/types.ts:37`
- Seeded UI constants exported (`SEEDED_LOCATIONS`, `SEEDED_EXERCISES`): `apps/mobile/components/session-recorder/types.ts:60`, `apps/mobile/components/session-recorder/types.ts:66`
- Consumer reference (recorder route imports these types/constants): `apps/mobile/app/session-recorder.tsx:6`

### Reusable route-level screen shells (useful for tests, not component-catalog primitives)

- `SessionListScreenShell` exported from route file for route/test composition: `apps/mobile/app/session-list.tsx:249`
- `CompletedSessionDetailScreenShell` exported from dynamic route file for route/test composition: `apps/mobile/app/completed-session/[sessionId].tsx:150`

## Open questions / follow-up notes for Task 02 (UI pattern audit)

1. Should route-exported screen shells (`SessionListScreenShell`, `CompletedSessionDetailScreenShell`) be tracked in the UI components catalog, or only in the screen map/navigation docs?
2. Should `apps/mobile/components/session-recorder/types.ts` remain in the component inventory as a UI-supporting module, or move to a separate "shared UI models/constants" inventory section in later docs?
3. `apps/mobile/app/index.tsx` is a pure alias to `session-list`; for future screen maps, should it be documented as a route alias only (no standalone screen)?
4. The current baseline confirms local `StyleSheet.create` + raw literals, but Task 02 should quantify repeated values across all user-facing route files before proposing tokens/primitives.
5. M8 Task 05 should decide whether a `docs/specs/ui/README.md` index is needed once the UI docs bundle grows beyond the baseline + audit docs.
