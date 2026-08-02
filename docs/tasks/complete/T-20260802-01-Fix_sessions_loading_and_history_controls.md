---
task_id: T-20260802-01-Fix_sessions_loading_and_history_controls
milestone_id: "MVP"
status: completed
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo|maestro|docs"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend && ./boga test frontend"
docs_touched: "docs/specs/ui/ux-rules.md, docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md, docs/specs/ui/components-catalog.md"
---

# Fix Sessions Loading and Regroup Stats / History Controls

## Task metadata

- Task ID: `T-20260802-01-Fix_sessions_loading_and_history_controls`
- Title: Fix duplicate Sessions loading and regroup Stats / History controls
- Status: `completed`
- File location rule:
  - active card lives at
    `docs/tasks/T-20260802-01-Fix_sessions_loading_and_history_controls.md`
  - move it to `docs/tasks/complete/` when completed or outdated
- Session date: 2026-08-02
- Session interaction mode: `interactive`
- Branch/PR contract:
  - implement and close this card on the existing
    `codex/history-set-failure-implementation` branch
  - do not create another implementation branch or PR
  - preserve the already-landed History set/failure work on this branch
  - validate the cumulative branch diff, not only the files changed for this
    card

## Parent references (required)

- Project directives: `AGENTS.md`, `docs/specs/README.md`
- Milestone spec: N/A - user-requested Sessions and Stats / History refinement
  on the existing MVP implementation branch.
- Related completed work:
  - `docs/tasks/complete/T-20260726-01-History_set_and_failure_counts.md`
  - `docs/tasks/complete/T-20260726-02-History_muscle_failure_bars.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Quality gates: `docs/specs/02-quality-and-test-gates.md`
- Project structure: `docs/specs/09-project-structure.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`

## Context Freshness (required at session start; update before edits)

- Implementation-session refresh on 2026-08-02:
  - verified `codex/history-set-failure-implementation` at task-card HEAD
    `a6956e8f5b47797f8a78eb757730838c05ac5686` with a clean worktree;
  - re-ran `./scripts/task-bootstrap.sh` successfully with all parent paths
    present;
  - re-ran `./boga test for --diff origin/main...HEAD`; the cumulative branch
    requires `fast`, `backend`, `frontend`, `docs-check`, and `meta-tests`;
  - re-opened `AGENTS.md`, the always-load specs, the testing/UX/Maestro specs,
    the UI docs bundle, and `apps/mobile/app/__tests__/README.md` before edits.
- Verified implementation branch + pre-task-card HEAD commit:
  `codex/history-set-failure-implementation` at
  `d4cfefed14bc06a755228fecd24622244b34e022`.
- Start-of-session sync with `origin/main` completed?: `N/A`; this card must be
  implemented on the current cumulative branch. `origin/main` was verified at
  `c643eae71275c58bb9ab68836cc09c3d202ffba0`; do not rebase or recreate the
  branch as part of this task without explicit user direction.
- Parent refs opened while authoring this card:
  - `AGENTS.md`
  - `docs/specs/02-quality-and-test-gates.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/templates/task-card-template.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/navigation-contract.md`
  - `docs/specs/ui/components-catalog.md`
  - `docs/tasks/README.md`
- Code/docs inventory freshness checks run on 2026-08-02:
  - `apps/mobile/app/sessions.tsx`: `SessionsRoute` initializes a
    `reloadToken` at `0`, then increments it in `useFocusEffect`.
  - `apps/mobile/components/session-list/history-data.ts`:
    `useSessionListData` loads on mount and reloads whenever `reloadToken`
    changes. Initial mount plus initial focus therefore issue two closely
    spaced loads and explain the visible double regeneration.
  - `apps/mobile/app/_layout.tsx`: the root stack registers the hidden Expo
    Router group `(tabs)` and gives `/sessions` only a title. The default iOS
    back-label behavior can expose the internal route-group name as `(tabs)`.
  - `apps/mobile/app/(tabs)/stats-history.tsx`: time-period pills and one
    destination-style view-mode button currently share a wrapping row. The
    view-mode button displays only the mode the user would switch to.
  - `apps/mobile/components/ui/segmented-chips.tsx`: the shared primitive has a
    pill-chip presentation but no joined, equal-width two-option variant.
  - `apps/mobile/app/__tests__/sessions-screen.test.tsx`,
    `apps/mobile/app/__tests__/stats-screen.test.tsx`, and
    `apps/mobile/app/__tests__/root-layout-auth-bootstrap.test.tsx` inspected
    for the focused regression-test seams.
  - `apps/mobile/.maestro/flows/stats-view-toggle-ux.yaml` and
    `apps/mobile/.maestro/flows/data-runtime-smoke.yaml` inspected for affected
    selectors and simulator evidence.
- Known stale references or assumptions:
  - The existing `stats-view-mode-chip` Maestro selector assumes a single
    destination-action button. It must not remain the only selector after both
    choices become visible.
  - The current branch has a cumulative frontend/backend/docs diff. The
    implementing agent must run `./boga test for` again immediately before
    closeout and follow its complete result.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260802-01-Fix_sessions_loading_and_history_controls.md`

