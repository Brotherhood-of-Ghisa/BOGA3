# T-20261106-01 — Routines: reuse standalone plans anytime

- Status: `ready` — mock v3 accepted; standalone-only scope and reuse of
  existing outcome rules agreed. Technical design and implementation remain.
- Depends on: none; refresh assumptions against current `origin/main` before execution.
- Milestone: none; one cross-stack implementation PR using the task protocol.
- Areas: frontend, backend, sync; UI impact: yes.

## Agent handoff

- Implement the decisions in this card. Mock v3 acceptance and the two product
  questions below are settled; do not request those decisions again.
- Accepted visual input: `docs/plans/designs/routines-anytime-v3.html`, with
  acceptance and subsequent standalone-only clarification recorded in
  `docs/plans/designs/routines-anytime-v3.md`. V1/v2 and the control comparison
  are historical; their programme-conversion examples do not apply.
- Use `docs/plans/designs/routines-anytime-v2.md` only for the source inspection
  and verification map, subject to this card's final scope. Select the smallest
  correct internal per-use model; no production implementation exists yet.
- The worktree and local preview URLs below describe this planning session,
  not a required execution environment. Refresh the base and acquire an
  isolated worktree/lease through the normal task protocol. If starting from a
  branch containing this handoff before it reaches main, preserve this commit.
- Screenshots and copied preview fonts are gitignored evidence, not committed
  runtime assets. The frozen HTML refers to its artifact directory; if absent,
  copy its named fonts from the mobile package's existing `@expo-google-fonts`
  dependencies into that directory without changing the frozen target. Do not
  depend on a live preview server. Running-native review/acceptance and all
  implementation gates remain required.

## Execution checkpoint

- Refreshed against merged `origin/main` at `a941bf6e`; current completed-plan
  support is present. Existing provenance uniqueness and consumed-block guards
  still require per-use identity; no production changes have been made.
- Worktree: `/private/tmp/boga-worktrees/codex-routines-anytime`, branch
  `codex/routines-anytime`, slot 41. `./boga doctor` passed on 2026-11-06.
- Current reviewable mock and revised plan:
  `docs/plans/designs/routines-anytime-v3.md` and
  `docs/plans/designs/routines-anytime-v3.html`; technical planning remains in
  `docs/plans/designs/routines-anytime-v2.md`.
- Current focused mock evidence: `apps/mobile/artifacts/routines-anytime/v3/`;
  locked/editable/save-error states captured at 390 × 844 and 320 × 700 pt.
  The switch restored an editable date picker when off and a passive lock-marked
  Anytime row when on, with no horizontal overflow. These are prototype checks,
  not app gates or native acceptance.
- Operator rejected v1's conceptual framing: Routine is a quality of the same
  plan, activated with a tick in the current plan creation card. Revised plan
  and mock: `docs/plans/designs/routines-anytime-v2.md` and
  `docs/plans/designs/routines-anytime-v2.html`. No separate Routine object,
  authoring flow, detail route or destructive conversion is intended.
- Human mock acceptance is now **recorded**: the operator answered **Accept
  mock v3** to the switch/locked-Anytime review question. Artifact hash and
  reviewed surfaces are in `docs/plans/designs/routines-anytime-v3.md`.
  Production work and the final gate/PR/review sequence remain outstanding.
- Operator scope clarification after mock acceptance: **No Routine inside a
  programme.** A Routine must be standalone. Programme authoring/editing does
  not offer the property; saving and synced storage reject Routine plus
  programme membership. Do not detach a programme child automatically.
- Operator outcome guidance: **keep existing logic (for non routine plans)
  wherever possible without creating new logics.** Reuse recorder Finish,
  confirmed performed-set eligibility, history dates, correction/deletion/Undo
  and active-workout guards. Add only the repeat-use and explicit-Skip behavior
  this task requires; no parallel routine completion or date-editing engine.
- These answers settle the two presented product questions. The exact internal
  per-use schema, transaction and sync design still need source verification.
  No production implementation, gates, reviews or PR are claimed complete.

## Objective

Let a lifter keep any standalone planned session as a Routine and start it
whenever they want. Finishing or skipping one use leaves the Routine visible and available;
each later use starts with fresh progress. Show the date of the latest
completion or skip, and obtain explicit human acceptance of a mock design
before implementing the UI.

