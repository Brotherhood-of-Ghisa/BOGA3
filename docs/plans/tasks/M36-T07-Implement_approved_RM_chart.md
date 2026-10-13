# M36-T07-Implement_approved_RM_chart — Implement the approved interactive chart without UI exposure

- Status: `planned`
- Depends on: M36-T06
- Milestone: `docs/plans/milestones/M36-rm-performance-curve-analytics.md`
- Areas: frontend; UI impact: yes

- Workstream: 4 — Implementation and validation

## Objective

Build the approved chart and page content as reusable components over T06’s read model. Keep it absent from production routes and navigation until the final exposure task.

## Scope

- In: Scatter/curve rendering, recency, filters, point selection/readout, state handling and accessibility.
- Out: New app route/root-stack registration/production entry links, breakpoint UI, changing workout logging or existing analytics.

## Decided

Milestone D1–D6 govern this task. This is planning only; no design, analytical selection or test-lane proposal is approved by creating the card. One card = one session = one local worktree = one PR under the task protocol. Merge the planning PR before execution.

## Open — resolve with the user at session start

Final component seam and development preview for human review without committing a production route; precise overlap hit testing and accessibility ordering.

## Deliverables and acceptance

1. Implement T05’s accepted UX target with existing UI tokens/primitives and SVG conventions, using explicitly RIR0-equivalent reps on X and approved load on Y. Show observed qualifying sets and the reference curve with the approved recency encoding.
2. Implement actual reps, recorded RIR and equivalent-reps point details without relabelling global displayed 1RM; exercise/time/effort filters, deterministic coincident-point access and selection clearing/preservation per the approved contract.
3. Handle missing effort, no observations, insufficient/no reference, read error/retry, unavailable exercise and large histories without misleading values or fabricated curves.
4. Provide non-colour selection/recency cues, accessible observation values and usable small/large phone layouts. Keep existing numeric/date formats and screen copy facts.
5. Add component interaction/state/geometry coverage, with success and failure/offline cases as applicable. Render via an isolated developer preview for fresh screenshots against the target; do not add a file under `app/`, root-stack registration or a user-facing entry.
6. Present the implemented states for human review and incorporate feedback. Material design changes renew T05 approval before UI acceptance testing; keep research statistics out of the production component.

7. Render the shared weekly wave prefix outputs from the existing oracle and verify point positions, recency/readouts, overlap access and insufficient-baseline presentation. Stable lower-rep/heavier-load weeks must not be styled or described as strength gain. Reuse T06’s numerical evidence; this task proves rendering/interactions, not another model fit or reference calculation.

## UX contract (proposed; T05 pins the approved target)

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Inspect/filter | Use approved filters and select any observation | Exact readout matches T06 and scatter/reference stay aligned | Overlap/missing effort/empty/no-reference and retry match target |
| Preview for review | Render component using developer-only isolated preview | Human can review all approved states | No production route, root-stack registration or entry link |

## Specs to update

`docs/specs/ui/components-catalog.md` when adding a canonical feature component; component header/tests own screen behavior. Shared UX changes go to their one owner; no route docs until T09.

## Gates

Focused Jest component/geometry/interaction checks plus screenshot comparison to T05. `fast` + quality lanes before PR. UI path defaults propose `frontend-ui`, lowered to relevant lanes only with operator agreement and human approval before acceptance runs; no new Maestro scenario without approved device-only reason.

The shared wave adds only rendering/selection/state checks against the inherited oracle and target; no duplicate extraction or statistical suite.

Expected gates are proposals, not approval. Run `./boga test for` on the actual diff and agree every lane beyond `fast` with the operator. Every code PR adds/updates focused Jest coverage and passes `./boga test fast`; run `jest-coverage`, `complexity` and `dependencies` once on the finished PR. Read the owning test directory README first. Docs-only work proposes `docs-check`; any exemption from the normal gates needs explicit operator agreement. Record results and artifacts in the PR, not this card. Run `./boga doctor` before claiming a lane cannot run.
