# UX Rules (Authoritative Current UI Semantics)

## Purpose

Document app-specific UI semantics and guardrails for the current mobile app.

- This doc is a reality-based source of truth for current behavior and conventions.
- It complements (does not replace) `docs/specs/08-ux-delivery-standard.md`, which defines cross-task UX process requirements.

## Sources

- UI docs index: `docs/specs/ui/README.md`
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
11. In `session-recorder`, logged sets render as compact in-card text rows once they have displayable values; tapping the compact row turns it into inline editable inputs, and set numeric validation uses visual cues only (no inline validation text):
    - Every set row reserves a fixed left glyph slot so normal and planned execution rows align (`•` normal logged, `○` planned, `✓` matched, `≈` modified, `−` skipped, `+` added beyond plan).
    - The former `Type` control is presented as right-side set quality in both compact and editable modes (`•`, `WUp`, `RIR 0`, `RIR 1`, `RIR 2`); `•` maps to `null`, tapping cycles quality in the same order, and long-pressing opens the in-route modal picker with explicit options (`None`, `WUp`, `RIR 0`, `RIR 1`, `RIR 2`). Unperformed planned target rows suppress this quality control while they show the `Log` / `Skip` decision controls; quality appears after the target is logged, edited into an actual, skipped, or added as a normal performed row. Quality is displayed and persisted separately from planned volume; by default, planned-row matched/modified classification compares prescribed volume only (`Weight` + `Reps`), not quality.
    - Editable set rows keep quality adjacent to the weight/reps text inputs; the quality button has a fixed width sized for `WUp`, and the row-level remove action is a compact secondary `rm` button styled like `Skip`.
    - Set input rows have no `Type` / `Weight` / `Reps` column header; weight has no placeholder text and uses a persistent muted `kg` suffix inside the field, and reps uses placeholder text `Reps`.
    - Tapping outside set inputs collapses all displayable editable set rows back to compact text; moving focus between weight and reps inside a row does not collapse the row.
    - `Weight` accepts decimal numeric input and must be a non-negative number.
    - `Reps` accepts integer numeric input and must be a positive integer.
    - Compact set text uses dot separators and explicit units (`60kg · 8 reps`, `BW · 6 reps`); quality stays in the right-side quality control rather than inside the main text.
    - Adding a set to an exercise copies the previous set's `Weight`, `Reps`, and quality values while assigning the new row its own identity; when the previous row has valid performed values, it is committed/collapsed. Adding after an unlogged planned target does not silently log it; the planned row remains until the user explicitly logs or skips it.
    - Logging a new exercise focuses its first `Weight` input, and adding a set focuses the new set's `Weight` input. Copied/defaulted values remain visible in inputs when edited and are not auto-selected.
    - Planned workout-execution rows use the same compact/edit row model in the same recorder card: planned rows are muted ghost rows with `Log`/`Skip`, matched rows show the confirmed planned target, modified rows show target-to-actual, skipped rows remain visible, and user-added unplanned rows are marked as added beyond the plan. Tapping a planned or skipped target to edit hydrates the actual `Weight`, `Reps`, and quality controls from the planned target before the row opens.
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
16. In `session-recorder`, each logged exercise card loads a volatile past-blocks comparison panel keyed by `exercise_definition_id`:
    - the panel sits below assigned tag chips and above editable set rows,
    - the panel starts collapsed as a slim `Past blocks` bar; tapping the bar expands it, and tapping the expanded header collapses it again without a separate Hide/Show button,
    - the most recent completed-session block is shown first when expanded and the header shows the selected previous block age plus `<<` older / `>>` newer controls with boundary controls disabled,
    - the expanded comparison uses four table-like rows (`Est. 1RM`, `Volume`, `Highest`, `Near failure`) with `Previous` values from the selected completed-session block and `Current` values derived live from the unsaved set rows on that exercise card,
    - current metrics follow the same Phase 0A rules as history metrics: warm-up sets are excluded, invalid/blank set inputs are ignored, `1RM` uses the existing Wathan helper, highest weight comes from eligible parsed sets, and `Near failure` counts valid `rir_0`/`rir_1`/`rir_2` sets,
    - empty (`No previous blocks`) and error (`Previous blocks unavailable`) messages appear only after expansion; collapsed state remains the same slim `Past blocks` bar,
    - past-blocks comparison state is volatile UI state only; it does not block set entry, tags, exercise actions, autosave, submit/save, or sync.

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

### 11. Calendar heatmap semantics

