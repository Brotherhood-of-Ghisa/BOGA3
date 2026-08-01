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
2. In the `session-recorder` exercise picker, shared list options, `Manage`, and `Add new` are compact icon actions in the modal header row (same row as the title), replacing the old bottom text-button row.
3. In the `session-recorder` exercise picker, tapping an exercise while adding a new recorder card opens an in-place preselection panel instead of immediately adding:
   - `Add empty set` is always available first and preserves the current blank-set add behavior.
   - `Append plan` remains visible but disabled while completed-history suggestion data loads or when no valid completed-history plan exists; the disabled state has no inline error copy.
   - Changing the search text dismisses the preselection panel and returns to the filtered list without changing grouped-list expansion state.
   - Changing/replacing an existing exercise remains a direct selection with no preselection panel.
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
6. `exercise-catalog` and the `session-recorder` exercise picker share exercise-list preferences and row semantics:
   - local-only shared preferences default to grouped by muscle family, `90d` range, and recents-on-top enabled; options are `7d`, `30d`, `90d`, `1y`, and `All`,
   - grouped mode shows taxonomy-ordered family headers (`Chest`, `Shoulders`, `Back`, `Arms`, `Core`, `Legs`, `Lower Legs`, `Other`) with `Family · count`; all groups remain visible, zero-count groups are disabled/collapsed, non-empty headers toggle expansion without chevrons or show/hide text, and active text search preserves collapsed/expanded state without flattening the list,
   - flat mode renders rows directly without an all-exercises section header,
   - recents-on-top sorts by valid completed-set recency score with a fixed 60-day half-life, includes warm-up sets, ignores active/unperformed/deleted/tombstoned rows, uses the selected finite date window, and caps `All` scoring to the last year; recents-off sorts alphabetically,
   - recorder picker rows use the same muscle summary and stats line as Exercise Catalog rows but hide catalog edit/delete actions and catalog-only filters.
7. Recorder picker historical preselection plans are sourced from completed workout history only, independent of the picker/catalog date-range setting. The plan uses the most recent completed session with valid performed set rows for the selected exercise; duplicate same-exercise blocks inside that session are combined in session order, and preview rows are numbered continuously. Valid plan rows require a non-negative numeric weight and a positive integer rep count; `0kg` is valid.

### 5. Forms and validation conventions

1. Text inputs, picker triggers, and read-only fields are visually similar but currently implemented in multiple screen-local styles.
2. Exercise catalog uses explicit field labels + inline validation/error messages and is the strongest current form pattern reference.
3. `session-recorder` completed-edit mode includes start/end validation and an autosave-paused notice when timestamps are invalid.
4. Validation/error feedback should remain near the relevant field/control whenever possible.
5. The `session-recorder` exercise picker and `exercise-catalog` list include a text filter that:
   - trims and collapses extra whitespace in user input,
   - matches case-insensitively,
   - matches when any typed word appears in either exercise names or linked muscle-group metadata.
   - preserves the current grouped/flat layout mode instead of flattening grouped results; grouped search results keep section headers and preserve collapsed/expanded state.
