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

## Status legend

- `Current behavior (authoritative)`: verified against current app code.
- `Pending / planned`: approved direction documented for `docs/plans/navigation-redesign/plan.md` task chain (t2–t8) but not yet implemented.

## User-facing route map (current)

1. `/` (alias)
- File: `apps/mobile/app/index.tsx`
- Purpose:
  - default app entry route that re-exports `session-list`
- Notes:
  - no unique UI; behaves as `/session-list`

2. `/session-list`
- File: `apps/mobile/app/session-list.tsx`
- Purpose:
  - sessions home/history screen (active session entry, completed history, session actions)
- Key states (high level):
  - loading / error / empty / populated list
  - in-route action modals
- Key exits:
  - `session-recorder`
  - `completed-session/[sessionId]`
  - `exercise-catalog`

3. `/session-recorder`
- File: `apps/mobile/app/session-recorder.tsx`
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
- File: `apps/mobile/app/exercise-catalog.tsx`
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
- File: `apps/mobile/app/settings.tsx`
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
  - static titles for main routes are declared here, including `settings` and `profile`
  - completed-session route sets its title inside the route file
  - exercise-history route also sets its title inside the route file (resolved exercise name)

## Pending / planned (navigation-redesign target state)

The `navigation-redesign` plan (`docs/plans/navigation-redesign/plan.md`, tasks t2–t8) reshapes the route map. None of the items below are live today; they describe the target screen layout that subsequent tasks will land.

### Planned tab roots (inside the `(tabs)` route group)

1. `/stats-history` (planned tab root)
- File: `apps/mobile/app/(tabs)/stats-history.tsx` (introduced in t2; segmented body in t5)
- Purpose:
  - merged Stats and Session History tab, with a top segmented control toggling between `Stats` and `History` views
- Key states (high level):
  - `Stats` view (today's `stats.tsx` body, including period chips and per-exercise history picker)
  - `History` view (completed-session list with deleted-visibility toggle and row action menus)
  - per-view scroll position preserved when toggling between the two sub-views
- Key exits:
  - `/completed-session/<sessionId>` from a history row tap
  - `/exercise-history?exerciseDefinitionId=<id>` from the Stats sub-view's per-exercise history picker
  - `/settings` via the cog utility action in the bottom tray
- Notes:
  - `headerShown: false` at the tab root; detail screens reached from here keep their light back-affordance header
  - tab root replaces today's `/session-list` and `/stats` entry points; `/session-list` becomes a redirect to `/stats-history` (history view) for compatibility with maestro flows until t8 retargets the harness

2. `/session-recorder` (planned Log tab root)
- File: `apps/mobile/app/(tabs)/session-recorder.tsx` (moved in t2; empty state in t6)
- Purpose:
  - the Log tab — the recorder when an active session exists, an empty state with a single primary `Start Session` CTA otherwise
- Key states (high level):
  - empty state (no active session, `mode !== 'completed-edit'`): renders the `Start Session` button which creates a session and reveals the recorder body in place
  - active mode: same recorder body as today, with the active-session pinned row, complete (`✓`), and kebab/delete affordances rendered here
  - completed-edit mode (`mode=completed-edit`): unchanged from today; dismisses to `/stats-history` after save
- Key exits:
  - `/exercise-catalog?source=session-recorder&intent=manage` (manage flow)
  - dismisses to `/stats-history` on submit/save success
- Notes:
  - URL path `/session-recorder` is intentionally preserved so `apps/mobile/src/sync/scheduler.ts` (`SESSION_RECORDER_ROUTE_SEGMENT`) does not need to change and the recorder sync cadence still flips correctly
  - `headerShown: false` at the tab root

3. `/exercise-catalog` (planned Exercises tab root)
- File: `apps/mobile/app/(tabs)/exercise-catalog.tsx` (moved in t2)
- Purpose:
  - same exercise catalog management as today, now mounted as the Exercises tab root
- Notes:
  - `headerShown: false` at the tab root
  - sub-navigation inside the Exercises tab is explicitly out of scope for the navigation-redesign plan (future direction only)

### Planned detail screens (outside the `(tabs)` group)

The detail screens below remain pushed onto the root stack outside the `(tabs)` route group. They keep a light back-affordance header and continue to render the shared `BottomTray` component themselves rather than relying on inheritance from `(tabs)/_layout.tsx`.

1. `/completed-session/[sessionId]` (unchanged route path)
- File: `apps/mobile/app/completed-session/[sessionId].tsx`
- Purpose:
  - completed session detail viewer; reached from the History sub-view inside the Stats/History tab
- Notes:
  - dismisses to `/stats-history` after successful reopen (was `/`)

2. `/exercise-history` (unchanged route path; detail screen, not a tab root)
- File: `apps/mobile/app/exercise-history.tsx`
- Purpose:
  - per-exercise performance history; reached from the Stats sub-view inside the Stats/History tab via the per-exercise history picker
- Notes:
  - remains a detail screen outside the `(tabs)` group
  - continues to render its own `BottomTray` in t1's documentation target; t7 reshapes the component to the new 3-tab + cog API but `exercise-history` keeps mounting it directly
  - dismisses back via stack navigation; tab-tap from its bottom tray jumps to the relevant tab root

3. `/profile`, `/session-recorder?mode=completed-edit`, `/maestro-harness`
- Files: `apps/mobile/app/profile.tsx`, the completed-edit branch of the recorder, `apps/mobile/app/maestro-harness.tsx`
- Notes:
  - these keep their existing titled headers; the bottom tray remains visible (rendered by the screen)

### Planned tray + header behavior

1. Bottom tray (planned)
- Rendered by `apps/mobile/app/(tabs)/_layout.tsx` for tab roots, and re-rendered by detail screens (`completed-session/[sessionId]`, `exercise-history`, `profile`) so it stays visible everywhere it does today.
- Three tabs in order: `Stats/History → Log → Exercises`, with a Settings cog as a right-side utility action (not a tab).
- Collapsible to a peek strip via a drag handle on top of the tab buttons; tap or upward swipe on the peek restores it. Visibility does not persist across app restarts.

2. Native stack header (planned)
- `headerShown: false` on every tab root.
- Detail screens (`completed-session/[sessionId]`, `exercise-history`, `profile`, `session-recorder?mode=completed-edit`, `maestro-harness`) keep a light back-affordance header.

## Documentation boundary

- Keep this doc brief and route-oriented.
- Do not duplicate detailed section breakdowns, component trees, or render logic from route files.
- If route purpose or screen-level state set changes materially, update this doc in the same task.
