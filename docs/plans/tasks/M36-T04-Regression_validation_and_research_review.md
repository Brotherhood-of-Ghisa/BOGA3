# M36-T04-Regression_validation_and_research_review — Validate regression with known behaviours and approve research findings

- Status: `in_progress`
- Depends on: M36-T03
- Milestone: `docs/plans/milestones/M36-rm-performance-curve-analytics.md`
- Areas: docs; UI impact: no

- Workstream: 2 — Empirical testing against data

## Objective

Validate the exploratory framework against known synthetic behaviours and available historical data. Close research with an honest reliability assessment and an agreed first-release chart contract.

## Scope

- In: Synthetic ground truth, empirical trend/break exploration, sensitivity and human research review.
- Out: Shipping structural break detection or interpreting an apparent shift as established significance.

## Decided

Milestone D1–D6 govern this task. Creating the card alone approved no design, analytical selection or test-lane proposal. One card = one session = one local worktree = one PR under the task protocol. The owner's experimental branch-stack authorisation below supersedes the initial planning-merge prerequisite.

On 2026-10-14 the owner authorised T04 on the experimental branch stack after accepting T03's descriptive findings with uncertain effort provenance. Work starts from T03 commit `01ce2409cb54670f38665423aa395580f98af8a9` and a draft PR targets `m36-t03-workout-curve-validation`; main stays untouched. Compare fixed assumed RIR sigma with joint 1RM/sigma estimation. 1RM is the only free curve parameter; sigma is measurement uncertainty, and any trajectory/break model concerns that amplitude over time. Break modelling remains exploratory, with direct latent-trajectory inference deferred if evidence does not support it. Reuse the session's agreed fast and three quality gates; no app UI/production work is authorised.

The [research review](../research/M36-T04-research-review.md) and [candidate oracle](../research/M36-T04-weekly-wave-oracle.json) are ready for human review after local validation. Keep `in_progress`: acceptance 5 and exact fixture freezing in acceptance 7 remain pending; T05 has not started.

## Open — resolve with the user at session start

Reliability thresholds, usable sample sizes and scope of supported claims; whether the empirical findings require changing the reference/effort contract.

## Deliverables and acceptance

1. Generate seeded independent scenarios for stable strength, gradual improvement, slope change, abrupt level change, no break with changing rep/effort mix, sparse sessions, long gaps, noise/outliers and within-session dependence.
2. Measure false positives under no-break/progressive scenarios, sensitivity/power across effect sizes and independent-session counts, breakpoint localization and uncertainty coverage across repeated simulations. Keep known ground truth separate from fitted output.
3. Evaluate model comparison, searched-break selection bias and session-aware resampling against T02’s plan. Include unreliable/inconclusive examples and sensitivity to reference window, recorded-RIR error/strata and actual/effective rep distribution.
4. On suitable historical observations, compare gradual-change and segmented explanations; label findings exploratory. Report effect sizes, uncertainty and sample limitations instead of inferring significance from a plot.
5. Record failures, adjustments and evidence. Human analytical/product review approves the reference, effort and load-coordinate contract and honest first-release limitations before T05 starts; no unsupported statistical claim becomes UI copy.
6. Identify the minimal representative histories and regression cases to reuse in production tests; archive reproducibility instructions/evidence with the PR and keep statistical tooling out of mobile imports/build/dependencies.

7. Create/freeze the one canonical shared weekly wave fixture and numerical oracle after programme clarification. Verify primary held-load plateaus, same-load RIR progress and higher-load/RIR1 equivalence outputs; separately verify unchanged latent RM and smooth progression in the known controls, every future-free weekly prefix and insufficient-baseline outputs against the fixed historical reference. Reuse the fixture’s seeded variants for method checks; additional weekly fitting stays exploratory unless separately approved.

## Specs to update

Approved durable assumptions/limitations in the owning metrics contract; newly approved chart product rules in `docs/product/`. Statistical experiment evidence remains in the research PR.

## Gates

Repeatable seeded simulations with measured error/power/coverage and sensitivity results, plus real-history checks where defensible. Numerical expectations use justified tolerances.

The shared wave owns one input family with plateau/repeated-exposure outputs and separate stable/smooth/prefix/sparse assertions; statistical error/power claims use known controls, not assumed ground truth in the primary history; later tasks reuse it, and this single history does not establish statistical reliability.

Expected gates are proposals, not approval. Run `./boga test for` on the actual diff and agree every lane beyond `fast` with the operator. Every code PR adds/updates focused Jest coverage and passes `./boga test fast`; run `jest-coverage`, `complexity` and `dependencies` once on the finished PR. Read the owning test directory README first. Docs-only work proposes `docs-check`; any exemption from the normal gates needs explicit operator agreement. Record results and artifacts in the PR, not this card. Run `./boga doctor` before claiming a lane cannot run.
