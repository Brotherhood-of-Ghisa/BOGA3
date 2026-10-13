# M36-T09-Expose_RM_analytics_and_closeout — Expose exercise RM analytics through existing navigation — final implementation step

- Status: `planned`
- Depends on: M36-T08
- Milestone: `docs/plans/milestones/M36-rm-performance-curve-analytics.md`
- Areas: frontend; UI impact: yes

- Workstream: 5 — Final UI exposure

## Objective

As the milestone’s final implementation step, expose the validated analytics page from the current selected-exercise UI. Preserve existing workout logging/history flows, prove navigation behavior and close the milestone only after human review and green agreed gates.

## Scope

- In: Expo Router page, typed route helper/root-stack registration as needed, approved entry, return behavior and final closeout.
- Out: Further feature work, alternate entry models, logging changes, breakpoint detection or unapproved metric/design decisions.

## Decided

Milestone D1–D5 govern this task. This is planning only; no design, analytical selection or test-lane proposal is approved by creating the card. One card = one session = one local worktree = one PR under the task protocol. Merge the planning PR before execution.

## Open — resolve with the user at session start

Confirm T05’s approved entry against current main and related exercise-presentation/gym work; agree exact navigation/device lane set and aggregate changed-path coverage.

## Deliverables and acceptance

1. Before wiring access, confirm T01–T08 are completed, merged and reviewed; analytical/product and human design/UI approvals are recorded. No other feature implementation remains after this task.
2. Add the production page/route helper and register it through current Expo Router/navigation patterns only now; expose T05’s approved entry for the selected exercise using its canonical ID.
3. Preserve exercise/time context and Back behavior; handle invalid/missing/deleted exercise IDs and safe error/retry states. Existing Progress/session drill-down and active workout drafts/logging remain usable.
4. Add focused route/entry/return regression tests over real data and native navigation checks. Reuse T08’s chart evidence on unchanged behavior; test the newly wired path and any affected logging/history transitions.
5. Obtain human review of the exposed entry/return flow before UI acceptance tests; renew approval for material UI changes. Run `./boga test for` both for this diff and the milestone’s cumulative changed paths, agree the minimum lanes, and complete all agreed checks to green.
6. If root-stack/root access/harness changes occur, propose `fast` + `frontend`; otherwise default UI proposal is `fast` + `frontend-ui` and area lanes, narrowed by agreement. Add backend/ios-sync-e2e only if actual scope introduces corresponding risk. No sweep unless a release or operator request.
7. Meet milestone DoD, graduate durable decisions to their owners, delete this last card and the milestone spec in the shipping PR, link evidence and complete the repository planning lifecycle after merge. Shut down/release the worktree per AGENTS.md; do not merge without user authorization.

## UX contract (proposed; T05 pins the approved target)

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Open selected exercise analytics | Use approved entry on current selected exercise | Validated chart opens for correct canonical ID/context | Invalid/deleted ID has safe approved state |
| Return to prior workflow | Back from chart, including during an active workout | Prior navigation/context/draft remains intact | No duplicate route or lost workout input |
| Final acceptance | Human reviews entry/return, then agreed UI suite runs | All DoD evidence green and linked | Material fixes return to human review |

## Specs to update

`docs/specs/ui/screen-map.md` for the route; `navigation-contract.md` for entry/params/return/access; product facts for newly approved visible choices. Remove ephemeral milestone/card after work ships.

## Gates

Navigation Jest, existing native exercise/history/logging flows as relevant, approved final changed-path lanes and three quality targets. All new Maestro coverage needs prior approval. No repeated full backend/feature suites for unchanged chart code.

Expected gates are proposals, not approval. Run `./boga test for` on the actual diff and agree every lane beyond `fast` with the operator. Every code PR adds/updates focused Jest coverage and passes `./boga test fast`; run `jest-coverage`, `complexity` and `dependencies` once on the finished PR. Read the owning test directory README first. Docs-only work proposes `docs-check`; any exemption from the normal gates needs explicit operator agreement. Record results and artifacts in the PR, not this card. Run `./boga doctor` before claiming a lane cannot run.