6. The M11 profile sign-in form keeps auth failure messaging inline inside the same card as the email/password inputs.
7. When auth config is unavailable, the profile route shows a warning state and disables sign-in rather than failing only after submit.
8. The M11 profile sign-in form performs basic client-side email-shape validation before attempting the auth request.
9. The signed-in profile route defaults to a view-only summary with row-based account values and one bottom action row (`Edit` + danger-styled `Sign Out`), with no extra title/help copy.
10. Entering profile edit mode reveals `username`, `new email`, and `new password` fields plus a single `Update` submit action; update failures stay inline and successful updates return to view mode.
11. In `session-recorder`, logged sets render as compact in-card text rows once they have displayable values; tapping the compact row turns it into inline editable inputs, and set numeric validation uses visual cues only (no inline validation text):
    - Every normal and planned execution row reserves a fixed left performance-control slot. The dedicated control uses checkbox semantics and a mobile-sized target: hollow circle means unconfirmed and green tick means valid confirmed actual values. Shape communicates state without color; the tick additionally uses `uiColors.actionSuccess`. The row body remains an independent edit target.
    - The former `Type` control is presented as right-side set quality in both compact and editable modes (`•`, `W-Up`, `RIR 0`, `RIR 1`, `RIR 2`); `•` maps to `null`, tapping cycles quality in the same order, and long-pressing opens the in-route modal picker with explicit options (`None`, `W-Up`, `RIR 0`, `RIR 1`, `RIR 2`). Untouched planned targets suppress this quality control; confirming or editing reveals actual quality. Quality is persisted separately from performance confirmation and planned volume; planned-row matched/modified classification compares prescribed volume only (`Weight` + `Reps`), not quality, and never controls the left indicator.
    - Editable set rows keep quality adjacent to the weight/reps text inputs; the quality button has a fixed width sized for `W-Up`, and removable compact/editable rows delete via a right-to-left swipe on the row surface rather than a visible `rm` control.
    - Set input rows have no `Type` / `Weight` / `Reps` column header; each exercise card communicates `Total load` or `Per side` once in its metadata, while each editable weight field keeps a compact muted `kg` suffix and no placeholder text. The full bordered weight shell, including the suffix area, focuses a numeric input with reserved digit width. Reps uses placeholder text `Reps`. A nonblank weight retains the entered scalar; blank weight with positive integer reps commits and persists as `0`.
    - Tapping outside set inputs collapses the editable set row back to compact text; moving focus between weight and reps inside a row does not collapse the row. At most one set row is editable at a time. When one row is editable, the first tap on another compact set row only collapses the current row; the tapped row opens on a second tap.
    - `Weight` accepts decimal numeric input and must be a non-negative number.
    - `Reps` accepts integer numeric input and must be a positive integer.
    - `W-Up` marks a set as warm-up effort; warm-up sets still count toward volume, estimated 1RM, highest/top weight, heatmaps, and other strength/volume statistics, but are not working sets. A working set is a valid confirmed `RIR 0`, `RIR 1`, or `RIR 2` set. Use `Working set(s)` where space permits and `W/set` / `W/sets` in compact UI.
    - Compact set rows separate the `Set N` label from the value text with layout spacing rather than an inline dot (`Set 1    60kg · 8 reps`, `Set 2    0kg · 6 reps`); weight, separator dot, and reps are laid out in fixed slots so the dot spacing is consistent across one-line and modified rows. Quality stays in the right-side quality control rather than inside the main text.
    - Adding a set to an exercise copies the previous set's `Weight`, `Reps`, and quality values while assigning the new row its own identity and unconfirmed status. Valid copied values remain unperformed until the hollow control is tapped. Adding after an untouched planned target does not perform it; the planned row remains until explicitly confirmed.
    - Logging a new exercise focuses its first `Weight` input, and adding a set focuses the new set's `Weight` input. When the new set copies a nonblank weight, the automatically focused field selects the full copied value so the next keystroke replaces it.
    - Planned workout-execution rows use the same compact/edit and left confirmation control as normal rows. Their plan-derived origin is shown in untouched, confirmed/matched, and modified states through the semantic soft blue-grey planned-row background and border while inactive; selected planned and user-added rows share the same light-blue background and blue border. There is no separate last-added tint and no `Plan` badge beside `Set N`; the hollow/tick shape remains the performance-status channel. An untouched row shows its prescription and hollow control with no `Skip` or `Log` action. Tapping the hollow control performs valid prescribed values directly. Tapping a planned row body hydrates the prescription into unconfirmed actual `Weight`, `Reps`, and quality for editing. Modified rows retain the struck prescription above aligned actual values. Planned rows are never swipe-deletable; user-added rows retain right-to-left swipe delete. Accessibility labels identify planned versus added origin so color is not the only source channel.
    - Appending a historical plan expands and reveals its target exercise card with one automatic scroll, but all exercise cards retain the same background and border styling. That scroll is consumed after the first successful card layout; later set edits, expansion/collapse, keyboard changes, and card layouts preserve the user's viewport.
    - Active and completed-edit autosave preserve every set row, including fully blank, partial, valid unconfirmed, and planned rows, with stable identity, values, quality, confirmation status, and order across input blur, tab/route navigation, hydration, sync, and restore. Legacy persisted `skipped` planned rows hydrate as untouched planned rows. Blank or invalid reps remain incomplete; valid unconfirmed rows remain excluded from performed semantics. Completion uses separate explicit cleanup decisions for incomplete rows and entered-but-unconfirmed rows. The `/sessions` active-session completion affordance returns to the recorder so it cannot bypass this cleanup flow.
    - Exercise cards start expanded and their title region toggles a volatile collapsed state, with a top-aligned circular chevron control that uses the same primary-blue emphasis as the adjacent `#` action; the overflow action remains muted. Collapsing dismisses the keyboard and closes editable rows or set-quality pickers inside that exercise without changing set data; replacing the exercise definition or appending a plan expands its target card.
    - A collapsed exercise shows `<confirmed performed sets> · <working sets>` (for example `4 sets · 2 w/sets`). Blank, partial, invalid, planned, warm-up, null-quality, and valid-but-unconfirmed rows do not contribute to the working-set count; valid confirmed warm-up or null-quality rows still contribute to the performed-set count.
    - An active/completed-edit exercise shows the single-line summary `PR: <weight> kg × <reps> reps · est. 1RM <rounded kg> kg`, both expanded and collapsed, only when its best valid current Wathan estimate strictly exceeds the maximum loaded completed-history estimate. Expanded cards place it directly below the performed-set count and above `Past Records`; collapsed cards place it below the set/working-set summary. Ties, first-ever exercises with no historical maximum, and loading/empty/error history states show no PR line.