1. Muscle analytics calendar heatmaps render local dates in Monday-start weeks with visible column labels `Mon Tue Wed Thu Fri Sat Sun`.
2. The reusable heatmap component renders latest weeks first and uses 8 visible week rows by default; parent overlays may provide additional loaded history without changing bucket thresholds while the user scrolls that loaded window.
3. Zero-effort dates remain visible, neutral, tappable, and accessible.
4. Positive effort dates use stable green buckets derived from the shared selected-muscle daily effort totals.
5. Today's date uses a light-blue treatment that remains distinct from green effort intensity and selected-date styling.
6. Selected cells expose selected accessibility state and remain the parent surface's hook for any out-of-component detail panel.

### 12. Stats muscle-history overlay semantics

1. In `Stats / History`, expanded muscle rows are actionable rows that open the selected muscle's history overlay.
2. A collapsed single-muscle family header is actionable for its underlying muscle group; multi-muscle family headers remain non-actionable section headers.
3. The muscle-history overlay is in-route UI state, not route navigation. It occupies roughly three quarters of the screen height, uses the overlay scrim token, and dismisses via backdrop or close control.
4. Overlay loading, error, no-history, populated, selected positive-effort date, and selected zero-effort date states render inside the overlay and preserve backdrop dismissal.
5. A selected positive-effort date shows the selected local date, selected muscle group, effort score, heatmap bucket, session/set counts, contributing exercises, and compact contributing set rows derived from the same shared selected-muscle daily effort contributions that power the heatmap cell.
6. A selected zero-effort date remains selectable and shows the selected local date, selected muscle group, effort `0`, bucket `0`, and a clear no-training empty state for that muscle/date.
7. Selected-day set rows are explanatory only: they show concise raw set values plus weighted effort, preserve existing warm-up exclusion/invalid-set zero-effort semantics from the shared analytics helper, and do not duplicate completed-session detail navigation or editing affordances.
8. Certification markers are not rendered in the muscle-history overlay unless a real certification data source exists; v1 does not invent certification state.
9. Dismissing the overlay clears only transient selected-muscle/date UI state and does not mutate sessions, exercises, tags, sync data, or durable preferences.
10. The v1 overlay loads a capped one-year local completed-session history window for the selected muscle.

### 13. Exercise heatmap mode semantics (M17)

1. The `Stats / History` screen exposes a **Heatmap** chip below the period chips (Last 7 days / Last 30 days). This chip acts as a view-mode toggle: pressing it switches the body between the muscle-stats table (`viewMode: 'stats'`) and the exercise list (`viewMode: 'heatmap'`).
2. In Heatmap mode the exercise list is a flat list of exercises that have been trained at least once, sorted by all-time session count descending. Each row shows the exercise name, session count, volume, and estimated 1RM.
3. Tapping an exercise row in Heatmap mode opens an in-route `ExerciseHistoryOverlay` — the same overlay card structure as the muscle-history overlay (occupies ~75% screen height, backdrop-dismissible).
4. The `ExerciseHistoryOverlay` renders the reusable `CalendarHeatmap` component over a 365-day window for the selected exercise. The four metric chips (Volume / Near failure / 1RM / Top weight) and the week-selection banner follow the same interaction semantics as the muscle-history overlay.
5. The Heatmap chip active/inactive visual states use the `actionPrimary` / `actionPrimarySubtleBg` / `borderMuted` / `surfaceDefault` tokens; no raw color literals.
6. Dismissing the exercise overlay returns to the exercise list in Heatmap mode. It clears only transient selected-exercise/week UI state and does not mutate any data.
7. Volume for exercise analytics is raw `weight × reps` (no muscle-role weighting). This differs from the muscle-history overlay where volume is role-weighted.

### 14. Documentation maintenance rule (UI semantics)

1. If a task changes current UI semantics (action roles, state treatment, modal conventions, list interactions, validation behavior), update this file in the same task/session.
2. If the change is route-path/param/transition related, update `navigation-contract.md` in the same task.
3. If the change is component/primitives API related, update `components-catalog.md` in the same task.

## Pending / planned (not current behavior)

1. Additional primitive extraction (for example state panels, modal surfaces, row cards, form fields) remains pending to reduce route-local style duplication beyond the token convergence completed in Task `T-20260226-06`.
2. Additional primitives from the audit (for example `ScreenContainer`, `EmptyState`, `ModalSurface`) are candidates, not current required APIs.
3. Temporary raw-color guardrail allowlist entries remain available only for future exceptional migrations; current route-screen exceptions were cleared in Task `T-20260226-06`.
