# M36-T01-RM_curve_and_effort_contract — Reconstruct the RM curve and agree effort/reference contracts

- Status: `planned`
- Depends on: none
- Milestone: `docs/plans/milestones/M36-rm-performance-curve-analytics.md`
- Areas: docs; UI impact: no

- GitHub issue: [714](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/714)
- Workstream: [#709](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/709)

## Objective

Reconstruct the reps–load relationship from BoGa’s existing estimator and load kernel. Propose a reproducible observation population, effort filtering and reference-estimation contract for research and the first chart, with product-owner approval before production choices become fixed.

## Scope

- In: Formula inversion/parity, comparable effort, historical versus current reference, load coordinates and residual definitions.
- Out: New RM formula, RIR-adjusted rep counts, changes to eligibility/records/loading conventions, production UI.

## Decided

Milestone D1–D5 govern this task. This is planning only; no design, analytical selection or test-lane proposal is approved by creating the card. One card = one session = one local worktree = one PR under the task protocol. Merge the planning PR before execution.

## Open — resolve with the user at session start

Effort defaults and missing/unknown/high historical RIR treatment; fixed historical baseline versus current estimate; reference estimator/window/cutoff; minimum support and rep domain; bodyweight-aware axis/cohort/reference projection; gym comparability.

## Deliverables and acceptance

1. Trace `estimateOneRepMax`, `calculateSetMetrics`, `resolveCalculatedLoad`, `isWorkingSet`, `getSessionSetRir` and personal effort context to the current facts. Explain that effort affects eligibility, not the estimator’s reps; do not silently substitute reps + RIR.
2. Reconstruct/invert the adopted estimator, including its single-rep special case, zero and invalid inputs. Establish round-trip parity through existing functions/vectors; do not copy Wathan constants into another production implementation.
3. Compare strict RIR cohorts and ranges, and missing/unknown-label inclusion/exclusion as sensitivity analyses. Keep recorded labels and existing working-set policy intact; do not infer unspecified effort is RIR 0.
4. Compare historical fixed, rolling/current and existing all-time estimates for the reference. Specify population, estimator, cutoff, refresh and fallback, avoiding a point’s own estimated RM as its reference and leakage from later observations into historical evaluation.
5. Define signed load residuals and percentage-normalised residuals on one comparable load scale, units, reference denominator and undefined/zero handling. Distinguish prediction error from measurement and effort uncertainty.
6. Specify ordinary/per-side/bodyweight cases using current metadata, dated readings and the personal fallback. Resolve how a single overlay can represent observations with different bodyweight contexts without redefining entered Weight or displayed 1RM.
7. Document assumptions, high-rep extrapolation limits, rep-range effects and candidate choices; obtain product-owner approval of the first-release analytical contract. Any uncovered observable rule needs an approved product fact before implementation.

## Specs to update

`docs/specs/tech/training-metrics-contract.md` and `docs/specs/tech/bodyweight-load-contract.md` only for approved extensions; `docs/product/` for newly approved observable rules. Preserve existing facts.

## Gates

Formula reconstruction checks against existing calculation vectors and singles/zero/bodyweight cases; effort-cohort and cutoff examples. Research examples are not claims of production statistical validity.

Expected gates are proposals, not approval. Run `./boga test for` on the actual diff and agree every lane beyond `fast` with the operator. Every code PR adds/updates focused Jest coverage and passes `./boga test fast`; run `jest-coverage`, `complexity` and `dependencies` once on the finished PR. Read the owning test directory README first. Docs-only work proposes `docs-check`; any exemption from the normal gates needs explicit operator agreement. Record results and artifacts in the PR, not this card. Run `./boga doctor` before claiming a lane cannot run.