## Scope

- In: an Edit action to make an existing standalone plan a Routine; an authoring
  choice for new plans; the Sessions **Routines** section; routine detail, Start/Resume,
  explicit Skip, outcome dates, safe future edits, persistence and sync.
- In: conversion of scheduled/unscheduled, human/agent-authored
  standalone plans, including unused, active/attached, partially consumed,
  completed and entirely skipped plans. Existing consumption locks must not
  prevent changing routine availability.
- Out: Routines inside programmes; automatic detachment on conversion;
  weekly/calendar recurrence, interval scheduling, reminders, automatic
  missed/skip events, backlog generation, programme looping, automatic target
  progression, and new coaching-agent write capabilities.
- This card prepares the implementation; it does not author the mock or ship
  production UI in the planning PR. Delete it in the implementation PR.

## Decided with the operator

1. The section is called **Routines**. The first version is **Anytime**, with
   no due date or repeat calendar. Ordinary plans retain their existing use.
2. Any live standalone plan can be made a Routine through **Edit**, without
   requiring the lifter to Duplicate it, recreate its blocks or discard prior
   progress.
   Conversion enables future reuse and preserves earlier workouts and links.
3. The Routine remains listed after completion or skip. Each Start uses the
   entire current routine definition, including blocks skipped or unperformed
   in a previous use, with fresh unchecked sets and no carried-over actuals.
4. Partial use is ordinary use: perform two of four exercises and Finish;
   record the performed work in History and update **Last completed**. The
   remaining exercises neither carry over nor block the next Start. Completion
   here means finishing a workout using the Routine, not meeting every target.
5. An active use offers **Resume**. The existing active-workout conflict guard
   remains: another workout is not replaced or silently completed.
6. Show the latest outcome and date on the routine row (**Last completed** or
   **Last skipped**); detail exposes both dates independently when they exist.
   Show **Never used** only when no use is known. A known historical outcome
   with a missing timestamp keeps its outcome with the date unavailable;
   it is not Never used. Use [[copy.calendar-dates]].
7. Only finishing a qualifying routine workout updates Last completed.
   Opening, starting, editing or abandoning does not. Explicit Skip records a
   skipped use with its own timestamp and no performed workout; it preserves
   Last completed and immediately leaves the Routine available. Do not mark
   unfinished work skipped merely because a workout finishes.
8. Routine definition edits affect future starts. Existing active/completed
   workout snapshots remain unchanged, and logging a different actual weight
   does not silently rewrite the routine's prescribed targets.
9. Human acceptance of the **mock design before UI implementation** is a
   task-specific requirement from the operator, including when existing
   components could otherwise be reused without a separate acceptance step.
10. **Routine is a property of the existing plan** (operator clarification,
    2026-11-06): activate it in the current creation/edit card. The operator
    subsequently selected SwitchRow for this on/off property.
    Preserve the plan identity and reuse the current editor/detail/row. The
    Routines section groups these flagged plans; it is not a separate entity
    workflow. Keep schedule metadata; repeat availability is Anytime in this
    version. A programme child cannot be a Routine and is never detached by
    toggling this property.
11. **No Routine inside a programme** (operator clarification, 2026-11-06).
    Programme forms omit Routine; the data boundary enforces this restriction.
    Existing programme progression is unchanged.
12. **Reuse ordinary-plan logic wherever possible** (operator guidance,
    2026-11-06). Recorder Finish, confirmed-work eligibility and history
    operations remain authoritative. Routine uses need fresh identity and
    explicit Skip outcomes; they do not need separate workout-completion rules.

## Product decisions to graduate when implemented

Highlight these in the implementation plan/PR's `Product facts:` line; add or
change facts only where the authoring criteria require them:

- **New:** reusable intent persists independently of each workout's progress;
  routine completion after partial use permits another full start.
- **New:** latest completion and explicit-skip dates describe uses, not template
  edits; skipped uses never create performed history or training figures.
- **Changed scope:** [[planner.block-completion]] and
  [[planner.progress-outcomes]] currently describe consumable plans. Preserve
  their ordinary-plan/programme meaning and state how routine-use outcomes
  differ, without globally redefining a skipped block as performed work.
