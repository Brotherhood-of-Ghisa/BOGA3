---
task_id: T-20260726-01-Confirm_sets_before_performance
milestone_id: "MVP"
status: completed
ui_impact: "yes"
areas: "frontend|backend|cross-stack|docs"
runtimes: "node|expo|maestro|supabase|docs"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend && ./boga test frontend"
docs_touched: "docs/specs/05-data-model.md, docs/specs/08-ux-delivery-standard.md, docs/specs/ui/ux-rules.md, docs/specs/ui/screen-map.md"
---

# Confirm Sets Before Performance

## Task metadata

- Task ID: `T-20260726-01-Confirm_sets_before_performance`
- Title: Require explicit set confirmation before performance
- Status: `completed`
- Session date: 2026-07-31
- Session interaction mode: `interactive`

## Parent references (required)

- Project directives: `AGENTS.md`, `docs/specs/README.md`
- Milestone spec: N/A - user-requested recorder behavior correction.
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Sync contract: `docs/specs/tech/sync-v2-server-contract.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Quality gates: `docs/specs/02-quality-and-test-gates.md`
- Project structure: `docs/specs/09-project-structure.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
- Maestro contract: `docs/specs/11-maestro-runtime-and-testing-conventions.md`
- Maestro runbook: `apps/mobile/README-maestro.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit: `codex/set-performance-confirmation-task`
  at `788cd80` after merging current
  `origin/main` (`a50fd9f`) on 2026-07-31.
- Start-of-session sync with `origin/main` completed?: `yes`; fetched
  `origin/main` and merged its eight post-branch commits before implementation
  so this task integrates with the current collapsible-card recorder and M21
  baseline.
- Parent refs opened in this session:
  - `AGENTS.md`
  - `docs/specs/README.md`
  - `docs/specs/02-quality-and-test-gates.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/11-maestro-runtime-and-testing-conventions.md`
  - `docs/specs/tech/sync-v2-server-contract.md` (relevant A.1/A.2 and B.2/B.3 sections)
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/ux-rules.md`
  - `apps/mobile/README-maestro.md`
  - `apps/mobile/app/__tests__/README.md`
- Code/docs inventory freshness checks run:
  - Recorder set construction, row-state derivation, plan log/skip actions,
    submission cleanup, autosave, collapsed-card summaries, and row rendering
    re-inspected on 2026-07-31 after the `origin/main` merge.
  - `performance_status` local persistence, normalization, Sync v2 mapping, and
    server text-column contract re-inspected on 2026-07-31.
  - Completed-history/detail, live Past Records, exercise catalog/history,
    session-list, stats, muscle/exercise analytics, and suggested-plan consumers
    inventoried on 2026-07-31.
  - Recorder/repository/analytics/sync Jest coverage and Maestro data/sync
    logging flows re-inventoried on 2026-07-31.
  - `./boga test for` run against the planned implementation paths on
    2026-07-31; required union is `fast`, `backend`, `frontend`, `docs-check`,
    and `meta-tests` (the last two are included by the aggregate work but remain
    named for evidence).
- Known stale references or assumptions:
  - Current authoritative UI docs describe the left glyph as plan/comparison
    state (`•`, `○`, `✓`, `≈`, `−`, `+`) and the appended-row `Log` action.
    Those statements are deliberately superseded by this task and must be
    updated with the implementation.

## Objective

Make explicit confirmation the single authoritative transition from an entered
set to a performed set. Every recorder row must use the left slot as a
performance control: a hollow circle while unperformed and a green tick when
performed. Normal and appended sets must share the behavior, and confirmation
must survive autosave, navigation, sync, completed-edit autosave, and restore.

## Scope

### In scope

- Add a persisted `unperformed` set status using the existing
  `exercise_sets.performance_status` text field.
- Make newly created empty sets and copied/defaulted sets unperformed.
- Preserve legacy compatibility: an existing valid set with `performance_status
  = null` remains confirmed/performed after upgrade.
- Replace the recorder row's plan-comparison glyph with an explicit,
  independently tappable performance control in compact and editable modes.
- Use a hollow circle for unperformed rows and a green tick for confirmed rows.
- Allow the green tick to be tapped again to mark a set unperformed without
  clearing its entered values.
- Remove the appended-set `Log` button and use the same left confirmation
  control to perform the prescribed or edited values.
- Remove left-side matched, modified, skipped, and added glyph semantics.
- Retain the useful prescribed-versus-actual text treatment for modified
  appended rows; plan comparison may remain derived internally but must not
  control the left indicator.