## Objective

Make the Sessions history list load once, rather than visibly regenerate twice,
when the user opens it. Replace the leaked `(tabs)` back label with a minimal
back arrow. Reorganize Stats / History controls into two clearly labelled
concept rows: time range and breakdown, with both breakdown choices always
visible in a distinct two-option toggle.

## Scope

### In scope

- Establish one automatic Sessions history query per navigation-focus
  acquisition, including the first focus.
- Preserve one fresh query when the already-mounted Sessions route genuinely
  regains focus.
- Preserve explicit reloads after session mutations and filter changes without
  allowing stale requests to overwrite newer results.
- Configure `/sessions` to show only the platform back arrow, not the internal
  `(tabs)` route-group label.
- Split Stats / History controls into a labelled time-range row and a labelled
  breakdown row.
- Show explicit `By Exercise` and `By Muscle` choices simultaneously and make
  the current choice visually and accessibly selected.
- Add or extend a shared, token-backed control variant if needed for the joined
  breakdown toggle, without changing existing chip callers by default.
- Update focused tests, affected Maestro flows, canonical UI docs, and local
  evidence.

### Out of scope

- Changing the Sessions repository query, ordering, pagination, deleted-item
  semantics, or stored data.
- Adding caching that can hide session changes made while the route is away.
- Changing the available `Last 7 days` and `Last 30 days` periods.
- Changing Stats calculations, set/failure/volume metrics, heatmaps, row
  colors, comparison logic, or the default `By Exercise` mode.
- Changing bottom-tab destinations or exposing `(tabs)` as user-facing copy.
- Refactoring unrelated focus-driven screens or navigation stacks.
- Schema, migration, Supabase, RLS, sync-envelope, or backend behavior changes.

## UI Impact (required checkpoint)

- UI Impact?: `yes`
- Sessions gets a minimal platform back affordance and loses internal router
  terminology.
- Stats / History control hierarchy and visual selection behavior change, but
  the route, data, metric, and default-state contracts remain intact.
- Preserve current dynamic-type behavior, touch-target size, theme tokens, and
  screen spacing primitives.

## UX Contract

### Key user flows

1. Flow name: Open Sessions history
   - Trigger: user presses the Sessions summary box/button.
   - Steps: the app navigates to `/sessions`; the route acquires focus and
     requests session history once.
   - Success outcome: the list enters its loading/result state once, without a
     second visible regeneration caused by a duplicate initial query.
   - Failure/edge outcome: an error remains retryable through the existing
     behavior; a stale or cancelled earlier request cannot replace newer data.
2. Flow name: Return to an existing Sessions route
   - Trigger: user leaves `/sessions` for a session detail or another route and
     later returns while the screen instance is mounted.
   - Steps: the route regains focus and requests fresh history once.
   - Success outcome: external changes are reflected without two queries for
     the same focus acquisition.
   - Failure/edge outcome: focus churn or an in-flight request does not produce
     stale-state replacement or an unmounted-state update.
3. Flow name: Navigate back from Sessions
   - Trigger: user views the Sessions navigation header.
   - Steps: user presses the back affordance.
   - Success outcome: only the platform arrow is shown beside the centered
     `Sessions` title, and it returns to the previous screen.
   - Failure/edge outcome: neither `(tabs)` nor another internal route name is
     shown to the user.
