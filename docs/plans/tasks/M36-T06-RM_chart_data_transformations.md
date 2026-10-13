# M36-T06-RM_chart_data_transformations — Implement RM chart data transformations and real-data tests

- Status: `planned`
- Depends on: M36-T05
- Milestone: `docs/plans/milestones/M36-rm-performance-curve-analytics.md`
- Areas: frontend; UI impact: no

- Workstream: 4 — Implementation and validation

## Objective

Implement the approved observation/reference read model using the current local data and calculation boundaries. Preserve exact set identities, load semantics and effort provenance for chart interaction.

## Scope

- In: Read-only extraction, approved filtering/reference/inverse projection, invalidation and pure data transformations.
- Out: Routes/navigation, chart UI, residual-regression runtime, new synced analytics tables or changed RM/record rules.

## Decided

Milestone D1–D6 govern this task. This is planning only; no design, analytical selection or test-lane proposal is approved by creating the card. One card = one session = one local worktree = one PR under the task protocol. Merge the planning PR before execution.

## Open — resolve with the user at session start

Smallest repository seam preserving raw effort/set identity; batching and bounded large-history reads; shared inverse helper placement that satisfies formula single-source checks.

## Deliverables and acceptance

1. Read completed nondeleted history keyed by exercise definition ID, retaining set/session/block identity, date, actual reps/Weight, raw effort and load context. Merge repeated blocks for the same definition without dropping distinct sets.
2. Reuse `isConfirmedPerformedSet`, `isWorkingSet`, existing personal effort context and load/RM functions; all known recorded RIRs normalize under the approved analytical assumption; chart filters narrow that population without rewriting global eligibility or logged labels. Resolve actual load/metrics at m, then analytical total RM at u with the existing estimator; preserve both quantities.
3. Derive the approved reference and curve without duplicating formula constants or fitting each point to itself. Preserve the global raw-single figure, analytical u=1 branch, safe-integer m+n validation, effective-reps reference support, cutoff, zero/overflow handling and insufficient reference. Unknown RIR cannot normalize; retain canonical high RIR without changing working eligibility.
4. Prove ordinary total/per-side and enabled/disabled/positive/zero bodyweight behavior, dated/missing readings and retroactive definition changes against existing load vectors. Internal calculated versus displayed values must follow T01/T05’s approved projection.
5. Batch reads and refresh after history, definition, preference and reading changes using existing invalidation patterns. Retain previous valid data on failed refresh with a retry state, and prevent stale results after exercise/filter switches.
6. Add focused Jest unit/regression and real migrated SQLite integration coverage; reuse T03/T04 representative histories. No source graph imports exploratory statistical tooling and no derived value is synced.

7. Reuse T04’s canonical shared wave raw rows/oracle in pure and migrated-SQLite tests: stable rep/load waves must not invent strength gain, gradual progress matches expected values, prefix outputs ignore later workout rows, and insufficient prior support yields no curve/residual. Keep evaluation start/reference fixed across prefixes; do not author another equivalent fixture or import exploratory fit code.

## Specs to update

`docs/specs/tech/training-metrics-contract.md` for the approved new projection; `docs/specs/09-project-structure.md` only if a new canonical subsystem is needed. No schema/sync change is expected.

## Gates

Jest formula-parity/filter/cutoff/load-context cases and real-data query/refresh cases, including duplicate blocks, zero/invalid/planned/deleted rows, legacy efforts, missing dates and dense histories. Proposed `fast` + three quality lanes; add device/backend lanes only for actual changed contracts.

The shared wave adds focused extraction/reference/projection and future-leakage assertions over the existing fixture, not a new aggregate lane.

Expected gates are proposals, not approval. Run `./boga test for` on the actual diff and agree every lane beyond `fast` with the operator. Every code PR adds/updates focused Jest coverage and passes `./boga test fast`; run `jest-coverage`, `complexity` and `dependencies` once on the finished PR. Read the owning test directory README first. Docs-only work proposes `docs-check`; any exemption from the normal gates needs explicit operator agreement. Record results and artifacts in the PR, not this card. Run `./boga doctor` before claiming a lane cannot run.
