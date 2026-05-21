# Screen Map (Authoritative Current UI)

## Purpose

Brief entrypoint map of the current mobile screens.

- This doc answers: "what screens exist and what is each screen for?"
- Use `docs/specs/ui/navigation-contract.md` for path/param/transition rules.
- Use source files for detailed UI structure and render logic.

## Sources

- `docs/specs/ui/repo-discovery-baseline.md`
- `docs/specs/ui/ui-pattern-audit.md`
- `docs/specs/ui/navigation-contract.md`

## User-facing route map (current)

1. `/` (alias)
- File: `apps/mobile/app/index.tsx`
- Purpose:
  - default app entry route that redirects to `/stats-history`
- Notes:
  - no unique UI; renders an `expo-router` `Redirect` to the merged Stats/History tab

2. `/session-list`
- File: `apps/mobile/app/session-list.tsx`
- Purpose:
  - legacy sessions home/history screen (active session entry, completed history, session actions); during the navigation redesign migration this route is still rendered as-is so the `session-list-decompose` task can extract pieces and Maestro can still reach it; final state will be reached once `maestro-and-tests` runs
- Key states (high level):
  - loading / error / empty / populated list
  - in-route action modals
- Key exits:
  - `session-recorder`
  - `completed-session/[sessionId]`
  - `exercise-catalog`

2a. `/stats-history`
- File: `apps/mobile/app/(tabs)/stats-history.tsx`
- Purpose:
  - merged Stats / History tab; currently renders the prior `/stats` body verbatim while the `stats-history-tab` task layers the Stats↔History segmented toggle on top
- Notes:
  - tab root inside the `(tabs)` group with `headerShown: false`; the tab bar is now `BottomTray` (composing `TopLevelTabs`) supplied via the `tabBar` prop in `(tabs)/_layout.tsx`. The in-screen `<TopLevelTabs>` in this file is a transitional duplicate retained until the `stats-history-tab` task takes over; it shares the same component so the API stays uniform.

2b. `/stats` (redirect)
- File: `apps/mobile/app/stats.tsx`
- Purpose:
  - back-compat shim: renders an `expo-router` `Redirect` to `/stats-history` so existing callers (e.g. `TopLevelTabs`) keep working until `bottom-tray` updates them and `maestro-and-tests` retires this shim

3. `/session-recorder`
- File: `apps/mobile/app/(tabs)/session-recorder.tsx`
- Purpose:
  - active session recorder and completed-session editor (query-driven mode)
- Key states (high level):
  - active mode
  - completed-edit loading/error/content states
  - in-route picker/editor/action modals (exercise picker includes text filtering by exercise name + primary muscle display/family terms, with compact header icon actions for manage/add)
  - in-route exercise-tag add/manage modals (search/select/create, rename/delete/undelete, deleted-visibility toggle)
- Key exits:
  - `exercise-catalog` (`source=session-recorder&intent=manage` from exercise picker)
  - dismisses to `/` on submit/save success

4. `/exercise-catalog`
- File: `apps/mobile/app/(tabs)/exercise-catalog.tsx`
- Purpose:
  - exercise catalog management (create/edit/soft-delete/undelete exercises and muscle mappings)
- Key states (high level):
  - loading / error / content
  - text filtering across exercise names + primary muscle display/family terms
  - in-route editor/action/delete modals
  - deleted visibility toggle (`Show deleted` / `Hide deleted`) via top-level options kebab menu
- Key exits:
  - `session-recorder` after save when opened from recorder-origin manage flow
  - `session-list` via top-level tabs

5. `/settings`
- File: `apps/mobile/app/(tabs)/settings.tsx`
- Purpose:
  - minimal account/settings entry screen for the M11 auth/profile flow
- Key states (high level):
  - one tappable account/profile card
  - available from the shared settings utility action regardless of auth state
- Key exits:
  - `profile`
  - back to the previous route via stack navigation

6. `/profile`
- File: `apps/mobile/app/profile.tsx`
- Purpose:
  - auth-aware account route for sign-in, signed-in username/email/password management, and M13 sync controls/status
- Key states (high level):
  - restoring/auth-bootstrap banner
  - auth-disabled warning when client config is missing
  - signed-out email/password form with inline auth error feedback
  - signed-in view mode with row-based account values (username/email plus optional pending-email row) and bottom actions (`Edit`, danger `Sign Out`)
  - signed-in edit mode with `username`/`new email`/`new password` fields and one `Update` action
  - signed-in sync section with enable/disable control, current sync status, last successful sync (`Never` when no success yet), optional pending-count and next-retry rows
  - sync retry/error handling remains inline (backend free-text message + retry/action-required hint)
  - lazy profile load/provision state for `username`
  - inline unified profile-update success/failure (including pending email-confirmation messaging)
  - sign-out failure feedback that stays on the same route
- Key exits:
  - in-place rerender between signed-out and signed-in states
  - back to `settings` (or previous route) via stack navigation

7. `/completed-session/[sessionId]`
- File: `apps/mobile/app/completed-session/[sessionId].tsx`
- Purpose:
  - completed session detail viewer with edit/reopen/delete actions
- Key states (high level):
  - loading / error / not-found / detail
  - temporary redirect placeholder for `intent=edit`
- Key exits:
  - `session-recorder` (edit)
  - dismisses to `/` after successful reopen

8. `/exercise-history`
- File: `apps/mobile/app/exercise-history.tsx`
- Purpose:
  - per-exercise performance history view (progression signals + per-tag drill-down for a single `exercise_definitions` row)
- Key states (high level):
  - loading / error / detail
  - in-section empty state when no sessions match the active period/tag filter
  - period chips (`7 / 30 / all`) and horizontal tag-filter chip strip
  - dynamic stack title set inside the route file to the resolved exercise name (falls back to `Exercise History`)
- Key exits:
  - `/completed-session/<sessionId>` from session card tap or from the all-time-best card rows
  - `session-list` / `exercise-catalog` / `stats` / `settings` via the shared bottom tab strip

## Route shell (not a user-facing screen)

1. `apps/mobile/app/_layout.tsx`
- Purpose:
  - root stack registration and local data bootstrap on app mount
- Notes:
  - tab roots live inside the `(tabs)` route group (`apps/mobile/app/(tabs)/_layout.tsx`) with `headerShown: false`; the root stack registers the `(tabs)` group itself plus the detail screens (`session-list`, `stats`, `exercise-history`, `profile`, `maestro-harness`, `completed-session/[sessionId]`)
  - completed-session route sets its title inside the route file
  - exercise-history route also sets its title inside the route file (resolved exercise name)

2. `apps/mobile/app/(tabs)/_layout.tsx`
- Purpose:
  - tab group layout that owns the tab roots (`stats-history`, `session-recorder`, `exercise-catalog`) plus `settings` (in-group but reached via the cog, not as a tab)
- Notes:
  - all tab roots have `headerShown: false`
  - the system tab bar is supplied via `tabBar={() => <BottomTray>…</BottomTray>}`: the `BottomTray` component (from `apps/mobile/components/navigation/bottom-tray.tsx`) wraps `TopLevelTabs` and exposes a drag handle to collapse to a peek strip. Screens can imperatively expand/collapse via `useTrayVisibility()`; initial state is `expanded`. Snap math is unit-tested in `apps/mobile/src/navigation/tray-snap.ts`.

## Documentation boundary

- Keep this doc brief and route-oriented.
- Do not duplicate detailed section breakdowns, component trees, or render logic from route files.
- If route purpose or screen-level state set changes materially, update this doc in the same task.
