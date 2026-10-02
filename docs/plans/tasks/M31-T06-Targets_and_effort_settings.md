# M31-T06 — Configure weekly muscle targets and Progress/effort preferences

- Status: `planned`
- Depends on: `M31-T04-Entity_exploration` (T02/T03 supply storage and evaluation)
- Milestone: `docs/plans/milestones/M31-progress-exploration-and-targets.md`
- Areas: frontend / settings / effort logging; UI impact: yes

## Objective

Expose the accepted weekly target and effort settings through real UI, and show
target attainment within the four-week Progress model. Make the daily/weekly
preference apply consistently across the relevant views.

## Scope and decided requirements

Milestone D2–D5 apply. Use T02's repository boundary and T03's evaluation;
never implement a second target count in a component. The effort picker/cycle
changes only to the extent explicitly accepted in T01. Historical stored effort
and raw set values remain intact.

## Open — resolve at session start

Confirm the accepted settings location, target editor layout and effort-choice
model against current main. Recheck how preference changes invalidate mounted
views and derived facts, and whether logging choices affect prescribed rows.

## Deliverables and acceptance

1. Settings can save daily/weekly presentation, allowed effort choices and the
   accepted target-counting policy. Relevant mounted Progress views use the new
   settings immediately and relaunch/restore follows T02's ownership contract.
2. Users can set/edit/clear a weekly target per muscle. Target feedback shows
   weekly counts over four weeks with explicit unset/zero/partial-week behavior;
   family summaries follow the accepted aggregation rule.
3. Validation and persistence failures keep edits recoverable and prior valid
   values intact. Untrained/renamed/deleted muscles and long names behave as
   specified, including the compact layout and accessible labels.
4. Accepted effort controls appear in set logging. Stored out-of-range effort,
   blank/unrecognised values and prescribed sets follow T01's explicit policy;
   reducing choices never rewrites historical source data.
5. Jest proves preference propagation, target editing/errors, read counts and
   changed logging behavior. Capture implemented target/settings/logging states
   against the design and present them for staged human review.
6. Delete this card and mark T06 completed in the milestone in this PR.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Configure | Open Settings; choose granularity and effort policy; save | All relevant views and logging choices use accepted saved policy | Invalid choices/save failure explain recovery and keep previous valid data |
| Set a target | Select muscle; enter weekly quota; save; inspect four weeks | Count and quota use the accepted weekly/effort rules | Unset/zero target and partial/empty weeks have explicit wording |
| Revisit history | Change policy or target; revisit old data | Projection changes only as T01 permits | Stored effort outside current picker choices remains preserved/readable |

## Touchpoints, specs and gates

Start at `app/(tabs)/settings.tsx`, Progress components, `src/config/training.ts`,
`src/data/set-types.ts` and the existing effort controls in session logging.
Update UI screen/navigation/semantic docs and data contracts for changed behavior.
Read test READMEs first. Follow T01's review policy; pass Jest/`fast` and quality
targets before the PR. Propose relevant Progress and exercise-page device lanes
and any backend/sync lanes the actual diff requires. Final acceptance is T07.