4. Flow name: Change Stats / History dimensions
   - Trigger: user opens Stats / History.
   - Steps: user selects `Last 7 days` or `Last 30 days` in the `Time range`
     row, then independently selects `By Exercise` or `By Muscle` in the
     `Breakdown` row.
   - Success outcome: both dimensions are understandable at a glance; both
     breakdown options remain visible; selection updates exactly once and the
     existing Stats results follow the selected combination.
   - Failure/edge outcome: loading, error, empty, search, and overlay states
     continue to preserve the selected controls and their semantics.

### Interaction + appearance notes

- Use visible row labels `Time range` and `Breakdown`; do not rely on color or
  control shape alone to distinguish the two concepts.
- Keep `Last 7 days` and `Last 30 days` as the existing pill-style choices.
- Present `By Exercise` and `By Muscle` as an explicit joined/equal-width
  two-option toggle, visually distinct from the period pills.
- Use stable target IDs `stats-view-mode-chip-exercise` and
  `stats-view-mode-chip-muscle`; expose the selected option with
  `accessibilityState.selected`.
- Avoid animation as a workaround for duplicate loading. Any transition
  polish must remain token-backed, native-friendly, and subordinate to the
  query and hierarchy fixes.

## Loading and navigation contract

- Exactly one automatic `loadSessions` call is allowed for each transition
  from not-focused to focused, including initial presentation.
- Do not combine an unconditional mount load with an immediate focus-token
  reload. Prefer a single focus-aware source of truth, such as passing
  `useIsFocused()` into the data hook as an enablement condition, if it fits
  the final testable design.
- Changing the deleted-session visibility filter produces one new load for the
  new filter value.
- Existing delete, undelete, append, retry, and pull-to-refresh paths may issue
  their intentional explicit refresh, but must not also cause a second
  focus-derived request for the same event.
- Preserve request-generation or cancellation protection so late results from
  an earlier request cannot overwrite the current state.
- Use the native-stack minimal back-button display mode (or the nearest
  platform-equivalent stack option) on `/sessions`; do not rename the `(tabs)`
  route group merely to hide its label.

## Acceptance criteria

1. Opening Sessions from its summary box/button calls the session-history load
   path exactly once for the initial focus.
2. The Sessions list no longer visibly clears/repopulates or regenerates twice
   due to an initial mount-plus-focus query pair.
3. Blurring and refocusing the already-mounted Sessions route causes exactly
   one fresh automatic load.
4. Deleted-session filter changes and mutation-driven refreshes retain their
   existing behavior without accidental duplicate loads.
5. Late, cancelled, or superseded session requests cannot replace newer
   results or update an unmounted consumer.
6. The Sessions header shows a back arrow and the title `Sessions`, with no
   `(tabs)` or other internal route-group label.
7. Back navigation from Sessions retains the current destination and platform
   behavior.
8. Stats / History renders a visible `Time range` row containing `Last 7 days`
   and `Last 30 days`.
9. Stats / History renders a separate visible `Breakdown` row containing both
   `By Exercise` and `By Muscle` at all times.
10. The breakdown toggle uses a control treatment visibly distinct from the
    period pills and exposes exactly one selected option accessibly.
11. `By Exercise` remains the default; selecting either explicit breakdown
    option updates the results and the selected state exactly once.
12. Existing search-reset, loading, error, empty, heatmap, row interaction, and
    comparison behavior remains green under focused coverage.
13. Existing `SegmentedChips` callers retain their current presentation unless
    they explicitly opt into a new variant.
14. No raw color literals or one-off button primitives are introduced in route
    files; existing tokens, typography, spacing, and shared controls are used.
15. Maestro flows use the explicit breakdown-option selectors and capture the
    reorganized controls plus the arrow-only Sessions header.
16. Canonical UI docs describe the two control groups, explicit breakdown
    selection, and minimal Sessions back affordance.

## Docs touched (required)

