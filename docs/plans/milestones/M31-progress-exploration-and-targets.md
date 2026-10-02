# M31 — Progress exploration and weekly muscle targets

- Status: `planned`
- Created: 2026-10-02; planning baseline `08e642a6` on `origin/main`
- Workstream: [#404](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/404)
- Acceptance reports: [#388](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/388), [#400](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/400), [#260](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/260)

## Objective

Let people explore and compare exercise and muscle history without losing their
analytics context. Add a consistent daily/weekly presentation preference and
user-defined weekly working-set targets per muscle, viewed over four weeks.

## Scope

- In: entity switching, comparison, shared period/selection state, daily/weekly
  presentation, weekly targets, the replacement of Progress's 30-day window with
  four weeks, configurable effort choices and the counting policy requested by
  #260, offline persistence, and accepted phone layouts.
- Out: prescribed workout planning, new strength/volume formulas, group targets
  or group rule changes, and a general analytics-platform rewrite. Any wider
  metric impact needs an explicit decision in T01.

## Requirements fixed by the workstream

### D1. One exploration context

Changing an entity must not require dismissing history and reopening another
entity. The design must state what happens to the selected period, bucket,
metric, comparison set and navigation state. Retain the existing session
drill-down and compatibility route unless the accepted design explicitly
changes their transitions.

### D2. Presentation and time range are separate concepts

Daily/weekly controls choose the presentation granularity. The four-week window
is the time range replacing 30 days in the relevant Progress views. A target is
expressed in working sets **per week per muscle**, not one quota for four weeks.
T01 decides the treatment of partial weeks and how the same preference applies
to single-entity, comparison and target views.

### D3. Raw history remains the source

Keep stored set effort, performance confirmation and entered load intact.
Targets and comparisons are derived from the existing graph/calculation
boundaries. Reuse the local facts where they contain sufficient information;
they currently aggregate working sets and cannot alone answer arbitrary effort
filters. Do not sync derived chart values or duplicate calculation formulas.

### D4. Explicit policy decisions precede implementation

The current data/UI contracts fix working sets as valid confirmed non-warm-up
sets and make selectable RIR a bundle policy. #260 requests user control of
both. T01 must resolve the counting scope, blank/unknown/high historical RIR
handling, logging choices and effects on existing metrics before changing these
contracts. It must also decide local versus account-synced persistence.

### D5. Design acceptance and integrated UI acceptance are separate gates

T01 pins an accepted target and UX contract before substantial UI code. T04–T06
render the relevant states on device and compare fresh captures to that target.
T07 obtains explicit human acceptance of the complete interaction before the
final suggested closeout suite. Material UI changes after acceptance return to
human review. No existing report is closed from implementation alone.

## Task breakdown

One card = one session = one local worktree = one PR, following the task
protocol in `docs/plans/README.md`. Merge this plan PR before starting T01.

| Task | Outcome | Depends on | Status |
| --- | --- | --- | --- |
| [M31-T01](../tasks/M31-T01-Design_and_contract.md) | Accepted exploration design and resolved metric/storage contracts | none | planned |
| [M31-T02](../tasks/M31-T02-Preferences_and_target_storage.md) | Persist preferences and weekly targets with the agreed ownership/lifecycle | T01 | planned |
| [M31-T03](../tasks/M31-T03-Analytics_and_exploration_state.md) | Four-week buckets, target evaluation and predictable exploration state | T02 | planned |
| [M31-T04](../tasks/M31-T04-Entity_exploration.md) | Switch entities inside history and preserve analytics context | T03 | planned |
| [M31-T05](../tasks/M31-T05-Comparison_views.md) | Compare compatible muscle/exercise series in the accepted phone layout | T04 | planned |
| [M31-T06](../tasks/M31-T06-Targets_and_effort_settings.md) | Configure targets/effort and apply daily/weekly presentation consistently | T04; T02/T03 provide its data | planned |
| [M31-T07](../tasks/M31-T07-Human_acceptance_and_closeout.md) | Human-accepted integrated UI, agreed gates, report verification and cleanup | T05, T06 | planned |

T05 and T06 can follow T04 independently; no implementation task is ready until
T01's decisions and target are accepted. Split T02 into additional cards if the
chosen sync contract exceeds one reviewable PR.

## Acceptance mapping

| Report / outcome | Implementation | Final verification |
| --- | --- | --- |
| #388: settings preference and consistent daily/weekly presentation | T02, T04–T06 | T07, including relaunch and cross-view changes |
| #400: switch and compare entities without leaving analytics | T03–T05 | T07, including retained period and comparison context |
| #260: weekly per-muscle targets, four-week view, effort controls | T01–T03, T06 | T07, including counts, partial weeks and saved configuration |
| Existing metrics, historical calculations and phone behavior | T01, T03–T06 | T07, against the accepted target and historical fixtures |

## Verification and execution constraints

- Add meaningful Jest coverage with each code task; read the owning test
  directory's README first. The current main branch uses
  `apps/mobile/__tests__/`, not the Expo Router `app/` tree.
- AGENTS.md requires `fast` and the three quality targets before code PRs;
  #404 postpones its suggested aggregate closeout until human UI acceptance.
  T01 must obtain an explicit operator agreement on how preparatory PR checks
  and the staged UI reviews satisfy both. This plan grants no test exemption.
- At each execution, use `./boga test for` and agree any lanes beyond `fast`
  with the operator. Reuse existing Progress Maestro flows; new scenarios need
  a device-only justification and operator approval.
- T07 runs the final selector only after human acceptance, then the agreed
  suite. Expect `fast` + `frontend-ui` and `jest-coverage`, `complexity`,
  `dependencies`; add local backend/sync lanes if T02 changes those contracts.
  Run `./boga doctor` before declaring any required gate unavailable.
- Keep evidence in the PRs. Update the owning specs with shipped decisions;
  code/specs must never cite this milestone or its card paths. Completing PRs
  delete their cards; the last PR deletes this milestone.

## Risks and decisions owned by T01

1. Pin the accepted visual source, comparison presentation, selection limit,
   metric compatibility and compact/expanded states; no design is approved yet.
2. Choose four calendar weeks versus a trailing 28-day window, inclusion of the
   current partial week, date attribution and historical heatmap alignment.
   `src/utils/local-calendar.ts` is the existing local Monday-week boundary;
   timestamps stay UTC. Report any conflict before changing historical buckets.
3. Distinguish target effort filtering from a global working-set definition;
   inventory affected facts, Today, history, session insights, agent API and
   group readers before approving a wider change. Check concurrent changes in
   these readers against current main at execution; other plans are not
   authority and are not implicitly loaded by this plan.
4. Decide whether preferences/targets survive account changes, reinstall and
   multiple devices, then choose the smallest storage/sync contract that meets
   that decision. If synced, specify defaults, validation, migration, LWW,
   tombstones, account wipe/restore and protocol compatibility.
5. Define target edits: retrospective reinterpretation or effective dates,
   unset versus zero targets, untrained muscles and family totals without
   double-counting physical sets.
