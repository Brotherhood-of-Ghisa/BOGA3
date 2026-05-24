# UX Rules (Authoritative Current UI Semantics)

## Purpose

Document app-specific UI semantics and guardrails for the current mobile app.

- This doc is a reality-based source of truth for current behavior and conventions.
- It complements (does not replace) `docs/specs/08-ux-delivery-standard.md`, which defines cross-task UX process requirements.

## Sources

- UI docs index: `docs/specs/ui/README.md`
- Repo discovery baseline: `docs/specs/ui/repo-discovery-baseline.md`
- UI pattern audit (evidence): `docs/specs/ui/ui-pattern-audit.md`
- Screen map: `docs/specs/ui/screen-map.md`
- Navigation contract: `docs/specs/ui/navigation-contract.md`
- Components catalog: `docs/specs/ui/components-catalog.md`

## Status legend

- `Current behavior (authoritative)`: verified against current app code.
- `Pending / planned`: approved direction or audit-derived target not fully implemented yet.

## Current behavior (authoritative)

### 1. Action semantics

1. Primary actions are filled/high-emphasis actions used for the main next step in a section/screen.
   - Examples:
     - `Start Session`
     - `Submit Session` / `Save Changes`
     - `New Exercise`
2. Secondary actions are neutral/outline actions used for non-destructive alternatives or dismiss/close flows.
   - Examples:
     - `Cancel`
     - `Done`
     - `Reopen` (when enabled)
3. Danger actions are explicitly destructive and visually distinct.
   - Examples:
     - delete session
     - soft-delete exercise
     - remove destructive menu actions
4. Tab actions (`TopLevelTabs`) are navigation controls, not generic primary actions.
   - They use tab semantics (`accessibilityRole="tab"` / tablist) and active-state visuals.
5. The right-side `Settings` affordance inside `TopLevelTabs` is a utility action, not a third tab.
   - It remains visually lighter than the active Sessions/Exercises tabs and opens the stack-based settings flow.
   - It remains available while logged out so account access never blocks the local-first tracker entry routes.

### 2. Modal and overlay semantics

1. Most secondary workflows in current screens use in-route modal/overlay UI state instead of route changes.
   - Examples:
     - session list action menus
     - exercise catalog editor/action/delete modals
     - session recorder gym/exercise pickers/action menus and inline exercise creation editor
2. In the `session-recorder` exercise picker, `Manage` and `Add new` are compact icon actions in the modal header row (same row as the title), replacing the old bottom text-button row.
3. Modal open/close is treated as state within the current route and should not be documented as a navigation transition.
4. Dismiss overlays via backdrop press are common and expected when the flow is not destructive-final.

### 3. Screen layout and spacing conventions (current app behavior)

1. Current user-facing screens use vertical layouts with no horizontal scrolling on phone widths.
2. Page backgrounds are muted light surfaces (`surfacePage`-like behavior), with card/panel surfaces layered on top.
3. Spacing rhythm is already close to 8pt increments (common values cluster around `8/10/12/14/16/20`) and should remain consistent.
4. Bottom tab navigation (`BottomTray` composing `TopLevelTabs`) remains visible on tab roots (`stats-history`, `session-recorder`, `exercise-catalog`) across primary states (including loading/error in `exercise-catalog`), and detail screens that still render `TopLevelTabs` directly (e.g. `exercise-history`) preserve the same strip.

### 4. List and row interaction conventions

1. Pressable list rows commonly separate:
   - main row press target (open/edit primary action)
   - trailing kebab/icon action for secondary actions
2. This split interaction pattern is used in `exercise-catalog` and in the shared `HistoryList` / `ActiveSessionRow` building blocks (consumed by the `stats-history` History sub-view and the Log tab), and should be preserved during refactors unless behavior intentionally changes.
3. Deleted/archived visibility is controlled via toggles and state hints, not separate routes.
4. In `exercise-catalog`, deleted exercises remain in list history when deleted visibility is enabled, show explicit `Deleted` state, and expose `Undelete` from row actions.
5. `exercise-catalog` top actions use compact icon buttons (`+` create, kebab options), and deleted visibility toggle lives under the top-level options menu.

### 5. Forms and validation conventions