- Planned docs/spec files to update:
  - `docs/specs/ui/ux-rules.md` - replace the single adjacent destination-chip
    contract with separate `Time range` and `Breakdown` rows and an explicit
    two-option breakdown toggle.
  - `docs/specs/ui/screen-map.md` - update the `/stats-history` control
    hierarchy and `/sessions` header summary.
  - `docs/specs/ui/navigation-contract.md` - document the minimal arrow-only
    back affordance for `/sessions`; keep route and destination contracts
    unchanged.
  - `docs/specs/ui/components-catalog.md` - document the opt-in joined/equal
    `SegmentedChips` variant if the implementation extends that primitive.
- UI docs update required?: `yes`; this changes screen interaction semantics,
  navigation presentation, and potentially a shared component variant.
- `docs/specs/03-technical-architecture.md`: no update expected; no runtime,
  dependency, or architectural decision changes.
- `docs/specs/05-data-model.md`: no update; no persisted or derived-data
  contract changes.
- `docs/specs/06-testing-strategy.md`: no update expected; regression coverage
  stays within existing Jest and Maestro layers.
- Tokens/primitives compliance statement:
  - Reuse plan: existing typography, spacing, colors, Pressable behavior,
    `SegmentedChips`, screen headers, and native-stack navigation options.
  - Exceptions: none planned. If a new shared variant is unjustified after
    implementation inspection, a route-local layout wrapper may compose
    shared tokens, but must not duplicate button styling or use raw literals.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md` or task scope?: `yes`.
  - Planned captures: Stats / History with both labelled rows in each breakdown
    state, and Sessions with the arrow-only header and a stable loaded list.

## Testing and verification approach

- Planned focused Jest command, from `apps/mobile/`:
  - `npm test -- --runInBand app/__tests__/sessions-screen.test.tsx app/__tests__/stats-screen.test.tsx app/__tests__/root-layout-auth-bootstrap.test.tsx`
- Required focused coverage:
  - `apps/mobile/app/__tests__/sessions-screen.test.tsx`
    - exactly one load on initial focus
    - no mount-plus-focus duplicate
    - exactly one load after blur/refocus
    - filter, explicit refresh, and stale-request behavior
  - `apps/mobile/app/__tests__/root-layout-auth-bootstrap.test.tsx`
    - capture stack options and assert minimal back-button display for
      `/sessions`
  - `apps/mobile/app/__tests__/stats-screen.test.tsx`
    - separate labels/groups, both visible breakdown choices, default and
      selected accessibility states, explicit callbacks, and preserved search
      reset/overlay behavior
- Additional targeted checks, from `apps/mobile/`:
  - `npm run typecheck`
  - `npm run lint:ui-guardrails`
- Maestro coverage:
  - update `apps/mobile/.maestro/flows/stats-view-toggle-ux.yaml` to select each
    explicit breakdown option and capture the two control rows
  - update or extend `apps/mobile/.maestro/flows/data-runtime-smoke.yaml` to
    cover the Sessions header and stable initial list presentation
  - run `./boga test meta-tests` after flow changes
- Test layers covered: hook/screen unit and integration behavior, navigation
  option contract, accessibility selection, local iOS interaction, and visual
  evidence.
- Slow-gate triggers:
  - route/component/navigation/flow changes require `./boga test frontend`
  - the cumulative branch includes backend-triggering History data changes, so
    `./boga test backend` remains required before branch closeout
- Hosted/deployed smoke ownership: N/A; no hosted or deployment behavior.
- CI/manual posture note: local gates and simulator evidence are mandatory and
  are not replaced by CI.
- Before claiming any lane is unavailable, run `./boga doctor` and repair the
  local bootstrap gap. Do not state a duration without `./boga timings`
  evidence.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/app/sessions.tsx`
  - `apps/mobile/components/session-list/history-data.ts`
  - `apps/mobile/app/_layout.tsx`
  - `apps/mobile/app/(tabs)/stats-history.tsx`
  - `apps/mobile/components/ui/segmented-chips.tsx`
  - `apps/mobile/app/__tests__/sessions-screen.test.tsx`
  - `apps/mobile/app/__tests__/stats-screen.test.tsx`
  - `apps/mobile/app/__tests__/root-layout-auth-bootstrap.test.tsx`
  - `apps/mobile/.maestro/flows/stats-view-toggle-ux.yaml`
  - `apps/mobile/.maestro/flows/data-runtime-smoke.yaml`
  - UI docs listed above