- Keep `Skip` as the appended row's explicit secondary action and keep skipped
  styling/text discoverable without overloading the confirmation glyph.
- Exclude unperformed rows from performed counts, live metrics, history,
  records, suggested plans, completed-session views, and analytics.
- Preserve unperformed rows and values through active/completed-edit autosave,
  hydration, sync, and reinstall restore.
- Add an explicit completion cleanup decision for entered-but-unconfirmed rows;
  never silently promote or silently discard them.
- Update existing Maestro workout-entry flows to confirm the set before submit,
  and capture normal/appended confirmation evidence.

### Out of scope

- A new database column, timestamped confirmation history, or server migration.
- Replacing the existing weight/reps/quality inputs.
- Changing set quality semantics (`W-Up`, `RIR 0`, `RIR 1`, `RIR 2`).
- Removing prescribed-versus-actual values from appended rows.
- Bulk “confirm all” behavior or implicit confirmation during session submit.
- New navigation routes or a broader recorder visual redesign.

## UI Impact (required checkpoint)

- UI Impact?: `yes`
- Reuse the existing recorder row layout, `SessionContentLayout`, UI color
  tokens, spacing tokens, and swipe infrastructure.
- The left indicator becomes a dedicated accessible control rather than
  decorative text inside the row edit target.
- No raw color literal is permitted for the green tick; use
  `uiColors.actionSuccess` (or a canonical success token added centrally only
  if the existing token is insufficient).

## UX Contract

### Key user flows

1. Flow name: Enter and confirm a normal set
   - Trigger: user adds an exercise or adds another set.
   - Steps: the row starts with a hollow circle; the user enters valid weight
     and reps; the user taps the circle.
   - Success outcome: values commit, the row collapses, the indicator becomes a
     green tick, autosave persists the performed state, and performed metrics
     update.
   - Failure/edge outcome: invalid or missing required values cannot be
     confirmed; the row remains editable/unperformed and existing field
     validation cues remain visible. Blank weight plus positive integer reps
     remains valid and canonicalizes to `0kg`.
2. Flow name: Undo and restore performance
   - Trigger: user taps a green tick on a confirmed set.
   - Steps: the set becomes unperformed but retains weight, reps, and quality;
     the user may edit it and tap the hollow circle again.
   - Success outcome: summaries and live metrics stop counting the set while
     unperformed and resume only after explicit reconfirmation.
   - Failure/edge outcome: autosave, navigation, hydration, and sync must not
     silently restore the performed state.
3. Flow name: Perform an appended prescribed set
   - Trigger: an appended historical/program target is visible.
   - Steps: the untouched row shows its prescription and a hollow circle; the
     user either taps the circle to perform it as prescribed or opens the row,
     edits actual values, and then taps the circle.
   - Success outcome: no `Log` button is needed; the row gains the green tick.
     A modified actual may still show the struck prescription above it, without
     a matched/modified left glyph.
   - Failure/edge outcome: `Skip` remains available; a skipped row is visually
     explicit and can later be performed through the hollow confirmation
     control without a separate Log action.
4. Flow name: Complete with unconfirmed work
   - Trigger: user submits/saves a session containing entered but unticked sets.
   - Steps: completion presents a specific cleanup confirmation rather than
     counting or dropping those rows.
   - Success outcome: cancellation returns to the recorder unchanged; explicit
     discard completes with confirmed actual sets only.
   - Failure/edge outcome: untouched planned targets and explicitly skipped
     targets retain their existing actual-only completion semantics, while a
     valid entered unconfirmed row is never mistaken for performed.

### Interaction + appearance notes

- The left control uses checkbox semantics with
  `accessibilityState={{ checked: performed }}` and a mobile-sized hit target.
- The hollow and checked states must remain understandable without color; the
  confirmed state additionally uses the canonical success green.
- The row body continues to open/collapse editing independently of the left
  control.
- Editing a set that is already confirmed does not automatically undo
  performance; only tapping its green tick does.
- Appended match/modified classification may drive value layout, but never the
  confirmation glyph or accessible checked state.

## Acceptance criteria

1. `SessionSetPerformanceStatus` supports
   `'planned' | 'skipped' | 'unperformed' | null`, where a valid actual set with
   `null` is confirmed/performed.
2. The repository normalizer preserves `unperformed` instead of coercing it to
   `null`.
3. Existing valid active and completed rows with legacy `null` status remain
   performed; blank/partial legacy draft rows become unperformed before new
   valid entry can accidentally auto-confirm them.