1. Text inputs, picker triggers, and read-only fields are visually similar but currently implemented in multiple screen-local styles.
2. Exercise catalog uses explicit field labels + inline validation/error messages and is the strongest current form pattern reference.
3. `session-recorder` completed-edit mode includes start/end validation and an autosave-paused notice when timestamps are invalid.
4. Validation/error feedback should remain near the relevant field/control whenever possible.
5. The `session-recorder` exercise picker and `exercise-catalog` list include a text filter that:
   - trims and collapses extra whitespace in user input,
   - matches case-insensitively,
   - matches when any typed word appears in either exercise names or linked muscle-group metadata.
6. The M11 profile sign-in form keeps auth failure messaging inline inside the same card as the email/password inputs.
7. When auth config is unavailable, the profile route shows a warning state and disables sign-in rather than failing only after submit.
8. The M11 profile sign-in form performs basic client-side email-shape validation before attempting the auth request.
9. The signed-in profile route defaults to a view-only summary with row-based account values and one bottom action row (`Edit` + danger-styled `Sign Out`), with no extra title/help copy.
10. Entering profile edit mode reveals `username`, `new email`, and `new password` fields plus a single `Update` submit action; update failures stay inline and successful updates return to view mode.
11. In `session-recorder`, logged sets render as in-card rows with a header row (`Type`, `Weight`, `Reps`) instead of per-set subcards, and set numeric validation uses visual cues only (no inline validation text):
    - The left square `Type` button cycles set type on tap in this order: `None -> WU -> R0 -> R1 -> R2 -> None`.
    - Long-pressing the `Type` button opens an in-route modal picker with explicit options (`None`, `Warm-up`, `RIR 0`, `RIR 1`, `RIR 2`).
    - `Weight` accepts decimal numeric input and must be a non-negative number.
    - `Reps` accepts integer numeric input and must be a positive integer.
    - Adding a set to an exercise copies the previous set's `Weight`, `Reps`, and `Type` values, while assigning the new row its own identity.
    - Logging a new exercise focuses its first `Weight` input, and adding a set focuses the new set's `Weight` input. Weight and `Reps` inputs select their current value on focus so copied/defaulted values can be overwritten quickly.
12. The shared exercise editor dismisses the text keyboard before opening primary/secondary muscle selectors, and selector lists remain keyboard-aware so all muscle-group options stay reachable on iOS.
13. In `session-recorder`, GPS gym detection is quiet assistance:
    - the default recorder surface shows only the gym box, with no visible Detect button or persistent GPS suggestion panel,
    - brand-new active-session creation may run one foreground location read and preselect a gym only when exactly one saved gym confidently matches,
    - restoring an active draft and completed-edit mode do not run startup GPS detection,
    - short-pressing the gym box opens the picker, while long-pressing it explicitly retries GPS detection for the current active session,
    - permission denial, unavailable services, low accuracy, no match, ambiguous match, and read failures leave the current gym unchanged,
    - manual gym selection and `No gym` are always authoritative unless the user later long-presses to retry GPS detection.
14. In `session-recorder`, the gym picker includes `No gym` as a null session-gym option:
    - it maps to nullable `session.locationId` / persisted `gym_id`,
    - it is not a `gyms` row and is not editable, archived, synced, or shown in Manage,
    - active-session null gym state displays as `No gym`, not as an unresolved choose prompt.
15. In `session-recorder` gym management, private coordinate controls live in the single gym editor:
    - each managed gym shows only coordinate presence (`GPS saved` / `No GPS coordinates`) rather than latitude/longitude precision,
    - Manage rows expose list-management actions only (edit, archive/unarchive, archived visibility), not coordinate mutation actions,
    - `Save current location` in the single gym editor reads foreground location and persists only when accuracy is acceptable,
    - adding a new gym silently attempts to attach acceptable current coordinates without blocking gym creation or selection,
    - replacing or clearing existing coordinates remains confirmation-gated in the single gym editor,
    - permission denial, unavailable services, low accuracy, and persistence failures stay inline in the editor and leave existing coordinates unchanged,
    - clearing coordinates removes the gym from GPS matching until coordinates are saved again.

### 6. Loading, empty, error, and feedback state handling

1. Whole-screen loading/error states are used when route data cannot render meaningful content yet.
   - `exercise-catalog`: centered state + bottom tabs remain visible
   - `completed-session/[sessionId]`: centered state variants with route title preserved