- Apply [[copy.no-subtitles]] and [[copy.no-inline-explanation]] to the design.

## Technical design — before production coding

- Choose the smallest execution/provenance model that allows repeated starts
  while keeping historical rows immutable. Decide whether separate use records
  or isolated plan snapshots best fit the existing sync contract; do not reset
  shared consumed blocks or weaken uniqueness globally.
- Scheduled standalone conversion retains the scheduled instant but excludes
  the plan from due queues while Routine is on. Turning it off restores normal
  schedule behavior. Reject programme-child conversion without mutation.
- Use recoverable existing outcomes on conversion, never invented dates. Keep
  the existing confirmed-work predicate and recorder empty-Finish behavior.
  Partial confirmed source work still satisfies the agreed recurring-use
  requirement; manual-only or abandoned work must not create a completion.
- Turning Routine off through Edit stops future repeat availability and restores
  ordinary-plan visibility with the retained schedule. Preserve active/completed
  uses and their history; add no archive subsystem.
- Reuse existing history correction/deletion/Undo semantics. Prove offline
  conflict handling, including Start racing Skip and retries on two devices.
- The UI composition and mock v3 are accepted. Preserve that standalone-plan
  composition and the fresh-start requirement after partial use.

## UX contract and design target

Load `docs/specs/ui/components-catalog.md`,
`docs/specs/08-ux-delivery-standard.md` and
`docs/specs/ui/ai-design-policy.md` when designing these surfaces. Start from
the existing plan rows/detail/editor, ListRow/Card, SwitchRow and Sheet; show
the applicable approved families and recommend the smallest fitting composition.
Record real exports/variants and any custom delta in the implementation PR's
`ui-pattern-selection` declaration. No reusable-template promotion is required.

### Mock-design acceptance — required before production UI implementation

1. Produce a reviewable mobile mock/prototype in a repo-native brief with
   rendered mock screens or in an external design artifact. Keep it with this
   task/PR as a build input, never in persistent specs; gitignored screenshots
   belong under `apps/mobile/artifacts/`.
2. Show Sessions with Routines among the existing sections, the Edit conversion
   control on an already completed plan, and routine detail with Start/Resume,
   Skip, and the latest outcome dates. Include never-used, completed, latest-skip,
   active-use, long-title/small-phone and save/error states. Demonstrate the
   partial-workout-to-fresh-start sequence in the mock.
3. Present it to the human and explicitly request acceptance or revisions.
   Record the human, artifact/version, reviewed surfaces and their explicit
   response in the implementation PR. Agreement on this card is **not** mock
   acceptance; silence, elapsed time and AI review are not acceptance either.
4. Keep dependent production UI work pending until accepted. Independent source
   reading and technical design may continue. A material change to the agreed
   interaction or layout requires renewed mock acceptance.

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Make a Routine | Open a standalone plan, Edit, enable Routine, Save. | Same authored plan becomes available in Routines; prior progress/history survives. | Programme child conversion is refused without detaching it; Cancel writes nothing; save failure retains input and offers retry. Attached/completed/skipped blocks do not disable conversion. |
| Use and reuse | Start a Routine, perform some or all prescribed work, Finish; Start again. | Completed workout enters History; Last completed updates; next use has every current block with fresh progress. | Repeated tap/retry creates one use; unrelated active workout offers Resume. No performed work follows the separately agreed empty-workout rule. |
| Resume or abandon | Leave an active routine workout; return and Resume, or explicitly abandon. | Resume keeps that use's actuals; abandon preserves the Routine and previous outcome dates. | App restart/offline sync neither duplicates the use nor loses recorded work. |
| Skip one use | From an idle Routine choose Skip. | Last skipped updates, Last completed remains, Start stays available; no workout/figures created. | Guard an active use; failed/retried Skip records at most one event and never discards performed work. |
| Inspect dates | Read the routine row, then its detail. | Row names latest outcome/date; detail distinguishes both dates. Never used means no known use. | A known legacy outcome with no timestamp shows its outcome and unavailable date; date preference/timezone changes format without rewriting stored instants. |
| Edit future intent | Edit a used Routine's exercises or targets, Save; start later. | Future start uses the saved definition; active/history snapshots stay intact. | Explain save conflict locally; preserve entered edits and all prior actuals. |

