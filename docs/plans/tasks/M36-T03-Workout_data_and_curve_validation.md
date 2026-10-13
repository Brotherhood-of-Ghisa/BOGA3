# M36-T03-Workout_data_and_curve_validation — Audit workout data and empirically validate the RM curve

- Status: `planned`
- Depends on: M36-T02
- Milestone: `docs/plans/milestones/M36-rm-performance-curve-analytics.md`
- Areas: docs; UI impact: no

- Workstream: 2 — Empirical testing against data

## Objective

Identify usable historical data and test the reconstructed curve without assuming that fixture effort labels are real measurements. Record evidence that can guide the first-release contract and its limitations.

## Scope

- In: Data inventory/provenance, real-history curve fit, residual distributions and effort/reference sensitivity.
- Out: Importing into production, mutating a user’s workout history, generalising synthetic-fixture results to real lifters.

## Decided

Milestone D1–D6 govern this task. This is planning only; no design, analytical selection or test-lane proposal is approved by creating the card. One card = one session = one local worktree = one PR under the task protocol. Merge the planning PR before execution.

## Open — resolve with the user at session start

Which historical datasets and effort labels have verified provenance; availability of a user-authorized local/export history; adequacy of independent sessions and rep ranges.

## Deliverables and acceptance

1. Inventory the checked-in rich-history package, existing Jest histories and shared load vectors. Separate real/imported, enriched/demo and fully synthetic observations; record counts, dates, exercise identity, rep/effort coverage and exclusions.
2. Verify source and effort-label provenance of `apps/mobile/scripts/import/fixtures/dev-rich-history.boga-import.json`. Its metadata names GymBook, but that alone does not authenticate RIR labels; preserve the distinction in findings.
3. Use real historical observations where available and authorized, preserving privacy and raw history. If no suitable verified data exists, explicitly report the limitation and obtain human approval of constrained release claims rather than fabricate empirical validation.
4. Evaluate curve residual distributions, signed and percentage bias across rep ranges, dates/sessions, gyms/load contexts and effort cohorts. Compare recorded-RIR strata, RIR ±1 sensitivity and reference choices on held-out/later observations. Keep missing/unknown effort outside normalization; uncertain imported RIR must be identified and tested separately, never treated as verified effort.
5. Audit repeated blocks/overlaps, invalid/planned/deleted sets and current retroactive metadata. Report how sparse cohorts and missing effort alter conclusions; reference provenance and cutoff must accompany each result. Test phase/task-standard sensitivity: the inspired reset phase prescribes controlled eccentric tempo and a pause, which may produce residuals after m+n normalization. Targets do not establish performed technique; this adds research context, not a production phase filter.
6. Produce reproducible summaries, diagnostics and findings/adjustment recommendations. Any change to T01’s approved contract returns to analytical/product review before design starts.

7. Audit the [provisional shared weekly wave starter data](../research/M36-weekly-wave-example.json): reconcile its actual prior sets and stable/gradual scenario rows, baseline/weekly-prefix populations, set/session identities, raw Weight/actual reps/recorded RIR versus targets, effective reps u=m+n, one-gym scope and synthetic/provisional flags. Keep stable/gradual controls separate from real-history findings; preserve one fixture inventory for T04–T09 rather than creating per-task histories. Programme assumptions remain provisional; T04 still validates/freezes the canonical test fixture.

## Specs to update

Research evidence belongs in the PR; only approved lasting assumptions/eligibility decisions move to the technical contract and product facts. Raw private histories are not repository assets.

## Gates

Dataset validation/count reconciliation and deterministic extraction checks; representative holdout analyses. Label imported/enriched/synthetic results separately and reuse this fixture inventory in T06–T08.

For the shared wave, prove provenance/count and prefix-population reconciliation once; keep empirical and synthetic outputs labelled separately.

Expected gates are proposals, not approval. Run `./boga test for` on the actual diff and agree every lane beyond `fast` with the operator. Every code PR adds/updates focused Jest coverage and passes `./boga test fast`; run `jest-coverage`, `complexity` and `dependencies` once on the finished PR. Read the owning test directory README first. Docs-only work proposes `docs-check`; any exemption from the normal gates needs explicit operator agreement. Record results and artifacts in the PR, not this card. Run `./boga doctor` before claiming a lane cannot run.
