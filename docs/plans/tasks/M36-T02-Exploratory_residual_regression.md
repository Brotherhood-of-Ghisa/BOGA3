# M36-T02-Exploratory_residual_regression — Specify exploratory residual regression and break reliability

- Status: `in_progress` — research delivered for review; gates and human analytical approval pending
- Depends on: M36-T01
- Milestone: `docs/plans/milestones/M36-rm-performance-curve-analytics.md`
- Areas: docs; UI impact: no

- Workstream: 1 — Analytical research and modelling

## Objective

Develop a research-only regression framework for residuals over time. Compare progressive strength trends with candidate structural breaks and state when the data cannot support either inference.

## Scope

- In: Trend models, segmented linear regression, unknown breakpoint estimation, uncertainty and model comparison.
- Out: Production breakpoint detector, alerts, significance badges or strength-change diagnosis.

## Decided

Milestone D1–D6 govern this task. This is planning only; no design, analytical selection or test-lane proposal is approved by creating the card. One card = one session = one local worktree = one PR under the task protocol. Merge the planning PR before execution.

On 2026-10-13 the owner authorized experimental branch continuation without first merging T01 into main. This task's worktree/branch `m36-t02-residual-regression` starts at reviewed T01 commit `43482cd7de537dfce0982acfdbc8b8ab8b109bab`; a future draft PR targets `m36-t01-rm-curve-contract`. The research specification and checks preserve the full acceptance scope and propose a feasibility checkpoint; neither the delivered work nor a finished agent declares task completion. Preserve human analytical review and agree gates before running them; no main integration is authorized by this exception.

## Open — resolve with the user at session start

Candidate choices and their limitations are documented in [the research specification and validation plan](../research/M36-T02-residual-regression-method.md): session-median response, constant/linear/smooth versus separate one-hinge/one-jump models, minimum segment8 with6/10 sensitivities, complete-search calibration and model-specific uncertainty validation. The owner requested both configurable assumed RIR measurement SD (initial1rep) and joint RM/SD estimation candidates. Human analytical review approves the final validation plan; these remain research choices, with no production default or calibrated error claim.

## Deliverables and acceptance

1. Specify null/no-trend, smooth/linear trend and segmented alternatives; distinguish slope changes from level shifts. State time scale, rep-range terms/interactions, effort covariates and baseline coupling.
2. Investigate breakpoint search and boundary/minimum-segment constraints, model comparison and penalties, breakpoint intervals, effect-size uncertainty and multiple-search bias; justify methods with primary statistical sources.
3. Account for correlated sets within a session using session-level aggregation, clustered/hierarchical inference or session-level resampling; prevent pseudoreplication by counting sets as independent sessions.
4. Address sparse/irregular histories, gaps, heteroskedasticity, outliers, autocorrelation, changing actual/equivalent rep composition, RIR reporting error, progressive trends and high-rep estimator limitations.
5. Predefine validation scenarios, false-positive/power/coverage reporting and an insufficient-evidence outcome. A visible shift is not proof of a statistically significant break.
6. Provide reproducible research-only model specifications/experiments and assumptions/limitations, isolated from mobile runtime, sync and production dependencies. Human analytical review approves the validation plan, without treating exploratory results as a release feature.

7. Specify the milestone’s shared weekly wave validation: one individual/gym and known recorded RIR varying by phase; primary plateau/repeated-exposure inputs (same load/reps, RIR1→2→3, then higher load returning to RIR1), separate stable/smooth methodological controls, session dependence, weekly prefixes without later-data leakage and insufficient baseline support. Predefine what the models should distinguish; exact programme parameters and extra weekly fitted-curve UI remain pending clarification.

## Specs to update

Retain findings with the research PR and milestone; graduate only approved durable analytical assumptions to their owning technical contract. Do not add a production statistical contract.

## Gates

Seeded method checks, sensitivity plan and session-aware resampling examples; empirical and synthetic reliability evidence is completed by T04.

The shared wave proof is a validation specification/session-aware method check; reuse existing formula parity rather than repeat it.

Expected gates are proposals, not approval. Run `./boga test for` on the actual diff and agree every lane beyond `fast` with the operator. Every code PR adds/updates focused Jest coverage and passes `./boga test fast`; run `jest-coverage`, `complexity` and `dependencies` once on the finished PR. Read the owning test directory README first. Docs-only work proposes `docs-check`; any exemption from the normal gates needs explicit operator agreement. Record results and artifacts in the PR, not this card. Run `./boga doctor` before claiming a lane cannot run.