4. New empty and copied/defaulted rows remain unperformed even when copied
   weight/reps are already valid.
5. The left control renders a hollow circle for unperformed/planned/skipped
   states and a green tick only for confirmed valid actual sets.
6. Confirmation is a dedicated accessible checkbox-like target and does not
   conflict with row editing, quality selection, or swiping.
7. A normal row can confirm only valid values; blank weight plus positive reps
   confirms as `0kg`.
8. Tapping a confirmed tick changes only performance status and retains actual
   values and quality.
9. Appended rows have no visible `Log` button and no Log swipe action; tapping
   the hollow control performs prescribed values or already-edited actual
   values.
10. `Skip` remains explicit and reversible through the confirmation control,
    with a non-glyph skipped cue.
11. Left-side `•`, matched `✓`, modified `≈`, skipped `−`, and added `+`
    meanings are removed. Modified prescription/actual text remains supported.
12. Card summaries, active-session set counts, live Past Records metrics,
    completed-history/records, suggested-plan selection, muscle/exercise
    analytics, and completed-session display count only confirmed actual sets
    where “performed/completed” semantics are intended.
13. Active and completed-edit autosave preserve unperformed rows losslessly,
    while final submit/save persists only confirmed actual rows to completed
    history.
14. Entered unconfirmed rows require an explicit discard decision during
    completion; they are neither auto-confirmed nor silently lost.
15. `unperformed` round-trips through the existing Sync v2
    `performance_status` text field with no schema/server migration.
16. Focused unit, component, repository, analytics, sync-wire, submit, and
    Maestro coverage proves the happy and edge paths.
17. Screen UI uses documented tokens/shared components; no raw color literals
    are introduced in screen files.
18. Relevant authoritative data/UI docs are updated in the same task.

## Docs touched (required)

- Planned docs/spec files to update:
  - `docs/specs/05-data-model.md` - define `unperformed`, legacy-null
    compatibility, actual-only completed history, reader filtering, and the
    explicit Sync v2 impact decision.
  - `docs/specs/08-ux-delivery-standard.md` - add the reusable performed-set
    confirmation pattern because this task introduces a new row interaction
    contract.
  - `docs/specs/ui/ux-rules.md` - replace plan-state glyph and Log-action rules
    with the confirmation-control semantics and submission edge behavior.
  - `docs/specs/ui/screen-map.md` - update the recorder's normal/appended row
    states and confirmation/skip behavior.
- Explicit no-update decisions:
  - `docs/specs/03-technical-architecture.md` - no top-level architecture
    decision changes; the existing local-first repository/autosave stack is
    reused.
  - `docs/specs/06-testing-strategy.md` - no lane, gate, or cross-cutting test
    policy changes are planned.
  - `docs/specs/tech/sync-v2-server-contract.md` - no column or wire mapping
    changes; `performance_status` is already nullable unconstrained text and
    round-trips as a typed field. Update only if implementation reveals a
    normative wire-contract change.
- UI docs update required?: `yes`.
  - `docs/specs/ui/ux-rules.md` maps to the UI index trigger for changed row
    interaction/state semantics.
  - `docs/specs/ui/screen-map.md` maps to changed recorder states and actions.
- Tokens/primitives compliance statement:
  - Reuse plan: use `uiColors.actionSuccess`, existing muted/border tokens,
    recorder row layout, `SessionContentLayout`, and existing swipe behavior.
  - Exceptions: a screen-local confirmation control style is allowed because
    the row renderer is currently screen-local; it must use tokens and may not
    introduce raw colors. Extract a reusable primitive only if another consumer
    needs the same API during implementation.
- UI artifacts/screenshots expectation:
  - Required?: `yes`.
  - Planned captures/artifacts:
    - normal valid row before confirmation (hollow circle);
    - the same row after confirmation (green tick);
    - appended prescribed row with no Log button;
    - appended confirmed/modified row showing the green tick and
      prescription-versus-actual layout;
    - invalid/unconfirmed edge state.

## Testing and verification approach

- Planned focused checks:
  - `session-set-semantics` unit coverage for valid values versus confirmed
    performance.
  - `session-drafts-repository` persistence/hydration coverage for
    `unperformed`, legacy `null`, active drafts, and completed-edit autosave.
  - recorder screen/interaction coverage for hollow/tick states, independent
    edit target, copied sets, appended prescribed/modified confirmation, skip,
    undo, quality behavior, and accessibility state.
  - recorder persistence/submit coverage for autosave and explicit unconfirmed
    cleanup.
  - session-list, exercise-block-history, exercise-history/catalog stats,
    muscle/exercise analytics, and stats repository coverage proving
    unperformed rows do not count.
  - Sync wire/round-trip coverage proving `performance_status='unperformed'`
    survives serialization, push, pull, and hydration.
  - Maestro updates to `data-runtime-smoke.yaml` and
    `sync-first-run-log-and-roundtrip.yaml` so the set is explicitly confirmed
    before submission.
  - Targeted simulator visual evidence for normal and appended rows.