- Recommended loading design:
  - make route focus the single automatic-load trigger
  - remove the initial `reloadToken` increment mechanism if a focus-enabled
    hook cleanly expresses the contract
  - keep explicit mutation/filter refreshes explicit and independently tested
- Recommended control design:
  - retain the current pill variant as the shared primitive's default
  - add an opt-in joined, equal-width variant for Breakdown, or an equivalent
    shared composition that exposes both options and selected state
  - replace `stats-view-mode-chip` references with the two explicit IDs
- Project structure impact: none; no new directories or ownership conventions.
- Native dependency/config impact: none planned. Stop and revise the task card
  before adding a package or config plugin.
- Data/sync impact: none. Do not change repository SQL, entities, migrations,
  sync scope, or backend APIs to solve a UI query-lifecycle problem.

## Mandatory verify gates

- Run the focused Jest, typecheck, UI guardrail, and Maestro checks above.
- Run `./boga test for` against the final cumulative branch diff and follow its
  complete lane result.
- Expected cumulative branch gates based on the current diff:
  - `./boga test fast`
  - `./boga test backend`
  - `./boga test frontend`
  - `./boga test docs-check`
  - `./boga test meta-tests`
- Run `./scripts/task-closeout-check.sh docs/tasks/T-20260802-01-Fix_sessions_loading_and_history_controls.md`
  before handoff, using the completed-card path if the closeout helper is run
  after moving the card.

## Evidence

- Focused test output proving one load on first focus and one on refocus.
- Root-stack test output proving the `/sessions` minimal back-button option.
- Stats screen test output proving independent grouped controls and explicit
  selected states.
- Maestro captures for both Stats breakdown selections and the Sessions header.
- Final `./boga test for` output plus evidence for every required local lane.
- UI/UX visual artifacts: required as described under `Docs touched`.
- Manual verification summary: record device/simulator, route entry path,
  observed initial-load behavior, back-header copy, and both control groups.
- Deferred/manual hosted checks: N/A.

### Recorded implementation evidence (2026-08-02)

- Focused Jest:
  - `cd apps/mobile && npm test -- --runInBand app/__tests__/sessions-screen.test.tsx app/__tests__/stats-screen.test.tsx app/__tests__/root-layout-auth-bootstrap.test.tsx`
  - PASS: 3 suites, 79 tests. Coverage asserts one initial focus load, one
    blur/refocus load, one filter/mutation refresh, request supersession and
    unmount invalidation, the native Sessions stack options, both labelled
    Stats control groups, explicit selected states, and preserved search reset.
- Focused static checks:
  - `cd apps/mobile && npm run typecheck` — PASS.
  - `cd apps/mobile && npm run lint:ui-guardrails` — PASS, 31 files checked and
    0 violations.
- Focused iOS simulator evidence on `BOGA wt1`
  (`8EE7AAC8-0DD9-4EFA-852A-737A7C5746F8`):
  - Stats flow PASS (1/1) at
    `apps/mobile/artifacts/maestro/T-20260802-01/20260802-095945-16211`.
    The exercise and muscle captures are
    `maestro-output/screenshots/01-exercise-view-default.png` and
    `maestro-output/screenshots/03-muscle-failure-backgrounds-30-days.png`.
  - Sessions data-smoke PASS (1/1) at
    `apps/mobile/artifacts/maestro/T-20260802-01/20260802-101018-29574`.
    `maestro-output/screenshots/04-data-runtime-smoke-success.png` shows the
    stable loaded list, centered `Sessions` title, and arrow-only back control;
    its successful hierarchy assertion proves `(tabs)` is absent after the
    generic `Back` accessibility title is applied.
- Manual verification summary (required when CI is absent/partial): `BOGA wt1`
  passed the Sessions no-regeneration/header-return check and both labelled
  Stats control-group states.
  - entered Sessions from the Stats `Sessions` card, observed one loading-to-
    loaded presentation with no second list regeneration, and verified the
    arrow-only header returned to Stats normally;
  - verified separate visible `Time range` and `Breakdown` rows in both `By
    Exercise` and `By Muscle` states, with both breakdown choices always
    visible and the selected treatment switching once per explicit press.
