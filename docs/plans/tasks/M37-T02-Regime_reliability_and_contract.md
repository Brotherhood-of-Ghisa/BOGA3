# M37-T02 — Validate regime reliability and approve the assessment contract

- Status: `in_progress`
- Execution: research deliverable prepared on the experimental stack; full analytical acceptance remains pending human review of the measured limits and proposed assessment contract.
- Depends on: M37-T01
- Milestone: `docs/plans/milestones/M37-strength-regime-inference.md`
- Areas: docs; UI impact: no

## Objective

Measure how the direct segmented likelihood behaves and define a supported, reviewable handoff to the UI. The task is not accepted until the owner reviews concrete reliability findings and the assessment contract.

## Deliverables and acceptance

1. Use separate seeded calibration/evaluation histories for both fit approaches, known plateaus/level shifts and no-break constant/linear/curved progress. Start with 400 matching replications and 200 per stress; quick runs are development-only. Include complete cut/model/prefix search and weekly-prefix sensitivity, not a selected attractive example.
2. Stress changing RIR accuracy/load discrepancy, asymmetric/wider errors, false zeros, session/serial dependence, missing effort, sparse/gapped observations, small effects and nuisance/profile/search boundaries. Preserve unconditional failures/misses, measured Monte Carlo SE, power, effect/date uncertainty and computational limits.
3. Reuse the frozen programme and already-authorized local workout snapshots. Do not query new accounts or expose raw records. Limited empirical support is an inconclusive result, not an excuse to invent effort or substitute a later first set.
4. Deliver a derived assessment contract: status, input/model identity and scope, fit method, curve amplitudes, chronological candidate boundary interval, raw evidence/calibrated emphasis and diagnostics. Specify supported contexts, strength-precision/identification requirements, numerical abstention, repeated-look limits and monotone readable emphasis. The 5% no-break reference is a calibration convention, not a probability or visibility threshold.
5. Update the paper in place with only the current model/matching evidence; independently review source, tables/figures and product facts. Obtain human analytical approval before UI inference integration. If reliability fails, report failures and revise research rather than mark this card complete.

## Gates

Reuse unchanged T01 evidence; run focused changed-code checks plus agreed fast/coverage/complexity/dependencies/docs-check once on finished code. Record concrete reviewed findings and the precise human decision. No production inference or UI implementation is authorized before that gate.
