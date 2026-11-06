# T-20261106-01 — Routines: reuse any planned session anytime

- Status: `planned`
- Depends on: none; refresh assumptions against current `origin/main` before execution.
- Milestone: none; one cross-stack implementation PR using the task protocol.
- Areas: frontend, backend, sync; UI impact: yes.

## Objective

Let a lifter keep any planned session as a Routine and start it whenever they
want. Finishing or skipping one use leaves the Routine visible and available;
each later use starts with fresh progress. Show the date of the latest
completion or skip, and obtain explicit human acceptance of a mock design
before implementing the UI.

## Scope

- In: an Edit action to make any existing plan a Routine; an authoring choice
  for new plans; the Sessions **Routines** section; routine detail, Start/Resume,
  explicit Skip, outcome dates, safe future edits, persistence and sync.
- In: conversion of scheduled/unscheduled, human/agent-authored, standalone and
  programme-child plans, including unused, active/attached, partially consumed,
  completed and entirely skipped plans. Existing consumption locks must not
  prevent changing routine availability.
- Out: weekly/calendar recurrence, interval scheduling, reminders, automatic
  missed/skip events, backlog generation, programme looping, automatic target
  progression, and new coaching-agent write capabilities.
- This card prepares the implementation; it does not author the mock or ship
  production UI in the planning PR. Delete it in the implementation PR.

## Decided with the operator

1. The section is called **Routines**. The first version is **Anytime**, with
   no due date or repeat calendar. Ordinary plans retain their existing use.
2. Any live plan can be made a Routine through **Edit**, without requiring the
   lifter to Duplicate it, recreate its blocks or discard prior progress.
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

## Open — settle at session start, before production coding

- Choose the smallest execution/provenance model that allows repeated starts
  while keeping historical rows immutable. Decide whether separate use records
  or isolated plan snapshots best fit the existing sync contract; do not reset
  shared consumed blocks or weaken uniqueness globally.
- Define conversion of an already scheduled plan and a programme child. Every
  case above must support Edit conversion; decide presentation and membership
  explicitly. Future routine starts must not rewind or repeatedly advance the
  original programme, or appear as calendar commitments in Today. Avoid duplicate
  routine rows in Sessions.
- Define whether historical source uses seed Last completed/Last skipped on
  conversion, using recoverable timestamps only. No invented outcome dates.
- Define the zero-confirmed-work Finish result using existing recorder rules;
  it must not award a completion for merely starting, or turn an abandoned
  workout into a skip. The agreed partial-work example has performed work.
- Agree removing routine availability through Edit, with history preserved;
  prefer existing controls over adding an archive subsystem. Specify what
  happens to an active use and ordinary-plan visibility.
- Agree date correction/deletion/Undo semantics and offline conflict handling,
  including Start racing Skip and retrying the same action on two devices.
- Select the UI composition and have the human accept the mock below. These
  choices may refine presentation but must not remove conversion or restore
  carry-over requirements for partial use.

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
| Make a Routine | Open any plan, Edit, enable routine availability, Save. | Same authored plan becomes available in Routines; prior progress/history survives. | Cancel writes nothing; save failure retains input and offers retry. Attached/completed/skipped blocks do not disable conversion. |
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
- Jest covers the conversion matrix, full and partial uses, a second fresh use,
  explicit Skip, date ordering, resume/abandon, future edits, guarded failures,
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