12. The shared exercise editor dismisses the text keyboard before opening primary/secondary muscle selectors, and selector lists remain keyboard-aware so all muscle-group options stay reachable on iOS. It exposes a two-choice `Total load` / `Per side` control, preselects the stored value while editing, and defaults new custom exercises to total load.
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
16. In `session-recorder`, each logged exercise card loads a volatile `Past Records` comparison panel keyed by `exercise_definition_id`:
    - the panel sits below assigned tag chips and above editable set rows,
    - the panel starts collapsed as a slim `Past Records` bar; tapping the bar expands it, and tapping the expanded header collapses it again without a separate Hide/Show button,
    - if a set row is editable, the first tap on the `Past Records` bar only collapses that row; a second tap opens the panel,
    - all available completed, non-deleted history for the exercise is loaded by default; optional numeric limits remain a repository/test hook, not the recorder default,
    - the most recent completed-session block is shown first when expanded; swiping right selects an older record and swiping left selects a newer record,
    - the expanded comparison uses four table-like rows (`Est. 1RM`, `Volume`, `Highest`, `Working sets`) with columns for metric label, selected record local date (`YYYY-MM-DD`), live `Current`, and `Max`,
    - `Max` values are computed from the same loaded records the panel can swipe through plus valid current-session metrics; there is no separate all-time query or hidden max scope,
    - displayed non-empty `Max` values use `uiColors.heatmapBucket4`,
    - selected historical values use `uiColors.heatmapBucket4` when they equal `Max`; live current values use the same token when they meet or beat `Max`,
    - current metrics follow the same Phase 0A rules as history metrics: only valid confirmed sets contribute; confirmed warm-up sets count for volume, `1RM`, and highest weight; invalid/blank/unconfirmed set inputs are ignored; `1RM` uses the existing Wathan helper; highest weight comes from eligible parsed sets; and `Working sets` counts only confirmed valid `rir_0`/`rir_1`/`rir_2` sets,
    - left/right swipes on the whole expanded panel surface change the selected historical record, and the header copy reads `swipe for records`,
    - empty (`No past records`) and error (`Past records unavailable`) messages appear only after expansion; collapsed state remains the same slim `Past Records` bar,
    - `Past Records` comparison state is volatile UI state only; it does not block set entry, tags, exercise actions, autosave, submit/save, or sync,
    - planned/unconfirmed rows remain visible and autosavable during active recorder work, but final active-session submit and completed-edit save persist completed workout history as confirmed actual sets only. Entered valid unconfirmed rows require a specific discard prompt; untouched planned rows remain actual-only omissions, and exercises emptied by completed filtering use the existing empty-exercise cleanup flow.

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

