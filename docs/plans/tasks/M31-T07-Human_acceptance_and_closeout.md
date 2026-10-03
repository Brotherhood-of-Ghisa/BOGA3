# M31-T07 — Accept the complete UI and close the Progress workstream

- Status: `planned`
- Depends on: `M31-T05-Comparison_views`, `M31-T06-Targets_and_effort_settings`
- Milestone: `docs/plans/milestones/M31-progress-exploration-and-targets.md`
- Areas: frontend / integration / verification; UI impact: yes

## Objective

Have the human exercise the integrated Progress UI, incorporate feedback, then
run the agreed closeout gates and verify each grouped report. This task is the
product acceptance and final evidence boundary for #404.

## Deliverables and acceptance

1. Prepare a usable on-device build and representative history/targets. Present
   the accepted flows: switch entities, compare multiple series, change
   range/granularity, configure effort, edit weekly targets and return from a
   session. Include long histories, untrained entities and small phone states.
2. Record explicit human acceptance after feedback is incorporated. Capture
   every relevant accepted state and compare with the pinned target. Material
   UI changes after acceptance require another human review.
3. **Only after acceptance**, run `./boga test for --diff origin/main...HEAD`
   and evaluate the combined changes from the completed task PRs as well; this
   final integration PR's small diff cannot hide earlier workstream areas.
   Agree the final suite with the operator. Expected: `fast`, `frontend-ui`,
   `jest-coverage`, `complexity`, `dependencies`; add the appropriate local
   backend/sync lanes if persisted or shared calculation contracts changed.
4. Run the agreed set to green, retaining per-PR evidence and final artifact
   links. Reuse Maestro flows; any added scenario needs a device-only rationale
   and operator approval. Run `./boga doctor` and fix bootstrap gaps before
   claiming a gate unavailable; use `./boga timings` for measured durations.
5. Verify #388, #400 and #260 separately against the milestone mapping; record
   results and deviations in the PR. Check historical parity outside the
   explicit effort/time-window changes and preference/target restore behavior
   under the chosen persistence contract. Any regression becomes a concrete fix.
6. Update owning specs/UI inventories with the final behavior and confirm there
   are no code/spec references to planning paths or IDs. Delete this card and the
   milestone in the final PR; evidence remains in PRs and accepted target records.
7. After user review/merge, verify shipped report acceptance before closing
   #388/#400/#260 and #404. Do not merge a PR without the user's instruction.
   Stop the slot stack on PR opening and release the owned worktree on merge.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Complete exploration | Exercise T01's accepted flows end to end on device | Human accepts the design and interaction; all grouped reports are proven | Feedback is fixed and materially changed UI is reviewed again |
| Restore | Relaunch and perform the accepted account/device restore journey | Configuration/history follow the accepted ownership contract | Errors remain visible and never imply that unsaved targets were saved |

## Specs and gates

Load the accepted target, current owning specs and test READMEs. Update only the
durable docs affected by final changes. The lane list above is a proposal until
agreed for the actual final diff; this task grants no bypass of AGENTS.md.