2. In-section state panels are used inside the shared `HistoryList` (loading/error/empty) consumed by the `stats-history` History sub-view.
3. Inline helper/success/error text is used for form feedback and post-action feedback (`exercise-catalog`, completed-session action bar).
4. State presentation style varies by screen today; refactors may unify visuals, but the semantic distinction (whole-screen vs in-section vs inline) should remain explicit.
5. The profile route uses:
   - an inline restoring banner during auth bootstrap,
   - inline warning messaging when auth config is missing,
   - inline error cards for sign-in/sign-out failures,
   - inline success/error card handling for unified profile update submits,
   - a signed-in sync section with:
     - sync enable/disable control,
     - one current state line (`Disabled`, `Enabled`, `Syncing initial data`, `Syncing`, `Waiting for network`, `Retry scheduled`, `Sync blocked`),
     - `Last successful sync` value (`Never` before first success),
     - optional `Pending changes` and `Next retry` rows,
     - inline backend free-text failure message and retry/action-required hint when present,
   - sync work as background/non-blocking behavior (the route stays usable while sync runs or retries),
   - explicit email-change pending-confirmation messaging instead of assuming immediate completion,
   - password field clearing after each authenticated password submit,
   - in-place signed-out/signed-in rerendering instead of a redirect loop.

### 7. Completed-session detail screen semantics

1. Completed-session detail uses a sticky action bar for edit/reopen/delete actions above the detail content.
2. `Reopen` can be disabled when another active session exists; the UI shows a textual hint explaining why.
3. `intent=edit` on the completed-session route is a redirect behavior, not a separate screen.
4. Completed-session exercise cards show assigned tags as chips under the exercise title only when one or more tags exist; no tag placeholder is shown when there are none.

### 8. Navigation/query semantics (UI-facing rule)

1. Route mode/state changes that affect screen behavior (for example `session-recorder` completed-edit mode) must be documented in `docs/specs/ui/navigation-contract.md`.
2. Route alias behavior (`/` -> `stats-history`) should be treated as a navigation entry alias, not a unique screen design.
3. `exercise-catalog` supports recorder-entry query semantics (`source=session-recorder`, `intent=manage`) for the manage flow, while recorder `Add new` uses the same exercise editor inside the recorder route.

### 9. UI guardrail enforcement (current enforced rule)

1. Do not add raw color literals (`#hex`, `rgb(...)`, `rgba(...)`) directly in screen/component `.tsx` files.
2. Use UI tokens from `apps/mobile/components/ui/tokens.ts` directly or through primitives in `apps/mobile/components/ui/`.
3. Temporary exceptions require an explicit allowlist entry and rationale in `apps/mobile/scripts/ui-guardrails.config.js`.
4. As of Task `T-20260226-06`, the current route screens (`stats-history`, `session-recorder`, `exercise-catalog`, `completed-session/[sessionId]`) no longer require raw-color allowlist exceptions.

Guardrail command:

- Run from `apps/mobile/`: `npm run lint:ui-guardrails`
- Audit mode: `npm run lint:ui-guardrails -- --include-allowlisted`

### 10. Exercise-tag interaction semantics

1. `session-recorder` exercise cards show assigned tags as compact chips below the exercise header and above set rows.
2. Chip removal only removes the current logged-exercise assignment; it does not delete the reusable tag definition.
3. `Add tag` is a direct per-exercise affordance on the card (not hidden in the exercise kebab menu).
4. Tag add/manage is in-route modal state:
   - add mode: search/filter active tags, select, or create inline,
   - manage mode: rename, soft-delete, show/hide deleted, undelete.
5. Completed-session edit mode (`/session-recorder?mode=completed-edit`) uses the same add/remove tag interactions as active mode.
6. Manage-tag row actions are compact icon controls (rename/delete/undelete), while accessibility labels preserve explicit action semantics.

### 11. Documentation maintenance rule (UI semantics)

1. If a task changes current UI semantics (action roles, state treatment, modal conventions, list interactions, validation behavior), update this file in the same task/session.
2. If the change is route-path/param/transition related, update `navigation-contract.md` in the same task.
3. If the change is component/primitives API related, update `components-catalog.md` in the same task.

## Pending / planned (not current behavior)

1. Additional primitive extraction (for example state panels, modal surfaces, row cards, form fields) remains pending to reduce route-local style duplication beyond the token convergence completed in Task `T-20260226-06`.
2. Additional primitives from the audit (for example `ScreenContainer`, `EmptyState`, `ModalSurface`) are candidates, not current required APIs.
3. Temporary raw-color guardrail allowlist entries remain available only for future exceptional migrations; current route-screen exceptions were cleared in Task `T-20260226-06`.