- Final cumulative lane selection:
  - `./boga test for` — PASS; 24 changed paths require exactly `fast`,
    `backend`, `frontend`, `docs-check`, and `meta-tests`.
- Required local gates:
  - `./boga test fast` — PASS; all sub-lanes green, including 109 Jest suites
    and 1001 tests.
  - `./boga test backend` — PASS; local Supabase auth/agent/sync contracts and
    MCP smoke green.
  - `./boga test frontend` — PASS; `ios-smoke`, `ios-data-smoke`,
    `ios-auth-profile`, and `ios-sync-e2e` all green.
  - `./boga test docs-check` — PASS.
  - `./boga test meta-tests` — PASS, 4 files.
- Environment recovery evidence:
  - after a frontend attempt exhausted local disk while Maestro wrote a debug
    log, `./boga doctor` passed every capability and worktree check; only
    regenerable test/package caches were pruned, and the complete frontend gate
    then passed from the first lane through sync e2e.
- Closeout helper:
  - `./scripts/task-closeout-check.sh docs/tasks/complete/T-20260802-01-Fix_sessions_loading_and_history_controls.md`
    — PASS with the single expected warning that this user-requested MVP card
    has no milestone spec (`Milestone spec: N/A` above).
- Hosted/deployed verification: N/A; no hosted or deployment surface changed.

## Execution plan

1. Bootstrap the card, re-open required parent refs, verify the current branch
   and HEAD, and run `./boga test for` before editing.
2. Add failing focus-lifecycle coverage that reproduces the double initial
   session load, then make one focus transition the sole automatic trigger.
3. Add the failing root-stack assertion, configure the `/sessions` back button
   to minimal display, and verify no `(tabs)` copy remains.
4. Add failing Stats control tests, then implement the labelled two-row layout
   and explicit joined Breakdown toggle while preserving existing period pills.
5. Update Maestro selectors/flows and canonical UI docs with the final contract.
6. Run focused checks, inspect simulator captures, run every lane required by
   the final cumulative diff, fill the evidence/completion note, move the card
   to `docs/tasks/complete/`, and commit the implementation on the same branch.

## Risks and rollback

- Risk: replacing `reloadToken` removes legitimate refresh-on-return behavior.
  Mitigation: test initial focus, blur/refocus, filter changes, and explicit
  mutation refreshes separately before deleting the old mechanism.
- Risk: focus changes during an in-flight load allow stale data to win.
  Mitigation: preserve generation/cancellation guards and cover supersession.
- Risk: extending `SegmentedChips` changes every existing caller. Mitigation:
  keep the new joined presentation opt-in and assert current default output.
- Risk: a header fix hides the arrow as well as the label. Mitigation: assert
  stack options and capture the real native header in Maestro.
- Rollback boundary: the task is isolated to focus orchestration, navigation
  presentation, Stats control layout, tests, flows, and UI docs. It requires no
  data migration or destructive rollback.

## Completion note

- What changed: completed the focus-safe Sessions loading/header refinement and
  the labelled, explicit Stats dimension controls.
  - made route focus the sole automatic Sessions history-load trigger, retained
    explicit filter/mutation refreshes, and generation-guarded late requests;
  - configured the Sessions native header as an arrow-only visual affordance
    with a generic accessible back title, removing the internal route-group
    label;
  - split Stats dimensions into labelled `Time range` pills and a token-backed,
    joined equal-width `Breakdown` control with both explicit choices;
  - updated focused tests, Maestro flows, and all four canonical UI docs.
- What tests ran: all focused checks, direct simulator flows, and every lane
  selected by the final cumulative `./boga test for` result passed; exact
  commands, counts, and artifact paths are recorded above.
- What remains: nothing for this card. No schema, backend contract, hosted
  smoke, dependency, branch, or PR follow-up is required.

## Status update checklist (mandatory at closeout)

- Update `Status` and frontmatter `status` to `completed`, `blocked`, or
  `outdated`.
- If completed or outdated, move this file to `docs/tasks/complete/` in the
  same commit and update affected references.
- Fill the completion note and evidence with commands/results, not estimates.
- Update the listed canonical UI docs and keep them synthetic/source-linked.
- Re-run `./boga test for` and every required lane on the cumulative branch.
- Run the task closeout helper and record its result before handoff.
