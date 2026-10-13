# M36-T08-Validate_chart_before_exposure — Validate the integrated chart and obtain human UI acceptance

- Status: `planned`
- Depends on: M36-T07
- Milestone: `docs/plans/milestones/M36-rm-performance-curve-analytics.md`
- Areas: frontend; UI impact: yes

- Workstream: 4 — Implementation and validation

## Objective

Validate the complete chart content over representative workout histories before exposing it to users. Obtain human hands-on acceptance before the agreed UI acceptance suite and resolve any material findings.

## Scope

- In: Integrated component over real SQLite, fixture matrix, human acceptance and focused device evidence.
- Out: Production navigation exposure, statistical detection features or repeated unrelated full-suite runs.

## Decided

Milestone D1–D5 govern this task. This is planning only; no design, analytical selection or test-lane proposal is approved by creating the card. One card = one session = one local worktree = one PR under the task protocol. Merge the planning PR before execution.

## Open — resolve with the user at session start

Operator-approved device acceptance lane set and preview method; need for any gesture/VoiceOver scenario that Jest cannot prove.

## Deliverables and acceptance

1. Confirm T05’s explicit design approval is recorded before any UI acceptance run. Present the integrated content to the human, incorporate feedback and record hands-on UI acceptance before the agreed final UI acceptance suite.
2. Exercise representative dense/sparse histories, missing/unknown/high RIR, repeated and coincident sets, zeros/invalid/planned/deleted rows, gym variation, ordinary/per-side/bodyweight contexts and filters that remove the reference population.
3. Use screens/components over real migrated SQLite for read/filter/reference/refresh regression coverage, including stale in-flight reads, error/retry and local/offline history. Reconcile plot and readout with the approved reference/load oracle.
4. Verify touch/overlap selection, accessibility, legend meaning and small/large-phone states in the running app, comparing fresh screenshots with T05’s target. No structural-break markers or significance claims may be present.
5. Agree the minimal device lane/scenario set after `./boga test for`; an added Maestro scenario requires explicit operator approval and a device-only justification. Plan device checks together with T09 and repeat only for changed device behavior.
6. Record acceptance and evidence in the PR, resolve failures to green and renew human review after material UI changes. No production entry, app route or root-stack registration is introduced here.

## UX contract (proposed; T05 pins the approved target)

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Review chart | Human exercises all T05 flows and edge states in isolated preview | Explicit accepted UI and recorded screenshot comparison | Feedback fixed; material changes require renewed review |
| Acceptance run | After human approvals, run agreed chart/device checks | Chart values, gestures and accessible observations hold | Failure blocks T09; no new production navigation |

## Specs to update

Approved behavior belongs in component headers/tests and product facts; update shared UX docs only if it changes a shared rule.

## Gates

Focused real-data integration/regression Jest plus approved chart-only device checks after human design and hands-on acceptance. Run mandatory PR fast/quality checks once on the finished diff; UI exposure gets its distinct navigation check in T09.

Expected gates are proposals, not approval. Run `./boga test for` on the actual diff and agree every lane beyond `fast` with the operator. Every code PR adds/updates focused Jest coverage and passes `./boga test fast`; run `jest-coverage`, `complexity` and `dependencies` once on the finished PR. Read the owning test directory README first. Docs-only work proposes `docs-check`; any exemption from the normal gates needs explicit operator agreement. Record results and artifacts in the PR, not this card. Run `./boga doctor` before claiming a lane cannot run.