- Standard local gate usage:
  - `./boga test fast`
  - `./boga test backend`
  - `./boga test frontend`
  - `./boga test docs-check` and `./boga test meta-tests` named explicitly in
    evidence even though the aggregate gates cover their required work.
- Test layers covered:
  unit, component interaction, repository integration, analytics/read-model
  regression, Sync v2 contract/round-trip, and iOS Maestro E2E.
- Execution triggers:
  always at task closeout after focused tests; re-run affected focused tests
  after any fix.
- Slow-gate triggers:
  `backend` is required because `apps/mobile/src/data/**` behavior changes;
  `frontend` is required because recorder UI/components and committed Maestro
  flows change.
- Hosted/deployed smoke ownership:
  N/A; this task adds an allowed value to an existing unconstrained text field
  and requires no hosted schema/RPC deployment.
- CI/manual posture note:
  CI covers infra-free lanes only. Backend and iOS gates must run locally on
  this machine; use `./boga doctor` to repair prerequisites rather than skip.
- Notes:
  do not estimate durations; use `./boga timings` only when reporting measured
  gate timings.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/app/(tabs)/session-recorder.tsx`
  - `apps/mobile/components/session-recorder/types.ts`
  - `apps/mobile/src/session-recorder/set-semantics.ts`
  - `apps/mobile/src/data/session-drafts.ts`
  - confirmed-set consumers under `apps/mobile/src/data/**`
  - completed-session/session-list display code only where confirmed filtering
    is required
  - focused tests under `apps/mobile/app/__tests__/`
  - relevant committed flows under `apps/mobile/.maestro/flows/`
  - docs listed under `Docs touched`
- Recommended internal model:
  - Keep performance and plan comparison as separate axes.
  - `hasValidActualValues(set)` answers whether values could be performed.
  - `isConfirmedPerformed(set)` requires valid values and confirmed persisted
    status.
  - Plan comparison (`none | matched | modified`) remains derived only for
    appended-row value presentation.
- State transitions:
  - new normal/copied row -> `unperformed`;
  - untouched appended target -> `planned`;
  - edit planned/skipped target -> hydrate actuals and set `unperformed`;
  - confirm valid actual or prescribed target -> `null`;
  - unconfirm -> `unperformed`, retaining actuals;
  - skip appended target -> `skipped`, clearing actuals as today.
- Project structure impact:
  no new top-level or canonical directory. A focused helper/test within existing
  recorder directories is allowed; update `docs/specs/09-project-structure.md`
  only if implementation unexpectedly changes a path convention.
- Sync impact decision:
  `in sync scope` through the existing `exercise_sets.performance_status`
  client/server text column and existing Sync v2 serializer. No schema or server
  migration is required. Add compatibility and round-trip tests.
- Constraints/assumptions:
  - Editing a confirmed set keeps it confirmed; the user must tap the green tick
    to undo performance explicitly.
  - Untouched planned and explicitly skipped rows retain current actual-only
    completion behavior.
  - Entered unconfirmed values receive a specific cleanup decision on
    completion.

## Mandatory verify gates

- `./boga test fast`
- `./boga test backend`
- `./boga test frontend`
- `./scripts/task-closeout-check.sh docs/tasks/T-20260726-01-Confirm_sets_before_performance.md`
- `./boga test for --diff origin/main...HEAD` to record the final path-trigger
  reasons in the task evidence and PR body.

## Evidence

- Focused test commands/results:
  - Focused Jest selection covering the 15 recorder, persistence, read-model,
    completed-detail, and sync-wire suites listed above: `15` suites / `235`
    tests passed.
  - `exercise-block-history-fixture.yaml`: passed end to end, including planned
    hollow rows, prescribed confirmation, modified actual values, and the
    confirmed-only collapsed summary.
- Confirmed-state persistence and Sync v2 round-trip evidence:
  - Repository coverage proves legacy valid `null` rows remain confirmed,
    invalid legacy rows hydrate as `unperformed`, and active/completed-edit
    autosaves preserve valid unperformed values.
  - `sync-cycle-wire.test.ts`, the real `sync-infra` mobile cycle in
    `./boga test backend`, and `ios-sync-e2e` all passed with
    `performance_status='unperformed'` preserved across wire, push/pull, local
    hydration, and device restore.
- Normal-row simulator screenshots/artifact paths:
  - `apps/mobile/artifacts/maestro/ad-hoc/20260731-145643-43020/maestro-output/screenshots/set-performance-normal-invalid.png`
  - `apps/mobile/artifacts/maestro/ad-hoc/20260731-145643-43020/maestro-output/screenshots/set-performance-normal-unconfirmed.png`
  - `apps/mobile/artifacts/maestro/ad-hoc/20260731-145643-43020/maestro-output/screenshots/set-performance-normal-confirmed.png`
- Appended-row simulator screenshots/artifact paths:
  - `apps/mobile/artifacts/maestro/ad-hoc/20260731-150519-46235/maestro-output/screenshots/set-performance-appended-plan-unconfirmed.png`
  - `apps/mobile/artifacts/maestro/ad-hoc/20260731-150519-46235/maestro-output/screenshots/set-performance-appended-plan-confirmed.png`
  - `apps/mobile/artifacts/maestro/ad-hoc/20260731-150519-46235/maestro-output/screenshots/exercise-block-comparison-expanded.png`
- Integrated gate results/artifact paths:
  - `./boga test fast`: PASS after the final source/flow edits; lint,
    typecheck, all mobile Jest suites, local backend smoke, docs-check,
    meta-tests, agent-auth web, and MCP unit/build passed.
  - `./boga test backend`: PASS; auth/RLS, agent API, schema, push/pull,
    dev-wipe, drift, Sync v2 integration, real mobile sync-infra, and MCP smoke
    passed. Per-lane records are under `docs/testing/timings/records/` with the
    `20260731T134355Z` through `20260731T134906Z` prefixes.
  - `./boga test frontend`: PASS; `ios-smoke`, `ios-data-smoke`,
    `ios-auth-profile`, and `ios-sync-e2e` passed. Artifact roots:
    `20260731-144923-37499`, `20260731-145050-38615`,
    `20260731-145217-40147`, and `20260731-145412-41700` under
    `apps/mobile/artifacts/maestro/ad-hoc/`.
  - Final affected-lane reruns: `ios-data-smoke` PASS at
    `20260731-145643-43020`; targeted appended-plan fixture PASS at
    `20260731-150519-46235`; targeted exercise-heatmap evidence flow PASS at
    `20260731-152445-52368`.
  - `./boga test for --diff origin/main...HEAD`: required union confirmed as
    `fast`, `backend`, `frontend`, `docs-check`, and `meta-tests`, matching the
    gates above.
- Manual verification summary (required when CI is absent/partial): PASS.
  Visually inspected the normal and prescribed-flow simulator captures. The
  hollow control remains visible for invalid, entered-unconfirmed, planned, and
  skipped states; the confirmed control is a green tick; appended rows have no
  Log action; and the modified prescription/actual layout remains legible.
- Deferred/manual hosted checks summary:
  N/A. The existing nullable text column and Sync v2 field carry the new value;
  no hosted schema, RPC, or deployment change is required.

## Completion note

- What changed: Added explicit persisted set confirmation, unified normal and
  prescribed row controls, lossless unconfirmation/autosave, confirmed-only
  completion and read models (including the agent API), explicit cleanup for
  entered-unconfirmed work, updated Sync coverage, and authoritative UI/data
  documentation.
- What tests ran: Focused Jest selection (`15` suites / `235` tests), full
  `fast`, `backend`, and `frontend` gates, final `ios-data-smoke`, targeted
  appended-plan and exercise-heatmap Maestro fixtures, docs/meta checks, diff
  integrity, final path-trigger mapping, and task closeout validation.
- What remains: None.
- Closeout result: PASS; the sole warning is the intentional absence of a
  milestone reference for this user-requested correction.

## Status update checklist

- Update `Status` and frontmatter `status` together.
- Fill evidence and completion notes before handoff.
- Move this card to `docs/tasks/complete/` when completed or outdated.
- Update `docs/specs/05-data-model.md`,
  `docs/specs/08-ux-delivery-standard.md`,
  `docs/specs/ui/ux-rules.md`, and `docs/specs/ui/screen-map.md`.
- Record the explicit Sync v2 impact decision and compatibility evidence.
- Run `./scripts/task-closeout-check.sh` before handoff.
