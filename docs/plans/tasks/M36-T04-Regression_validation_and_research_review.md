# M36-T04-Regression_validation_and_research_review — Validate regression with known behaviours and approve research findings

- Status: `planned`
- Depends on: M36-T03
- Milestone: `docs/plans/milestones/M36-rm-performance-curve-analytics.md`
- Areas: docs; UI impact: no

- GitHub issue: [717](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/717)
- Workstream: [#710](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/710)

## Objective

Validate the exploratory framework against known synthetic behaviours and available historical data. Close research with an honest reliability assessment and an agreed first-release chart contract.

## Scope

- In: Synthetic ground truth, empirical trend/break exploration, sensitivity and human research review.
- Out: Shipping structural break detection or interpreting an apparent shift as established significance.

## Decided

Milestone D1–D5 govern this task. This is planning only; no design, analytical selection or test-lane proposal is approved by creating the card. One card = one session = one local worktree = one PR under the task protocol. Merge the planning PR before execution.

## Open — resolve with the user at session start

Reliability thresholds, usable sample sizes and scope of supported claims; whether the empirical findings require changing the reference/effort contract.

## Deliverables and acceptance

1. Generate seeded independent scenarios for stable strength, gradual improvement, slope change, abrupt level change, no break with changing rep/effort mix, sparse sessions, long gaps, noise/outliers and within-session dependence.
2. Measure false positives under no-break/progressive scenarios, sensitivity/power across effect sizes and independent-session counts, breakpoint localization and uncertainty coverage across repeated simulations. Keep known ground truth separate from fitted output.
3. Evaluate model comparison, searched-break selection bias and session-aware resampling against T02’s plan. Include unreliable/inconclusive examples and sensitivity to reference window, effort filtering and rep distribution.
4. On suitable historical observations, compare gradual-change and segmented explanations; label findings exploratory. Report effect sizes, uncertainty and sample limitations instead of inferring significance from a plot.
5. Record failures, adjustments and evidence. Human analytical/product review approves the reference, effort and load-coordinate contract and honest first-release limitations before T05 starts; no unsupported statistical claim becomes UI copy.
6. Identify the minimal representative histories and regression cases to reuse in production tests; archive reproducibility instructions/evidence with the PR and keep statistical tooling out of mobile imports/build/dependencies.

## Specs to update

Approved durable assumptions/limitations in the owning metrics contract; newly approved chart product rules in `docs/product/`. Statistical experiment evidence remains in the research PR.

## Gates

Repeatable seeded simulations with measured error/power/coverage and sensitivity results, plus real-history checks where defensible. Numerical expectations use justified tolerances.

Expected gates are proposals, not approval. Run `./boga test for` on the actual diff and agree every lane beyond `fast` with the operator. Every code PR adds/updates focused Jest coverage and passes `./boga test fast`; run `jest-coverage`, `complexity` and `dependencies` once on the finished PR. Read the owning test directory README first. Docs-only work proposes `docs-check`; any exemption from the normal gates needs explicit operator agreement. Record results and artifacts in the PR, not this card. Run `./boga doctor` before claiming a lane cannot run.
