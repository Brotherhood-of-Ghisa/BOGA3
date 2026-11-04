# T-20261104-01 — Hide completed plans in Sessions

- Status: `planned`
- Depends on: none
- Milestone: none
- Areas: frontend; UI impact: yes

## Objective

Keep the Sessions planning queues focused on unfinished work by hiding completed
scheduled and unscheduled plans by default. Let the user reveal them from the
existing options sheet while retaining the performed workout history below.

## Scope

- In: Upcoming and Unscheduled plan visibility, fully completed programme rows,
  one options-sheet switch, visible-list empty states, real-data Jest coverage
  and native visual evidence.
- Out: workout history filtering, programme-detail child-list filtering, block
  lifecycle changes, new persistence/preferences, shared query filtering,
  schema/sync/backend changes, dependencies and new Maestro flows.

## Decided

- **Product decision to ship:** completed plans are hidden by default in both
  planning queues, including scheduled programme-child plans. Fully completed
  programmes are also hidden; partially completed programmes remain visible.
- Use the existing derived `progress === 'completed'` on plan/programme
  summaries. Do not infer completion from the schedule or from finishing any
  single workout. Keep [[planner.block-completion]] and the existing aggregate
  progress calculation unchanged, including its all-skipped completion case.
- Add **Show completed plans**, initially off, directly above **Show deleted
  sessions** in the header options sheet. Reuse the existing `SwitchRow`
  pattern and native switch behavior, spacing, typography and accessibility.
- Enabling it restores completed planning rows in their existing sections and
  order; disabling it hides them again. Keep the value while this screen is
  mounted, including sheet dismissal; a new mount starts off, matching the
  existing deleted-session option's lifetime.
- Completed workout history, its week/day entry links and its deleted-session
  option keep their existing behavior. Neither toggle changes the other.
- Filter the summaries locally in `apps/mobile/app/sessions.tsx`; leave the
  shared queries used by Today and the available-block picker exhaustive.
  Compute planning emptiness from the visible arrays. Empty sections disappear;
  the authoring actions and options button remain available.

## Open — resolve at session start

No product questions remain in this proposed scope. Recheck these assumptions
against current main before building; report drift instead of broadening the
change. Select any reduction from the default device lanes with the reviewer
agent after inspecting the implementation diff.

## Design target and appearance

The operator's two reference screenshots show the current Sessions list and
its existing one-row options sheet. The repo-native target is that same screen
and sheet with one additional, identically styled switch row immediately above
Show deleted sessions. This brief is sufficient if the original attachments
are unavailable; the production `Sheet` and `SwitchRow` govern the pattern.
No new UI family or derivative is required. Capture the relevant reference and
comparison screenshots under the gitignored mobile artifacts tree during
execution and link the evidence from the implementation PR.

## Deliverables and acceptance

1. With both switches off, completed scheduled plans, completed unscheduled
   plans and fully completed programmes are absent. Planned and in-progress
   rows, including a partially completed programme, remain visible.
2. Turning Show completed plans on and off updates the planning lists
   immediately without a new database read, write or history reload. Restored
   rows preserve the current schedule/recency ordering and navigation targets.
3. Retain the existing derived-progress edge cases: all-skipped plans count as
   completed; an empty plan/programme or any summary with pending/attached
   blocks is not hidden merely because no next block is materializable.
4. Completing a plan elsewhere and returning to Sessions refreshes its summary
   through the existing focus reload and applies the current switch value.
5. Empty planning sections and the global empty state reflect visible rows.
   The user can always reopen options and reveal hidden completed plans.
   Existing loading and error states keep their behavior.
6. Extend `apps/mobile/__tests__/sessions-screen.test.tsx` over real migrated
   SQLite, following its directory README. Cover both queues, scheduled
   programme children, full/partial programmes, progress edge cases, toggle
   reversal and lifetime, focus reload, ordering/navigation, empty states,
   accessibility checked state and independence from deleted workout history.
7. Compare native screenshots of the default and revealed lists and the
   two-switch sheet against the target; verify the added row fits on a small
   phone and retains accessible switch labels/states.
8. Update the owning screen documentation, obtain the required code/product
   reviews, and delete this card in the implementation PR. Gate and screenshot
   evidence belongs in that PR, not this card.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Browse unfinished plans | Open Sessions; read Upcoming and Unscheduled | Only unfinished plans/programmes appear; workout history remains available | All planning rows hidden: omit empty sections, retain authoring actions and options; preserve loading/error states |
| Reveal completed plans | Open header options; enable Show completed plans; dismiss; reopen and disable | Completed rows return in their original order, open their existing detail routes, then hide again | With no completed plans, the lists stay the same; a new screen mount resets the switch |
| Return after completion | Finish planned work elsewhere; navigate back to Sessions | Focus reload derives current progress and applies the selected visibility | A partially resolved plan/programme stays visible; read failure retains the existing error behavior |
| Inspect deleted workouts | Independently toggle Show deleted sessions | Existing deleted-history visibility works for either completed-plan switch value | Showing completed plans does not reveal deleted plans or change history counts |

## Specs to update

- `docs/specs/ui/screen-map.md` — Sessions' default planning visibility and new
  options-sheet control.
- `apps/mobile/app/sessions.tsx` screen comment and its Jest tests — durable
  ownership of this screen-specific behavior.
- Product-change disclosure: highlight the planned visibility decision in the
  implementation PR's Product facts line. `docs/product/planner.md` remains the
  owner of [[planner.block-completion]], which is unchanged. Apply the fact
  criteria in `docs/procedures/product-facts-authoring.md` before adding a new
  fact: screen-specific behavior recoverable from this screen and its tests
  belongs there rather than in a cross-cutting fact.

## Gates

- Run `./boga test for` on the implementation diff. Expected path defaults:
  `./boga test fast` plus `./boga test frontend-ui` on macOS, or
  `./boga test frontend-android` on Linux.
- Agree the smallest relevant existing device-lane set with the reviewer agent
  before running lanes beyond fast. A `covered-by-jest` reduction must name the
  real-data tests proving this filter has no device-only behavior; capture the
  native visual states regardless. Do not add a Maestro scenario without the
  required written justification.
- Run `./boga test jest-coverage`, `./boga test complexity` and
  `./boga test dependencies` on the finished implementation; retain all existing
  thresholds and baselines.
- This planning PR changes only this card: select `./boga test docs-check` with
  the reviewer under the `docs-only` category; no implementation gates are
  claimed by the plan.