Reuse tokens and accessible mobile targets; outcome words and dates remain
readable/spoken without relying on colour. Keep explanatory copy out of the UI
under the cited copy facts. Record loading, empty and error feedback in the mock.

## Technical anchors and implementation constraints

Refresh these at execution start; the planning baseline is `35cf8b8d`:

- `apps/mobile/src/session-planner/plan-repository.ts` and `plan-edit-sync.ts`:
  metadata remains editable while consumed blocks are protected. Integrate
  conversion without trying to rewrite the consumed graph.
- `apps/mobile/src/session-planner/materialization.ts`, `deterministic-ids.ts`
  and `block-resolution.ts`: current starts and source links consume one plan.
- `apps/mobile/src/data/schema/sessions.ts` and
  `docs/specs/tech/session-planning-contract.md`: one live performed source
  session/card/set per authored source and deterministic start IDs currently
  prevent repeated starts. Design fresh identity **per use**, retaining
  idempotency and concurrent-device arbitration within a use.
- `apps/mobile/src/data/session-plan-store.ts`: keep SQL in the data layer;
  domain APIs stay under session-planner, and components call those APIs.
- `apps/mobile/components/session-planner/plan-sections.tsx`,
  `plan-form-screen.tsx`, `plan-detail-summary.tsx` and
  `apps/mobile/app/session-plan/new.tsx`: existing list/Edit/detail entrypoints.
- `apps/mobile/src/today-plan/` and
  `apps/mobile/src/session-planner/available-blocks.ts`: check every consumer
  of pending-plan queues so reusable intent does not become an endless due
  item or expose already-used materialization rows.
- Persist/sync routine availability, use identity/provenance and skip outcomes
  with local/server migration parity, ownership and retry safety. Reuse ordinary
  recorder completion and figure eligibility; authored routines and skips
  remain excluded from performed analytics and group streams.
- Preserve existing coaching read/write compatibility. If schema changes affect
  agent projections or validators, update and test compatibility without
  introducing new agent tools or permissions in this first version.

## Acceptance and verification

- Human accepts the mock before production UI implementation, with evidence
  above. After implementation, show the running UI and compare fresh native
  screenshots against that mock at small/normal phone widths. Obtain human
  acceptance of the result before merge; document deviations. This is the
  operator's task-specific review, not a new template-promotion mechanism.
- Jest covers standalone conversions, programme exclusion, full and partial
  uses, a second fresh use, explicit Skip, date ordering, resume/abandon, future edits, guarded failures,
  retries and preserved history. Add migration/sync contract cases proving
  offline persistence and repeated/concurrent starts with per-use provenance.
- Read each test directory's README before editing its tests. Use real data
  boundaries where state/provenance matters; avoid mocked-only lifecycle proof.
- Run `./boga test for` on the actual diff and agree lanes with the reviewer.
  Expected: `fast`, `backend`, `ios-sync-e2e` on macOS plus only frontend-ui
  lanes that exercise the changed surfaces. Reuse existing flows; adding one
  requires a written reason why Jest cannot prove the device behaviour.
- Run `jest-coverage`, `complexity` and `dependencies` once on the finished
  implementation. Do not reduce thresholds or add baselines to pass.
- Run independent code and product reviews; link lane evidence, lane agreement,
  product-fact changes and mock/running-UI acceptance in the implementation PR.
  Open the PR only after agreed local gates pass; CI must then be green.

## Durable documentation on shipment

When the corresponding boundary changes, update its owner in the same PR:

- `docs/product/planner.md`: cross-surface routine/use outcome decisions and
  the ordinary-plan boundaries highlighted above.
- `docs/specs/tech/session-planning-contract.md`: reusable intent, per-use
  provenance, lifecycle and retry/concurrency invariants.
- `docs/specs/05-data-model.md` and
  `docs/specs/tech/sync-v2-server-contract.md`: changed schema/sync scope.
- `docs/specs/ui/screen-map.md` and `navigation-contract.md`: changed screen
  responsibilities, entrypoints or params; the component catalog only if a
  reusable component's role/export changes.

Delete this card when its implementation ships. Evidence stays in the PR;
production code, tests and durable docs state their rules without citing it.
