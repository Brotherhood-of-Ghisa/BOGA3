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
     - `Resume workout`, `Start empty workout` / `Start planned workout`
     - `Finish` / `Done` / `Save Changes`
     - `New Exercise`
   - In the design language a primary is the screen's one `accent` button
     (`ui/design-language.md` §5). Train shows both starts when a plan is
     ready: the planned start is the primary and the empty start is an outline.
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
4. Tab actions (`MainTabs`) are navigation controls, not generic primary actions.
   - They use tab semantics (`accessibilityRole="tab"` / tablist), active-state
     visuals, and equal-width flex targets across the available tray width.
   - The active tab is marked by weight and an `ink` underline, never by
     colour alone and never in `accent` (which is the screen's one primary).
5. Persistent navigation contains exactly Today, Train, Progress, and More.
   - Settings is an internal row under More, not a fifth tab or utility button.
   - More and Settings remain available while logged out so account access never
     blocks the local-first tracker entry routes.
6. Settings and More distinguish internal destinations from public setup links.
   - Internal rows use button/navigation semantics and stay in the app.
   - `Connect an AI coach` visibly carries an external indicator, uses link
     semantics plus an external-browser accessibility hint, and opens only the
     configured first-party `/connect` page with no OAuth or session state.
   - A failed browser launch leaves the current screen usable, shows concise inline
     feedback beside the link, and keeps the same action retryable.
   - More groups real destinations under Community, Tools, and Library &
     account; account-bound rows are omitted without a user and
     developer-only rows use `isDevMode()`.
   - Each More row's accessible name includes its visible description. The
     Exercise Catalog, Settings and Gyms rows carry `source=more` and show an
     explicit `Back to More` action; direct routes and non-More origins do not
     claim that history. Groups looks the same however it is opened. Gyms sits
     under Tools; it is also reached from the session view's `Gym` sheet.
   - Settings Preferences holds device-local choices shown as single-select
     option buttons (`accessibilityRole="button"` + `selected`): the date format.
     There is no screen choice: every active-session entry opens the session
     view (`/session/<id>`).
7. Today is a bounded overview, not a second full feed or history screen.
   - An active draft replaces the planned-session action and exposes Resume.
   - Joined-group activity reuses the group stream session cards, record cards,
     membership rows, and offline/error patterns and is limited to the three
     newest session, record, or membership items. Records show whether or not
     they are certified, read-only (no `Certify`); a record or membership row
     opens the Groups screen on its group.
   - Recent personal activity is limited to the three newest non-deleted
     completed sessions; full history remains owned by Progress.
   - When the separate planning dependency is absent, Today uses the approved
     `Watch this space 👀` placeholder and offers Train; it never invents a
     scheduled session or metric.
8. Train is the personal-training entry hub, while the session view remains
   focused on performing one workout.
   - Active-session detection must succeed before Train exposes any new-session
     action; a detection error is retryable and does not assume that no draft
     exists.
   - An active draft replaces empty and planned start actions with one Resume
     action.
   - Today and Train use the same session-entry coordinator. It rechecks the
     active draft at press time and serializes competing requests so an empty
     or planned action cannot create a second concurrent session.
   - Empty start persists one blank active draft through the session
     repository (`src/session-recorder/`) before opening it in the session
     view. A failed write stays inline and retryable.
   - Planning loading/error/empty/ready/unavailable states are explicit. Until
     the planning dependency ships, production shows the approved `Watch this
     space 👀` placeholder while leaving empty training usable; it does not
     guess a management route or plan.
   - Exercise selection remains contextual inside the session view (its
     exercise picker). Exercise-database administration remains owned by More,
     not Train.

### 2. Modal and overlay semantics

1. Most secondary workflows in current screens use in-route modal/overlay UI state instead of route changes.
   - Examples:
     - session list action menus
     - exercise catalog editor/action/delete modals
     - the session view's `Gym` sheet, ⋮ menu, exercise picker and the picker's inline exercise creation editor
2. In the exercise picker (the session view's `+ Add exercise`; `components/session-recorder/exercise-picker.tsx`), shared list options, `Manage`, and `Add new` are compact icon actions in the modal header row (same row as the title).
3. In the exercise picker, tapping an exercise opens an in-place preselection panel instead of immediately adding:
   - `Add empty set` is always available first and adds the exercise with one blank set.
   - `Append plan` remains visible but disabled while completed-history suggestion data loads or when no valid completed-history plan exists; the disabled state has no inline error copy.
   - Changing the search text dismisses the preselection panel and returns to the filtered list without changing grouped-list expansion state.
   - The picker only adds; replacing an exercise is the exercise page's `Swap exercise` (§14a.5), which keeps the sets.
3. Modal open/close is treated as state within the current route and should not be documented as a navigation transition.
4. Dismiss overlays via backdrop press are common and expected when the flow is not destructive-final.

### 3. Screen layout and spacing conventions (current app behavior)

1. Current user-facing screens use vertical layouts with no horizontal scrolling on phone widths.
2. Page backgrounds are muted light surfaces (`surfacePage`-like behavior), with card/panel surfaces layered on top.
3. Spacing rhythm is already close to 8pt increments (common values cluster around `8/10/12/14/16/20`) and should remain consistent.
4. Bottom tab navigation (`BottomTray` composing `MainTabs`) remains visible on
   canonical roots (`today`, `train`, `progress`, `more`) and recognized
   preserved roots. No route collapses the tray on entry; the lifter drags it
   to its always-visible peek handle. `exercise-history` renders the same
   `MainTabs` directly and selects Progress.

### 4. List and row interaction conventions

1. Pressable list rows commonly separate:
   - main row press target (open/edit primary action)
   - trailing kebab/icon action for secondary actions
2. This split interaction pattern is used in `exercise-catalog` and in the shared `HistoryList` / `ActiveSessionRow` building blocks (consumed by Progress/`stats-history` and session-list flows), and should be preserved during refactors unless behavior intentionally changes.
3. Deleted/archived visibility is controlled via toggles and state hints, not separate routes.
4. In `exercise-catalog`, deleted exercises remain in list history when deleted visibility is enabled, show explicit `Deleted` state, and expose `Undelete` from row actions.
5. `exercise-catalog` top actions use compact icon buttons (`+` create, kebab options), and deleted visibility toggle lives under the top-level options menu.
6. `exercise-catalog` and the exercise picker share exercise-list preferences and row semantics:
   - local-only shared preferences default to grouped by muscle family, `90d` range, and recents-on-top enabled; options are `7d`, `30d`, `90d`, `1y`, and `All`,
   - grouped mode shows taxonomy-ordered family headers (`Chest`, `Shoulders`, `Back`, `Arms`, `Core`, `Legs`, `Lower Legs`, `Other`) with `Family · count`; all groups remain visible, zero-count groups are disabled/collapsed, non-empty headers toggle expansion without chevrons or show/hide text, and active text search preserves collapsed/expanded state without flattening the list,
   - flat mode renders rows directly without an all-exercises section header,
   - recents-on-top sorts by valid completed-set recency score with a fixed 60-day half-life, includes warm-up sets, ignores active/unperformed/deleted/tombstoned rows, uses the selected finite date window, and caps `All` scoring to the last year; recents-off sorts alphabetically,
   - picker rows use the same muscle summary and stats line as Exercise Catalog rows but hide catalog edit/delete actions and catalog-only filters.
7. Exercise picker historical preselection plans are sourced from completed workout history only, independent of the picker/catalog date-range setting. The plan uses the most recent completed session with valid performed set rows for the selected exercise; duplicate same-exercise blocks inside that session are combined in session order, and preview rows are numbered continuously. Valid plan rows require a non-negative numeric weight and a positive integer rep count; `0kg` is valid.

### 5. Forms and validation conventions

1. Text inputs, picker triggers, and read-only fields are visually similar but currently implemented in multiple screen-local styles.
2. Exercise catalog uses explicit field labels + inline validation/error messages and is the strongest current form pattern reference.
3. Editing a completed session (the session view, §14b.7) validates Start/End (`YYYY-MM-DD HH:mm`, End not before Start) and shows an autosave-paused notice while they are invalid.
4. Validation/error feedback should remain near the relevant field/control whenever possible.
5. The exercise picker and `exercise-catalog` list include a text filter that:
   - trims and collapses extra whitespace in user input,
   - matches case-insensitively,
   - matches when any typed word appears in either exercise names or linked muscle-group metadata.
   - preserves the current grouped/flat layout mode instead of flattening grouped results; grouped search results keep section headers and preserve collapsed/expanded state.
6. The M11 profile sign-in form keeps auth failure messaging inline inside the same card as the email/password inputs.
7. When auth config is unavailable, the profile route shows a warning state and disables sign-in rather than failing only after submit.
8. The M11 profile sign-in form performs basic client-side email-shape validation before attempting the auth request.
9. The signed-in profile route defaults to a view-only summary with row-based account values and one bottom action row (`Edit` + danger-styled `Sign Out`), with no extra title/help copy.
10. Entering profile edit mode reveals `username`, `new email`, and `new password` fields plus a single `Update` submit action; update failures stay inline and successful updates return to view mode.
11. Set semantics, shared by the exercise page (§14a) and the session view (§14b) through `src/session-recorder/` (presentation is theirs; set numeric validation uses visual cues only, no inline validation text):
    - `Weight` accepts decimal numeric input and must be a non-negative number. `Reps` accepts integer numeric input and must be a positive integer. A nonblank weight retains the entered scalar; blank weight with positive integer reps commits and persists as `0`.
    - Effort (set quality) is `W-Up`, none (`null`), or `RIR n`; the selectable RIR range runs from `EFFORT_LOGGING_POLICY.maxSelectableRir` (`src/config/training.ts`, default `3`) down to `RIR 0`, and a stored RIR outside that range stays valid. It is persisted separately from performance confirmation and planned volume; a planned row's matched/modified classification compares prescribed volume only (`Weight` + `Reps`), not effort.
    - `W-Up` marks a set as warm-up effort; warm-up sets still count toward volume, estimated 1RM, highest/top weight, heatmaps, and other strength/volume statistics, but are not working sets. A working set is a valid confirmed RIR set meeting the file-based `WORKING_SET_POLICY.maxRir` threshold (`src/config/training.ts`, default RIR-3 or harder); the threshold has no Settings control and does not restrict the effort cycle or RIR inheritance. Use `Working set(s)` where space permits and `W/set` / `W/sets` in compact UI.
    - The first new ad-hoc set of each exercise defaults to `W-Up`. Adding a set copies the previous set's `Weight` and `Reps`; effort defaults to blank after `W-Up` or blank, and inherits the previous RIR otherwise. Each new row gets its own identity and unconfirmed status. These defaults never rewrite existing sets or prescribed effort. Valid copied values remain unperformed until ticked. Adding after an untouched planned target does not perform it; the planned row remains until explicitly confirmed. The added set's `Weight` input takes focus and selects a copied value, so the next keystroke replaces it.
    - Active and completed-edit autosave preserve every set row, including fully blank, partial, valid unconfirmed, and planned rows, with stable identity, values, effort, confirmation status, and order across input blur, tab/route navigation, hydration, sync, and restore. Legacy persisted `skipped` planned rows hydrate as untouched planned rows. Blank or invalid reps remain incomplete; valid unconfirmed rows remain excluded from performed semantics.
    - Final active-session submit and completed-edit save persist completed workout history as confirmed actual sets only. Completion uses separate explicit cleanup decisions for entered-but-unconfirmed rows (a specific discard prompt) and incomplete rows (§14b.2); untouched planned rows are actual-only omissions, and exercises left empty use the same cleanup prompt. The `/sessions` active-session completion affordance opens the session view, so it cannot bypass this cleanup.
12. Retired (2026-09-23): there is no live per-session muscle summary while training. The completion screen's per-muscle working-set pills (§7.7) remain.
13. The shared exercise editor dismisses the text keyboard before opening primary/secondary muscle selectors, and selector lists remain keyboard-aware so all muscle-group options stay reachable on iOS. It exposes a two-choice `Total load` / `Per side` control, preselects the stored value while editing, and defaults new custom exercises to total load.
14. GPS gym detection is quiet assistance, and it **suggests only** (decided
    2026-09-23):
    - opening the session view's `Gym` sheet runs one foreground location read
      (a 1.5 s budget; the permission prompt, when due, first appears here);
      exactly one confident match against the unarchived gyms with a saved
      location shows as the sheet's first row, `Nearby · <gym>`, and one tap
      selects it; the sheet never selects it for the lifter, and it is not
      shown for the gym the session already has,
    - starting a session never preselects a gym (every start goes through
      `src/session-entry/coordinator.ts` with `gymId: null`), and there is no
      long-press retry,
    - permission denial, services off, low accuracy, no match, a tie, a read
      failure and no fix within the budget show no suggestion row and leave the
      gym unchanged; the list below is usable at once,
    - manual selection and `No gym` are always authoritative.
15. The session view's `Gym` sheet includes `No gym` as a null session-gym
    option:
    - it maps to nullable `session.locationId` / persisted `gym_id`,
    - it is not a `gyms` row and is not editable, archived, synced, or shown on
      the Gyms screen,
    - null gym state displays as `No gym`, not as an unresolved choose prompt,
    - the sheet lists the unarchived gyms (the seeded gyms, then the local ones
      by name) with the current one marked, and its `Manage gyms` footer row
      opens `/gyms`; back on the session view the sheet reopens with the gyms
      reloaded.
16. Gym management lives on the Gyms screen (`/gyms`), with private
    coordinate controls in the gym's own editor:
    - each gym shows only location presence (`Location saved` / `No location
      saved`), never latitude/longitude precision,
    - a row opens its editor in place (like the exercise page's logger); the
      editor holds the name, the location controls and `Archive` /
      `Unarchive`; list rows carry no location or archive action,
    - `Save current location` reads foreground location and saves only a fix
      accurate enough to match later; a new gym's location is staged and saved
      with `Add gym`, and adding a gym never reads the location unless asked
      (`/gyms` is not necessarily where the gym is),
    - `Replace` and `Clear` each confirm inline first,
    - permission denial, services off, low accuracy and write failures stay
      inline in the editor and leave the saved location unchanged,
    - clearing a location removes the gym from GPS suggestion until one is
      saved again,
    - `Archive` is the synced soft delete (`gyms.deleted_at`): the gym leaves
      the sheet and GPS suggestion, keeps naming its past sessions, and returns
      with `Unarchive` from `Show archived`; there is no hard delete.
17. Retired (2026-09-23): the per-card `Past Records` panel is gone. An exercise's history is the exercise page's records panel (§14a.4) and its `History` link.

### 6. Loading, empty, error, and feedback state handling

1. Whole-screen loading/error states are used when route data cannot render meaningful content yet.
   - `exercise-catalog`: centered state + More-selected bottom tabs remain visible
   - `completed-session/[sessionId]`: centered state variants on `paper`; the detail keeps its top bar's back, the completion its one safe exit
2. In-section state panels are used inside the shared `HistoryList` (loading/error/empty) consumed by the `stats-history` History sub-view.
3. Inline helper/success/error text is used for form feedback and post-action feedback (`exercise-catalog`, a failed write on the completed-session detail).
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
6. The `/sessions` list uses route focus as its single automatic refresh
   trigger: the first focused presentation loads once, each later blur-to-focus
   transition loads once, and filter or mutation refreshes remain explicit.
   Superseded and unmounted requests cannot replace the newest visible result.

### 7. Completed-session detail screen semantics

1. The detail (View Session) is in the design language, like the session view
   it opens: `paper` ground, its own top bar `back · View Session · ⋮ · Edit`,
   with `Edit` the screen's one `accent` action (it pushes the session view on
   the session, §14b.7, whose `Done` sits in the same place). The session ⋮
   opens a `Session` sheet with `Delete session` (danger), or `Undelete session`
   while the session is deleted; neither confirms, since each undoes the other.
   A deleted session shows a `Deleted · hidden from history` band and no `Edit`,
   because the session view edits only a live session. A failed write shows
   inline in `danger` and changes nothing.
2. Appending is rare, so it sits behind each exercise card's ⋮: `Append to
   current session` copies that one exercise block as planned target rows into
   the active session (a new one when none is active) and opens it in the
   session view. The cards themselves are not links.
3. `intent=edit` on the completed-session route is a redirect behavior, not a separate screen.
4. The summary card shows `Start` and `End` as `YYYY-MM-DD HH:mm` (the layout of
   the completed edit's fields, read-only), then `Duration`, `Gym`, `Sets` and
   `Volume` (the confirmed sets with valid values, and their entered-load
   volume, no thousands separator).
5. Each exercise card shows its name, `n sets` and one row per confirmed set
   with valid values — the session view's row, `type · weight × reps · 1RM ·
   VOL` (`W-Up`, `RIR n` for any valid stored RIR, `—` for none). An exercise
   with no such set is left out. There are no tags, no collapse and no set
   numbers.
6. A card whose set has the exercise's best 1RM against every other completed
   session shows that 1RM in `record` and a `New 1RM record` band — the same
   derivation, and the same card, as the session view's completed edit
   (§14b.4, §14b.7), so the `Edit`/`Done` loop shows one card on both sides.
   History is optional enrichment: while it loads, or if it fails, no record
   shows.
7. `presentation=completion` is a post-submit presentation of the stored
   completed session, not durable celebration state, in the design language
   (`components/session-complete/`). Its own top bar reads `Session complete` ·
   `Done` (`accent`, where the session view's Finish sat); then the summary
   card, every `Personal records` card when present, one `Exercise volume` card
   per performed exercise, and `Share session` (an outline). The summary card
   shows `Duration`, `Exercises`, `Sets`, `Working` and `Gym` as stacked
   figures, then non-interactive per-muscle pills (name and the number of
   physical working sets mapped to that muscle). It never links to muscle
   analytics. Personal-record/comparison history is optional enrichment: its
   loading or failure never blocks stored context or exits, and current
   exercise rows still render with an explicit no-history state.
8. A personal record is shown in the language's one superlative: a `record`
   band (`New 1RM record · <1RM>`), the exercise and its set (`185.0 × 8`), the
   1RM bold `record` — no `kg`, no "est.". Exercise-volume cards show the
   exercise name with smaller performed/working-set counts, the session's `Vol`
   figure (no separator, no unit) versus the historical median, and a
   horizontal P5–P95 range with median/current markers when a distribution
   exists. Single/equal baselines and no-history rows use explicit
   non-distribution states; range bars are descriptive context, never targets
   or readiness guidance, so they use no `accent`.
9. `Share session` opens a `Sheet` previewing the exact session-summary image;
   `Share image` is its one action, and the backdrop closes it (there is no
   Cancel; it cannot close while an image is being prepared). The captured PNG
   contains session/date/count totals, working sets, every PR, and every
   exercise comparison; it excludes gym/location data. Nothing is uploaded or
   published by BOGA. Native-sheet cancellation is silent, capture/launch
   failure is inline and retryable, and temporary image cleanup cannot turn a
   completed share into an error.
10. Completion hides edit/delete/append. Done and Android back replace to
    Progress, and the back gesture is off. A completed row in Session History,
    and a completed session's `Edit`, open the session view to edit it
    (§14b.7); there is no separate historical summary (`presentation=summary` was
    removed — the completed-session detail is the summary). A
    missing, deleted, or failed target shows the top bar without Done and one
    safe exit, `Back to Progress`, and never opens an editable copy.

### 8. Navigation/query semantics (UI-facing rule)

1. Route mode/state changes that affect screen behavior (for example the session view editing a completed session) must be documented in `docs/specs/ui/navigation-contract.md`.
2. Route alias behavior (`/` -> `/today`) should be treated as a navigation
   entry alias, not a unique screen design. `/stats-history` remains a preserved
   Progress-owned path rather than a second tab.
3. `exercise-catalog` supports session-entry query semantics (`source=session`, `intent=manage`) for the exercise picker's `Manage` flow (back returns to the session view with the picker as it was left), while the picker's `Add new` uses the same exercise editor inside the session view route.
4. Stats / History accepts validated initial `period=7|30` and
   `breakdown=exercise|muscle` values. Absent or invalid values retain the
   seven-day / By Exercise defaults; in-screen changes remain volatile state.

### 9. UI guardrail enforcement (current enforced rules)

Enforced by `apps/mobile/scripts/check-ui-guardrails.js`, which runs as the
`ui-guardrails` lane of `boga test fast` and as a CI step. It scans
`apps/mobile/app/**/*.tsx` and `apps/mobile/components/**/*.tsx`, excluding
tests, snapshots and stories.

**Zero-tolerance rule (blocks on sight):**

1. Do not add raw color literals (`#hex`, `rgb(...)`, `rgba(...)`) directly in screen/component `.tsx` files.
2. Use UI tokens from `apps/mobile/components/ui/tokens.ts` directly or through primitives in `apps/mobile/components/ui/`.
3. Temporary exceptions require an explicit allowlist entry and rationale in `apps/mobile/scripts/ui-guardrails.config.js`.
4. No file holds a raw-color allowlist exception (`allowlistedFiles` is empty for every rule).

**Ratchet rules — all now at budget `0`:**

5. `rawFontSize`, `rawSpacing` and `rawRadius` flag numeric literals for
   `fontSize`, the `padding`/`margin`/`gap` family, and the `borderRadius`
   family. Use `uiTypography.size.*`, `uiSpace.*` and `uiRadius.*` instead.
6. Each carries a `budget` in `apps/mobile/scripts/ui-guardrails.config.js`.
   They started at 196 / 416 / 130 and reached **0**, so in practice all four
   rules are now zero-tolerance. The mechanism stays: the check fails when a
   change goes **over** budget, and equally when it drops **under** budget
   without lowering the number.
7. **Raising a budget is never the fix for a failure.** If a screen genuinely
   needs a value the scale does not have, that is a case for changing the
   scale in `tokens.ts` — not for reintroducing a literal.
8. `0` is not counted for spacing or radius: it is the absence of the value, not
   a point on the scale.

Guardrail commands (run from `apps/mobile/`):

- `npm run lint:ui-guardrails`
- Audit mode (colour): `npm run lint:ui-guardrails -- --include-allowlisted`
- Per-violation detail for the ratchet rules: `npm run lint:ui-guardrails -- --verbose`
- Lower budgets after a cleanup: `npm run lint:ui-guardrails -- --update-budgets`

### 9a. The token scales (current, enforced)

Every value below is what `apps/mobile/components/ui/tokens.ts` holds, and the
guardrail keeps screens on them.

`tokens.ts` also exports **`uiRoles`** — the colour roles of
`ui/design-language.md` §2, added 2026-09-22 for the exercise/session rebuild.
It is a second, separate vocabulary from `uiColors`, deliberately not merged
into it. Its users are the session view and exercise page (§14a/§14b), the
Gyms screen and the completed-session detail (§7); the rules below still describe
everything else that renders today. Likewise **`uiFonts`** (added 2026-09-22) names
the three embedded typefaces of `ui/design-language.md` §3 and the weights of
each that ship; only those screens use it, so every other screen still
renders in the system font. And **`uiGeometry`** (added 2026-09-22) carries the design
language's own radii (card 6, sheet 16), the 44pt tap target, the 38pt metric
column, the sheet handle and micro-label tracking — a separate vocabulary from
the legacy scales below, which it does not extend, so rule 5's three radii still
hold for everything shipped. Its only consumers are the design-language
primitives (`components-catalog.md` 6 and 6a) and those screens.

1. **Type: 8 sizes.**
   `xxs 10 · xs 11 · sm 12 · md 13 · base 14 · lg 16 · xl 18 · xxl 24`.
   Down from the 14 distinct sizes that used to ship. `base` stays at **14px**
   by decision (2026-09-19): density was chosen over gym-floor legibility. `15` folded up into `14`, `17` into `16`, `20` into
   `18`, and `22`/`26` into `24`. **`xxs` (10) was added 2026-09-22** for
   micro-labels — legends, units, tertiary labels — which the accepted design
   target drew at 8/9px; both lift to 10 rather than earning rungs of their own,
   since 8px body-adjacent text was poor for accessibility — so `9` now folds up
   into `10` rather than into `11`.
   No other rung moved when `xxs` was added; the design-language screens use it
   for micro-labels, and `apps/mobile/app/__tests__/ui-design-tokens.test.ts`
   holds all eight rungs and their line-heights. Reasoning:
   `ui/design-language.md` §3.
2. **Every size has a line-height**, in `uiTypography.lineHeight`, keyed to the
   same names: `14 · 15 · 16 · 18 · 20 · 22 · 24 · 30`. `UiText`'s prose
   variants apply them, so vertical rhythm no longer depends on the platform
   font's own leading.
3. **Uppercase is one role.** Reserve `textTransform: 'uppercase'` for
   micro-labels — `xxs` (10) on the new surfaces, `xs` (11) on everything
   shipped before 2026-09-22; do not apply it at other sizes.
4. **Spacing: 6 steps.** `xs 4 · sm 8 · md 12 · lg 16 · xl 24 · xxl 32`. The
   old scale interleaved `2 / 10 / 14 / 20` with the 4/8/12/16 rhythm, which
   made every value on-scale and the scale non-constraining. The retired
   `xxs` (2) and `screen` (20) keys are gone — page gutters use `xl`. (Spacing
   has no `xxs`; the `xxs` in rule 1 is a *type* rung and a different scale.)
5. **Radius: 3 values.** `sm 8` for controls, `md 12` for surfaces,
   `full 999` for pills. Down from 10 distinct radii. If two radii sit side by
   side and the difference cannot be named, there is only one radius.
6. **No elevation.** `uiElevation` and `UiSurface`'s `elevation` prop were
   deleted on 2026-09-24 with no user: depth is a hairline plus a ground change
   (`ui/design-language.md` §4), and no screen draws a shadow.

### 9b. Appearance: light only

1. The app ships **one light theme**. Dark mode is explicitly not a product
   goal (decided 2026-09-19), and `uiColors` carries no dark variants.
2. `app.config.ts` therefore pins `userInterfaceStyle: "light"`. It must not be
   set back to `"automatic"` while the tokens are single-theme: `"automatic"`
   hands the OS-owned chrome — `Alert.alert` dialogs, the keyboard, native
   pickers — a dark appearance over light app content.
3. `app/_layout.tsx` keeps `<StatusBar style="dark" />` (dark glyphs on the
   light surface), which is consistent with the above.

### 9c. Icons

1. Controls and indicators draw their glyph from `Icon`
   (`apps/mobile/components/ui/icon.tsx`), never from a Unicode character set
   in `Text`. Chevron `›` → `chevron-right`, kebab `⋮` → `more-vertical`,
   external `↗` → `arrow-up-right`, and so on. Characters that belong to the
   data stay text: `×` in `100 kg × 5`, the minus in `−12%`, `·` and `•`
   separators. `app/__tests__/ui-icon.test.tsx` fails on a retired glyph anywhere
   in `app/`, `components/` or `src/` outside comments; no file is exempt.
2. An icon-only control carries an `accessibilityLabel` naming the action; the
   `Icon` inside it stays decorative. An icon never carries state alone: the
   certification marks sit beside words (`Certified by …`, `uncertified`) or
   inside a row whose accessibility label says them.
3. Icon colour is a token (`uiColors` on shipped screens, `uiRoles` on
   design-language surfaces; `ink` when omitted); size is a `uiIconSize` key.
   An icon-only control is an `IconButton` (44pt, labelled).
4. The set-state glyphs (`set-done` / `set-current` / `set-planned`) exist for
   design-language §5; the exercise page (§14a) is their first user.

### 10. Exercise-tag semantics

1. Exercise tags are read-only in the app (tag editing was dropped 2026-09-23): there is no `#`, attach, create, rename, delete or manage UI. The synced tag tables and existing assignments stay.
2. Exercise history offers the tags used on that exercise as filter chips (`All tags` plus one chip per tag with its session count; a deleted tag reads `(deleted)`).

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
12. Daily and weekly heatmap trees stay mounted while an overlay is open. The
    inactive tree is transparent, non-interactive, and hidden from
    accessibility, so switching views reuses the already-laid-out chart and
    preserves its local selection/scroll state instead of drawing it again.

### 13. Stats exercise/muscle history semantics

1. The `Stats / History` screen separates its dimensions into two labelled
   rows: `Time range` contains the existing `Last 7 days` / `Last 30 days`
   pills, while `Breakdown` contains a joined, equal-width `By Exercise` / `By
   Muscle` toggle. Both breakdown choices remain visible, exactly one exposes
   selected state, and `By Exercise` remains the default.
2. The summary keeps the actionable `Sessions` card and shows a second `Sets (W/Sets)` card as `<all valid performed sets> (<working sets>)`. Sessions use a signed absolute delta, and the set card uses a signed absolute pair; neither count card shows percentage change. Percentages are reserved for Volume comparisons.
3. In per-exercise mode, exercises with at least one valid performed set in the
   selected 7-/30-day window render in one compact, viewport-fitting table with
   shared, single-line `Exercise`, `Sets`, `Vol`, and `1RM` headers. Each data
   row shows `<valid performed sets> (<working sets>)`, raw exercise volume, and
   estimated 1RM; unavailable 1RM values render as `—`. Exercise names receive
   the remaining flexible width and wrap to their full value rather than being
   capped at an assumed line count.
   A working set is the valid confirmed RIR subset meeting the configured effort threshold (§5.11);
   warm-up, null, and unknown-quality rows remain in the leading set count but
   not the parenthesized count. Whole data rows remain the only controls that
   open exercise history; repeated per-row metric labels are omitted visually
   but all values and their meanings remain in each row's accessibility label.
4. `Exercise`, `Sets`, and `Vol` are the only exercise-sort controls; `1RM` is
   a static column header. Initial order is `Sets — high to low`. Repeated
   presses cycle `Exercise` through most then
   least recent; `Sets` through sets high-to-low, sets low-to-high,
   working sets high-to-low, then working sets low-to-high; and `Vol` through
   high-to-low then low-to-high. Pressing a different sortable header always
   starts that header's cycle at its first state. Recency comes from the
   latest valid performed set in completed, non-deleted all-time history and is
   independent of the selected 7-/30-day metric window. Missing recency remains
   last in either direction; ties use exercise name then stable exercise ID
   ascending.
5. There is no separate sort-status label above the table. Each sortable header
   reserves a fixed inline indicator slot so its label never moves when another
   header becomes active. Only the active slot is visible in blue on the same
   line: `Recent` plus an arrow for Exercise, or an arrow alone for Sets and Vol.
   Each sortable header exposes button semantics, a mobile-sized touch target,
   selected state when active, the complete current sort wording (including
   Sets versus Working sets), and the next activation's outcome to assistive
   technology; the interaction never relies on color or arrow direction alone.
   Sort choice is volatile but survives time-range, search, and Breakdown
   changes for the mounted screen, while each new metric result is sorted again
   synchronously without data queries or mutation.
6. Tapping an exercise row in per-exercise mode opens an in-route `ExerciseHistoryOverlay` — the same overlay card structure as the muscle-history overlay (occupies ~75% screen height, backdrop-dismissible).
7. The `ExerciseHistoryOverlay` renders the reusable daily/weekly heatmaps over a 365-day window for the selected exercise. It keeps the four metric chips (Volume / W/sets / 1RM / Top weight) plus the week-selection banner; unlike muscle-history, it remains a multi-metric exercise-specific view.
8. The Breakdown toggle uses the shared action, border, and surface tokens and
   is visually distinct from the Time range pills; no raw color literals.
9. Dismissing the exercise overlay returns to the exercise list in per-exercise mode. It clears only transient selected-exercise/week UI state and does not mutate any data.
10. Volume for exercise analytics is raw `weight × reps` (no muscle-role weighting). This differs from the muscle-history overlay where volume is role-weighted.
11. In the per-muscle mode every family and visible nested-muscle row shows `Sets` in the same `<set count> (<near-failure count>)` form plus `Volume`. Family set counts union physical source-set identities across contributing primary/secondary muscles, so one set mapped to two muscles in one family counts once. Family volume still sums member-muscle contributions.
12. Per-muscle previous-period set comparisons use signed absolute pairs (`+4 (+1)`, `−2 (−1)`, `±0 (−1)`) and never percentages. Volume comparisons use percentage only (`+17%`, `−100%`, `±0%`), with `—` for zero-to-zero and `new` for positive volume over a zero baseline. Muscle/family volume remains the shared per-side, role-weighted calculation.
13. Per-muscle family rows use a token-backed green failure-intensity background; visible nested-muscle rows use the semantic warm background palette. Each row receives one uniform shade selected from four levels using `clamp(nearFailureCount / (8 × periodDays / 7), 0, 1)`; there is no partial-width band or gradient. Rows with no near-failure sets keep the default surface. The background is decorative and supplements the readable near-failure count. Its strongest-shade threshold is a display scale only—not a goal, recommendation, limit, or warning. Row accessibility copy states the exact near-failure count and selected-period threshold.

### 14. Group screens: freshness, pull-to-refresh, and the offline marker (M22)

1. Pull-to-refresh (`RefreshControl`, first used in M22) is the explicit refresh on the Groups screen, My groups, the group screen, and the friend's session view. Only a user pull shows the spinner; the on-focus and 30 s poll refreshes run silently (`components/groups/use-pull-to-refresh.ts`).
2. Group data renders cache-first. When the device is offline or the last refresh failed with `NETWORK`, a warning-surface banner reads `Offline · last updated HH:MM` above the still-visible cached data. With nothing cached, the area shows an offline empty state rather than a spinner.
3. A non-network failure shows inline with `Retry` beside data that is still shown, or as a whole-area state with `Retry` when nothing is cached. `NOT_FOUND` is lost access, not an error: the group screen reads `You're no longer a member of this group` and the friend view `This session is no longer available`, and cached data is hidden.
4. Stream session cards are collapsed summaries with no expand; the whole card opens the friend's session view. Membership items are light rows that do not navigate on the Groups screen (it already shows their group); on Today they open the Groups screen on their group. The Groups screen always shows exactly one group: its chips (no `All`) wrap onto more lines rather than scrolling sideways, and managing a group is reached only through `My groups`. (M25-T10) A record card sits directly below its session card (the session card reads `N records`); where its session card is not loaded it stays in stream order. Record-removed and link items are light rows that never navigate. Record state is text: `PR · Weight`, `Group record · e1RM`, `Session in progress`, `Not certified yet`, `Certified by …`, `Voided · set edited|deleted`. A ring icon sits before `Not certified yet` and a check icon before `Certified by …` (`GroupCertificationStatus`); the words carry the state, the icon only echoes it.
5. The friend's session view is read-only (no edit, delete, append or collapse), in the design language on View Session's cards (§7.5), and an active session reads `In progress`. It shows no record band: the friend's history is not on this device.
6. Signed-out or auth-unconfigured builds show a sign-in-required card on every group route, and no group RPC runs.
7. Group writes are online-only (M22-T05; contract §7, C3.10.3). Every write — create, edit, join, regenerate, promote / demote, transfer, remove, leave, and the gate's username save — goes through `useGroupAction`: when NetInfo reports offline it is refused before any request with `You're offline. Connect to the internet and try again.`; a transport failure reads `Couldn't reach the server. Nothing was changed — try again when you're online.` Nothing is queued or retried, and the screen's data is unchanged. The message shows inline beside the action (form: above the submit button; group screen / invite: a notice under the header).
8. Role gating follows contract §4.3 exactly (`groupMemberActionsFor`): members see no Invite, Edit, or member actions; admins can remove members only; the owner can promote, demote, transfer, and remove anyone else, and sees "Transfer ownership before leaving" instead of Leave. Remove, Transfer, Leave, and Regenerate ask for confirmation (`Alert.alert`, destructive style); promote and demote do not. A server `FORBIDDEN` / `NOT_FOUND` on a member write shows inline and refreshes the group.
9. Create and join run the inline username gate first when the username is blank; a server `USERNAME_REQUIRED` re-opens it with a notice and keeps the entered form values.
10. The group screen is for managing the group: the header, then its `Exercises` (no segments). The stream and leaderboards are the Groups screen's `Stream` / `Leaderboards` segment. Members open from the header's member-count line (a press target with a chevron), not a segment.
11. On Exercises every member sees each group exercise's weight entry and their own link status, read from their local links so it shows offline (`Linked: …` / `Not linked`); archived exercises sit at the bottom marked `Archived`. An active exercise none of theirs is linked to offers `Link your exercise`: the pick sheet with a `Link` confirm, which adds nothing to a session and works offline (a local write). Only the owner and admins see `Add exercise` and the row sheet (`Rename`, `Archive`, or `Unarchive` on an archived row). Archive confirms first (`Alert.alert`, destructive style); rename and unarchive do not. Exercise writes follow rule 7. A server `FORBIDDEN` / `NOT_FOUND` / `VALIDATION` shows inline; the Exercises page and the edit screen then refresh the group and the list, and the add screen refreshes the group (the list refreshes when the group screen regains focus).
   - Linked rows also offer `Unlink…` to every member, independently of admin row actions. One personal mapping confirms directly; multiple mappings open `Your linked exercises` with individually labelled actions and distinguishable IDs for duplicate/missing names. Never unlink all mappings implicitly. Dismiss the chooser before confirmation; restore focus to the launching row, wrap long names, and use 44 pt minimum unlink targets.
   - Group-row and Link-screen confirmations share `describeUnlinkConfirm`: identify the personal exercise, group exercise and group; explain All/Certified eligibility after sync and preservation of past activity and existing certifications. Archived/inactive targets explain unarchive/rejoin conditions, including both when known. Existing record-card certification eligibility is unchanged; unlink never requires or creates a new certification.
   - Unlink uses the guarded local repository write, including offline, with a reconnect/sync notice. Cancellation writes nothing; a stale target refreshes without mutation; failed writes keep the link and permit retry; pending writes disable repeat taps. Loading/failed local reads offer no link actions or false `Not linked`; failed reads have a retry independent of server refresh. A successful write followed by a failed read retains success alongside the unknown-status read error.
12. Leaderboards (M25-T09). The segment shows one podium card per group exercise on `Certified · e1RM`, cached like the other group screens (rule 2); the whole card opens the full board. State is text, never color alone: my rows read `You`, a former member `(former)`, archived exercises `Archived`, and on All each row a check icon (certified) or a ring icon with `uncertified`; the row's accessibility label says `certified` / `uncertified`. An empty Certified podium reads `No certified sets yet · N uncertified`; an empty Certified board offers `See all sets`.
13. Full boards and their history are online-only reads: never cached, no 30 s poll (they refresh on open, a toggle change, focus, and pull), paged on end-of-list with a `Retry` footer after a failed page. With nothing loaded offline they show the offline empty state; rows already loaded stay with the offline marker. A missing group exercise reads "This exercise isn't in this group" and is not lost access.
14. Certification (M25-T10). A record card and a full-board row open the same row detail sheet (08 pattern 11). `Certify` shows for any member but the lifter on a standing, uncertified record set of an active exercise whose lifter is still a member; `Remove my certification` for the certifier; `Cancel certification` for the owner or an admin who is not the certifier. Certify does not confirm; Remove and Cancel confirm first (`Alert.alert`, destructive style). The writes follow rule 7 (offline refused before any request, nothing queued); their outcome shows inline in the sheet or on the card. `CONFLICT`, a set that is no longer a record, a certification or lifter that is gone, `FORBIDDEN`, and `VALIDATION` say nothing changed and re-read the board or stream; a group `NOT_FOUND` evicts and shows lost access. After a certify the sheet reads `Certified. Certified boards update in a few seconds.`

### 14a. Exercise page

The page lives at
`/session/[sessionId]/exercise/[sessionExerciseId]` and edits one exercise of
the active session (or of a completed session being edited, §14b.7) through the session repository and autosave
(`src/session-recorder/`), so the rules of §5.11 about what a set *is* hold
unchanged. What differs is presentation:

1. **One ordered list, no mode.** Performed, current and planned rows share one
   list; a row carries its planned triple and its actuals, and
   `performanceStatus` decides which is real. The row shows its actuals once
   performed or once the lifter has typed, and its plan otherwise. Planned vs
   ad hoc is not a mode either: following a plan and logging ad hoc mix freely
   in one session, and `Append plan` adds planned rows in both cases.
2. **State is the glyph** (`set-done` / `set-current` / `set-planned`), a
   checkbox in the row's 44pt control column. Tapping it performs a row with
   valid values (typed, else planned) or un-performs a performed row — back to
   `planned` when it came from a plan, else `unperformed`. A row with nothing
   valid to perform opens in the logger instead.
3. **The logger is the open row.** It sits on the first set not performed, or on
   the row whose body was tapped; one at a time. Typing is saved as it is typed
   (the autosave text debounce); the tick — the screen's one `accent` primary,
   disabled until the values are a valid set — performs it and moves the logger
   on. Tapping effort cycles W-Up → blank → RIR 3 → RIR 2 → RIR 1 → RIR 0 → W-Up; long press opens the configured options in a scrolling sheet. The highest selectable RIR comes from `EFFORT_LOGGING_POLICY.maxSelectableRir` (`src/config/training.ts`, default `3`). Untouched planned rows show prescribed effort; choosing blank explicitly clears actual effort. New ad-hoc rows follow §5.11 defaults.
4. **Numbers everywhere.** Every row, planned included, shows its 1RM and
   volume; planned values `ink-faint`, legends `planned`. Warm-ups show a 1RM
   like any set. Every figure in a row shares the row's colour and weight —
   there is no per-column bold for today's bests, matching the session view
   (§14b.4; aligned 2026-09-23). The one highlight is a performed weight or 1RM
   beating the all-time best before today, shown in `record` (brass); volume is
   never one, since its record is a whole session's. The records panel uses
   History's rules (warm-ups count). `Records` | `Last` chooses what the
   panel shows and never expands or collapses it; only the chevron does.
   Collapsed, its `1RM` / `Max` / `Vol` row sums up the chosen view: the
   all-time records, or the previous session's best 1RM, heaviest weight and
   volume.
5. **Two exits.** Back leaves every set as it is. `Complete exercise` asks first
   when sets are waiting: planned sets still waiting are marked `unperformed`
   (never deleted — their plan stays), and ad-hoc sets never ticked are removed;
   the alert names both counts. `Remove from session` (⋮, danger) confirms, then
   removes the exercise; `Swap exercise` keeps the sets and replaces the
   exercise definition. Signed in, the ⋮ also offers `Link to group
   exercise…`, which opens the Link screen for the exercise (product E0.3) and
   leaves the session untouched; signed out it is absent.
6. **Sheets** are the design-language `Sheet`: backdrop, Android back and the
   VoiceOver escape dismiss; no Cancel.

### 14b. Session view

1. The session view is read-only and navigational: the whole exercise card is
   one link to the exercise page, with no controls inside it. Editing happens
   only on the exercise page; add lives on the session view (`+ Add
   exercise`), remove in the exercise's own ⋮. The one control in the summary
   card is the Gym stat: tapping it opens a `Gym` sheet (a `Nearby · <gym>`
   suggestion when one gym confidently matches, then `No gym` and the gyms, the
   current one marked; §14–§15) and choosing writes the session's gym. Adding
   and managing gyms is the Gyms screen's, through the sheet's `Manage gyms`
   (§16).
2. `Finish` (top bar, `accent`) is the screen's one primary. It asks the
   cleanup questions of §5.11 (the one rule set in `session-model.ts`) as
   native alerts: entered-but-unconfirmed sets first, on their own; then
   **one** prompt that removes the incomplete sets and the exercises left with
   no sets together (`Remove incomplete sets and empty exercises?` · `Remove
   and submit`; single-kind copy when only one applies). Declining any writes
   nothing. Invalid set values block it with an alert naming the exercises to
   fix.
3. ⋮ is a menu sheet even with one item. `Abandon session` is `danger` and
   confirms (`Abandon session?` · `Keep session` / `Abandon`) before the same
   soft delete as the Sessions list's delete; the sheet's backdrop, Android
   back and the VoiceOver escape dismiss it.
4. A card row shows every set: done rows in `ink`, everything else faded
   (values `inkFaint`, legends `planned`), a planned row showing its
   prescription. Every figure in a row shares the row's colour and weight —
   there is no per-column bold for today's bests (tried on device 2026-09-23:
   too noisy). The one highlight is a done set whose 1RM beats the exercise's
   completed history: that 1RM is shown in `record` and earns the card a
   `record` band (`New 1RM record · <1RM>`), from the same derivation
   (`deriveExercisePersonalRecord`) as the completion screen's `New PR` cards
   (§7.7).
5. The summary counts only confirmed performed sets (warm-ups included) and
   their entered-load volume; Time is elapsed since the session's start.
6. The persistent four-tab bar stays at the bottom with Train selected; it is
   the way back out, and returns to the tab rather than stacking it.
7. **A completed session is edited here**. The top bar reads
   `Edit session` · `Done`, with no ⋮ (there is nothing to abandon), and
   Progress is selected in the tab bar. The summary card's Time becomes two
   fields, `Start` and `End` (`YYYY-MM-DD HH:mm`, End not before Start); a
   field's error shows once it is left. Edits autosave losslessly — sets on
   the exercise page (the same rules as §14a, written back as completed), the
   gym, added exercises and valid times — and while either time is invalid
   autosave pauses with `Autosave paused until Start/End times are valid.`
   A field still showing its stored minute keeps its stored instant. `Done`
   reveals invalid times and writes nothing; otherwise it asks §14b.2's
   questions with completed-edit labels (`… and save changes`), saves the
   confirmed rows only, and goes back where the edit was opened. It never
   replays completion. Records compare against the rest of history, not the
   session itself.

### 15. Documentation maintenance rule (UI semantics)

1. If a task changes current UI semantics (action roles, state treatment, modal conventions, list interactions, validation behavior), update this file in the same task/session.
2. If the change is route-path/param/transition related, update `navigation-contract.md` in the same task.
3. If the change is component/primitives API related, update `components-catalog.md` in the same task.

## Pending / planned (not current behavior)

1. Additional primitive extraction (for example state panels, modal surfaces, row cards, form fields) remains pending to reduce route-local style duplication beyond the token convergence completed in Task `T-20260226-06`.
2. Additional primitives from the audit (for example `ScreenContainer`, `EmptyState`, `ModalSurface`) are candidates, not current required APIs.
3. Temporary raw-color guardrail allowlist entries remain available only for future exceptional migrations; current route-screen exceptions were cleared in Task `T-20260226-06`.