1. Completed-session detail uses a sticky action bar for session-level edit/delete actions above the detail content.
2. Historical exercise cards expose their own `Append` action in the card header; append copies that one exercise block as planned target rows into the active recorder.
3. `intent=edit` on the completed-session route is a redirect behavior, not a separate screen.
4. Completed-session exercise cards show assigned tags as chips under the exercise title only when one or more tags exist; no tag placeholder is shown when there are none.
5. Completed-session set tables show historical set effort from `set_type` as `W-Up`, `RIR 0`, `RIR 1`, `RIR 2`, or `-` for unspecified sets.
6. Completed-session exercise cards start expanded and use the same title-region collapse affordance. Their collapsed summary shows valid performed-set and working-set counts (`RIR 0`/`RIR 1`/`RIR 2`); the header-level `Append` action remains available. Historical cards do not label a workout as a new PR because this viewer does not compute an as-of-session history comparison.

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
10. The overlay renders `Volume` and `W/sets` metric chips, defaults to
    `Volume`, and uses the selected metric for both weekly and daily heatmap
    values and detail. Muscle volume is the per-side, role-weighted aggregate
    across the selected muscle IDs; estimated 1RM and top weight remain
    unavailable for muscle-level history.
11. The v1 overlay loads a capped one-year local completed-session history window for the selected muscle.

### 13. Stats exercise/muscle history semantics

1. The `Stats / History` screen exposes a `By Muscle` / `By Exercise` view-mode chip beside the Last 7 days / Last 30 days period chips. Pressing it switches the body between the muscle summary and exercise list.
2. In the per-exercise mode the list is flat and includes exercises trained at least once. Rows sort by valid performed-set count descending, then exercise name. Each row shows `Sets` as `<valid performed sets> (<near-failure sets>)`, raw exercise `Volume`, and estimated `1RM` when available. Near-failure means the valid performed `RIR 0` / `RIR 1` / `RIR 2` subset; warm-up, null, and unknown-quality rows remain in the leading set count but not the parenthesized count.
3. Tapping an exercise row in per-exercise mode opens an in-route `ExerciseHistoryOverlay` — the same overlay card structure as the muscle-history overlay (occupies ~75% screen height, backdrop-dismissible).
4. The `ExerciseHistoryOverlay` renders the reusable `CalendarHeatmap` component over a 365-day window for the selected exercise. It keeps the four metric chips (Volume / W/sets / 1RM / Top weight) plus the week-selection banner; unlike muscle-history, it remains a multi-metric exercise-specific view.
5. The view-mode chip uses the shared action, border, and surface tokens; no raw color literals.
6. Dismissing the exercise overlay returns to the exercise list in per-exercise mode. It clears only transient selected-exercise/week UI state and does not mutate any data.
7. Volume for exercise analytics is raw `weight × reps` (no muscle-role weighting). This differs from the muscle-history overlay where volume is role-weighted.
8. In the per-muscle mode every family and visible nested-muscle row shows `Sets` in the same `<set count> (<near-failure count>)` form plus `Volume`. Family set counts union physical source-set identities across contributing primary/secondary muscles, so one set mapped to two muscles in one family counts once. Family volume still sums member-muscle contributions.
9. Per-muscle previous-period set comparisons use signed absolute pairs (`+4 (+1)`, `−2 (−1)`, `±0 (−1)`) and never percentages. Volume comparisons use percentage only (`+17%`, `−100%`, `±0%`), with `—` for zero-to-zero and `new` for positive volume over a zero baseline. Muscle/family volume remains the shared per-side, role-weighted calculation.
10. Per-muscle family name cells render a light-to-dark green failure-intensity ramp; visible nested-muscle name cells use the semantic light-yellow-to-orange ramp. Width is `clamp(nearFailureCount / (8 × periodDays / 7), 0, 1)`. The ramp is decorative, stays within the name cell, does not intercept presses or become an accessibility target, and supplements the readable near-failure count. Its full-width threshold is a display scale only—not a goal, recommendation, limit, or warning. Row accessibility copy states the exact near-failure count and selected-period threshold.

### 14. Documentation maintenance rule (UI semantics)

1. If a task changes current UI semantics (action roles, state treatment, modal conventions, list interactions, validation behavior), update this file in the same task/session.
2. If the change is route-path/param/transition related, update `navigation-contract.md` in the same task.
3. If the change is component/primitives API related, update `components-catalog.md` in the same task.

## Pending / planned (not current behavior)

1. Additional primitive extraction (for example state panels, modal surfaces, row cards, form fields) remains pending to reduce route-local style duplication beyond the token convergence completed in Task `T-20260226-06`.
2. Additional primitives from the audit (for example `ScreenContainer`, `EmptyState`, `ModalSurface`) are candidates, not current required APIs.
3. Temporary raw-color guardrail allowlist entries remain available only for future exceptional migrations; current route-screen exceptions were cleared in Task `T-20260226-06`.
