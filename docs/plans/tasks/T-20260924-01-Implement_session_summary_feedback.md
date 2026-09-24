---
task_id: T-20260924-01-Implement_session_summary_feedback
milestone_id: "release-v1.1.0-b13"
status: planned
ui_impact: "yes"
areas: "docs|frontend"
runtimes: "docs|node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/navigation-contract.md, docs/specs/ui/screen-map.md, docs/specs/ui/ux-rules.md, docs/specs/ui/components-catalog.md if a reusable component is introduced"
---

# Implement the user-feedback session summary changes

## Task metadata

- Task ID: `T-20260924-01-Implement_session_summary_feedback`
- Status: `planned`
- Session date: `2026-09-24`
- Session interaction mode: `interactive (default)`
- Target: a later `1.1.0` production build (`14+`)

## Parent references

- Feedback source:
  `docs/plans/tasks/T-20260918-01-Collect_v1_1_0_b13_user_feedback.md`
  (`FB-001` / `ACT-001` and `FB-002` / `ACT-002`)
- Project directives: `docs/specs/README.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Quality gates: `docs/specs/02-quality-and-test-gates.md`
- Project structure: `docs/specs/09-project-structure.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle: `docs/specs/ui/README.md`
- Design policy: `docs/specs/ui/ai-design-policy.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit: `work` at
  `3497aa4acf36cb6bb7308adb865960c6197e9af2`.
- Start-of-session sync with `origin/main` completed?: `N/A` — this harness
  checkout has no `origin/main` ref; `./boga worktree start` accepted the
  checkout and leased slot `0`.
- Parent refs opened in this session:
  - `AGENTS.md`
  - `docs/plans/README.md`
  - `docs/plans/tasks/T-20260918-01-Collect_v1_1_0_b13_user_feedback.md`
  - `docs/plans/templates/task-card-template.md`
  - `docs/specs/02-quality-and-test-gates.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/ai-design-policy.md`
- Code/docs inventory freshness checks run:
  - inspected the current session routes, session-summary components,
    session-insight calculations, related tests, and the UI-doc references on
    `2026-09-24`
  - confirmed the current completed-session route accepts `detail` and
    `completion`, while History and its explicit Edit action enter the session
    view's completed-edit mode
  - confirmed the completion presentation owns the existing exercise
    comparison and share affordances, and the active session view currently
    owns a separate compact summary card
- Known stale references or assumptions: device reproduction of `FB-001` and
  `FB-002` remains pending; both findings are source-confirmed against build 13
  and current source. Re-check the implementation inventory at task start.
- At implementation start, run:
  `./scripts/task-bootstrap.sh docs/plans/tasks/T-20260924-01-Implement_session_summary_feedback.md`.

## Objective

Implement the two accepted, related build 13 feedback actions as one coherent
session-summary change:

1. make a completed History row open a read-oriented Summary before individual
   sets or editing; and
2. give live, just-completed, and historical sessions one shared insight
   presentation with equivalent `By exercise` and `By muscle` historical
   comparisons.

The implementation must keep mutation explicit, keep workout logging
responsive, and keep exported shares fixed to the exercise presentation.

## Scope

### In scope

- Route a completed row in Sessions History to an explicit historical-summary
  presentation while preserving the row overflow menu's direct Edit action.
- Add deterministic `View individual sets` and `Edit session` actions to the
  historical Summary; neither action may depend on stack history.
- Extract or introduce one shared insight presentation for:
  - live `Session so far` in `/session/[sessionId]`;
  - the mandatory post-completion Summary; and
  - the Summary opened from Sessions History.
- Default every newly opened summary to `By exercise` and provide a local,
  non-persisted `By exercise` / `By muscle` toggle.
- Preserve the existing per-exercise raw volume, median comparison, P5–P95
  distribution, and its baseline/no-history states.
- Derive the equivalent per-muscle comparison from mapped, weighted session
  volume and eligible prior completed sessions, using the canonical muscle
  contribution and load-input-mode rules.
- Ensure live insights update from confirmed performed sets, tolerate missing
  mappings/history, and cannot be overwritten by a stale asynchronous read.
- Keep `Share session` exercise-only regardless of the selected visible mode.
- Add unit, component/navigation, share, and on-device flow coverage for the
  accepted behavior, and update the affected authoritative UI docs.

### Out of scope

- Persistence, sync envelopes, database schema, backend APIs, or server-side
  analytics.
- Changing confirmed-set semantics, exercise-to-muscle contribution weights,
  load-input-mode behavior, or historical eligibility outside the summary.
- Persisting or syncing the summary toggle.
- Exporting a muscle-group share image.
- Restoring the retired recorder or its removed muscle-load sheet.
- Redesigning the completed-session individual-set presentation or the
  completed-session editor beyond the explicit routes into them.
- Implementing unrelated feedback actions `ACT-003` or `ACT-004`.

## UI impact

- UI Impact?: `yes` — this changes the default History destination, adds
  explicit summary actions, and creates a shared toggleable presentation used
  in three user contexts.
- Accepted design target: a repo-native brief. The build 13 completion Summary
  is the internal visual reference for hierarchy and exercise comparison; the
  UX Contract below governs the new mode toggle, live context, historical
  actions, and edge states. Before implementation, pin representative current
  Summary screenshots and record the intended small/large-phone states in the
  implementing PR or a concise `docs/specs/ui/design-targets/` record if the
  target must remain durable.
- Conflict rule: if the current running UI, this card, the feedback card, or
  authoritative UI docs conflict materially, report and resolve the conflict
  before changing the accepted target or production behavior.

## UX Contract

### Flow 1 — Review a completed workout from History

- Trigger: the user taps a completed row in Progress → Sessions History.
- Steps: open that session's Summary; from there the user may share it, open
  `View individual sets`, or choose `Edit session`. The row overflow Edit action
  remains a direct expert shortcut to completed-edit mode.
- Success outcome: review is the default, mutations are explicit, individual
  sets and editing are each reached by session ID, and Back returns
  deterministically to Sessions History without creating an editor copy.
- Failure/edge outcome: loading, deleted, or missing sessions show the existing
  safe state and exit path; repeated navigation does not duplicate or mutate a
  session, and Android Back/iOS swipe-back do not strand the user in an editor.

### Flow 2 — Compare a session by exercise or muscle

- Trigger: the user opens `Session so far` during a workout, reaches Summary
  after Finish, or opens Summary from History.
- Steps: the shared presentation opens on `By exercise`; the user switches to
  `By muscle` and back without changing session data. Exercise rows compare raw
  session volume with that exercise's eligible history. Muscle rows compare
  weighted session volume with that muscle's eligible weighted history.
- Success outcome: all three contexts use the same comparison vocabulary and
  P5/median/P95 treatment; switching is immediate; reopening a summary resets
  to `By exercise`; live confirmed-set changes refresh the newest result.
- Failure/edge outcome: single/equal baselines, no history, unmapped or partly
  mapped exercises, empty sessions, loading, and recoverable read errors have
  explicit non-blocking states. Logging and finishing remain available, and a
  late result for older live input cannot replace a newer result.

### Flow 3 — Share from a summary

- Trigger: the user chooses `Share session` from a just-completed or historical
  Summary, including after selecting `By muscle`.
- Steps: open the existing share preview and export action using the exercise
  comparison data.
- Success outcome: preview and exported image always show `By exercise`; the
  visible toggle selection is neither exported nor persisted.
- Failure/edge outcome: cancellation and export failure retain the current
  summary and its local state, surface the existing feedback, and do not change
  session data.

### Interaction + appearance notes

- Reuse the completion Summary's hierarchy, comparison row, P5–P95 bar,
  baseline/no-history language, and existing UI tokens/primitives.
- Use a two-option accessible control with text labels `By exercise` and
  `By muscle`; selection must not be communicated by color alone.
- Keep context actions outside the shared insight body: live has no Share/Done,
  completion has Share/Done, and history has Share plus individual sets/Edit.
- Muscle bars describe each muscle against its own history; never normalize
  them to the largest muscle in the current session.
- Keep the presentation readable without horizontal scrolling on supported
  small and large phone widths.

## Acceptance criteria

1. A completed History row opens an explicit historical Summary, while its
   overflow Edit action still opens completed-edit directly.
2. Historical Summary exposes deterministic `View individual sets` and
   `Edit session` actions and returns to History without relying on accidental
   stack order.
3. Live, completion, and historical contexts render one shared insight body;
   their context-specific actions remain separate.
4. Every newly opened summary defaults to `By exercise`, and the toggle is
   local presentation state only.
5. Exercise mode preserves current raw-volume and historical
   P5/median/P95 behavior, including no-history and single/equal-baseline
   states.
6. Muscle mode uses weighted volume from confirmed performed sets, canonical
   mapping contributions, and canonical load-input-mode handling; each muscle
   is compared with the same muscle in eligible earlier, non-deleted completed
   sessions.
7. Unconfirmed/planned sets do not enter either comparison; unmapped or
   partially mapped exercises produce an honest, tested state rather than
   fabricated full-muscle contributions.
8. Live insight reads never block logging, finishing, or navigation, and stale
   async results cannot overwrite calculations for newer confirmed-set input.
9. Share preview and export always use the exercise presentation, even when
   `By muscle` is selected on screen.
10. Loading, empty, missing/deleted target, recoverable error, and share
    cancel/failure behavior is covered alongside the happy paths.
11. Common controls, typography, surfaces, spacing, and comparison rows reuse
    documented tokens/primitives/shared components; no raw color literal is
    introduced in a screen file.
12. Relevant authoritative UI docs are updated in the implementation PR, and
    visual comparison evidence covers the accepted small/large-phone states.

## Docs touched

- Planned authoritative updates:
  - `docs/specs/ui/navigation-contract.md` — restore and define historical
    Summary query/transition behavior and its deterministic destinations.
  - `docs/specs/ui/screen-map.md` — document Summary-first History and the
    shared live/completion/history insight states and actions.
  - `docs/specs/ui/ux-rules.md` — document exercise/muscle comparison semantics,
    local default/reset behavior, and exercise-only sharing.
  - `docs/specs/ui/components-catalog.md` — update only if the implementation
    introduces or materially changes a reusable insight/toggle component API.
- `docs/specs/08-ux-delivery-standard.md` needs no planned update: this task
  applies existing progressive-disclosure and reusable-component patterns; it
  does not yet establish a new cross-task UX pattern. Update it only if
  implementation actually introduces one.
- No architecture, data-model, sync, or project-structure update is expected
  because the task changes presentation, navigation, and pure derived insight
  calculations without new persistence or canonical paths.
- Tokens/primitives compliance:
  - Reuse `UiText`, `UiSurface`, existing buttons/toggle patterns, semantic
    colors, spacing tokens, and the existing exercise comparison presentation.
  - Exceptions: none planned. Any screen-local styling or raw literal must be
    justified in the implementing PR and reconciled with UI guardrails.
- UI artifacts/screenshots are required. Capture live, just-completed, and
  historical summaries in exercise and muscle modes; historical individual-set
  and Edit destinations; representative loading/no-history/partial-mapping or
  error states; and exercise-only share after selecting muscle. Include the
  key states on the supported small and large phone targets.

## Testing and verification approach

- Add pure calculation tests for exercise parity and muscle weighting,
  eligibility, P5/median/P95 distributions, single/equal baselines, no history,
  mapping gaps, contribution weights, and load-input modes.
- Add component tests for default/toggle/reset behavior, accessibility,
  live-update reversal/stale-read protection, loading/empty/error states, and
  context-specific actions.
- Add navigation tests for History row versus overflow Edit, historical Summary
  → individual sets, historical Summary → completed-edit, safe missing/deleted
  exits, and deterministic Back behavior.
- Add share regression coverage proving that selecting `By muscle` cannot alter
  preview/export input.
- Extend a committed Maestro lane that already owns the affected session flow,
  rather than committing an unlaned flow. Cover at least one live toggle and
  the History → Summary → individual sets/Edit path.
- Run `./boga test for` against the implementation diff before gates. Expected
  required gates from the planned paths are `./boga test fast` and
  `./boga test frontend`; run every additional lane reported by the command.
- CI is partial: infra-free fast lanes run in CI, while the full iOS simulator
  frontend gate and its visual/interaction evidence must run locally.
- Hosted/deployed smoke: `N/A`; no backend or deployed contract is in scope.

## Implementation notes

- Likely areas allowed to change:
  - `apps/mobile/app/sessions.tsx`
  - `apps/mobile/app/completed-session/[sessionId].tsx`
  - `apps/mobile/app/session/[sessionId]/index.tsx`
  - `apps/mobile/components/session-recorder/`
  - `apps/mobile/components/session-view/`
  - `apps/mobile/src/session-insights/`
  - corresponding tests and the existing session-owned Maestro flow/runner
  - the authoritative UI docs listed above
- Prefer one grouping-neutral comparison model and presentation where that
  reduces duplication, while retaining domain-explicit types where exercise
  identity and muscle identity differ.
- Historical eligibility is earlier, non-deleted completed sessions with
  confirmed performed sets only. Define ordering/tie behavior explicitly in
  pure calculations rather than in rendering code.
- Do not restore deleted recorder paths or couple navigation actions to an
  assumed prior route.
- Project structure impact: none planned; use existing route, component,
  insight, test, Maestro, and UI-doc locations.

## Mandatory verify gates

- `./boga test fast`
- `./boga test frontend`
- Any additional lane required by `./boga test for --diff <implementation-base>`
- `./scripts/task-closeout-check.sh docs/plans/tasks/T-20260924-01-Implement_session_summary_feedback.md`

## Evidence required at closeout

- Exact `./boga test for` trigger output and green gate/lane results in the PR.
- Unit/component/navigation/share test results mapped to the acceptance criteria.
- Maestro artifact paths for live and History summary interactions.
- Small/large-phone screenshots and accepted-target comparisons for the states
  listed under `Docs touched`, with material differences or deviations called
  out explicitly.
- Manual verification that History returns correctly, logging remains usable
  during insight loading/failure, and sharing stays exercise-only after the
  muscle toggle.
- Replacement-build verification remains release ownership: do not mark
  `FB-001` or `FB-002` verified from source review or simulator gates alone.

## Completion note

- What changed:
- What tests ran:
- UX Contract → implementation/test mapping:
- Visual evidence and accepted-target differences:
- Feedback/build verification recorded:
- What remains:

Delete this card in the change that completes or abandons its work, after any
durable decisions have been moved into the owning specs and the source feedback
card records the implementing PR and replacement-build result.
