# M37-T01 — Fit strength regimes with the conditional likelihood

- Status: `planned`
- Depends on: reviewed M36 experimental baseline
- Milestone: `docs/plans/milestones/M37-strength-regime-inference.md`
- Areas: docs; UI impact: no

## Objective

Connect the adopted three-point RIR/load likelihood to constant, gradual and one-level-change strength trajectories. Produce reproducible fixed/shared-joint fits and diagnostics, isolated from production imports.

## Decided

Milestone D1–D5 apply. The owner explicitly authorized this implementation on the experimental stack. Only S changes curve amplitude. Joint p and load SD are shared across regimes. Reuse existing likelihood/kernel/session helpers; neither ordinary residual regression nor an RSS score substitutes for maximizing the conditional load likelihood.

## Deliverables and acceptance

1. Validate finite nonnegative observed loads, positive strength/load-discrepancy parameters and valid loading factors, safe rep/RIR states, distinct ordered complete-session inputs and first-ordinal selection provenance. Preserve IDs/timestamps and whole-session cut intervals; at least eight samples per side is the initial search rule.
2. Fit constant/linear/smooth-quadratic no-break strength and one abrupt level change. Report the best no-break competitor, older/newer strength and cut uncertainty. Include no-fit, numerical convergence, profile/boundary and nuisance-information diagnostics; no hidden fixed 80–120 kg real-data domain.
3. Support fixed p=.50/tau2.50 kg and joint shared p/tau. Retain exact-zero load discrepancy and physical p endpoints. Compare break/no-break on identical observations; output raw likelihood evidence without calling it a probability or supplying an unvalidated opacity/visibility rule.
4. Test scalar likelihood parity, exact-zero/logged-one states, known plateaus and gradual progress, sparse/tied/gapped inputs, lower/upper boundaries, numerical refinement, load-unit parity and deterministic reproducibility. Use small independent numerical oracles rather than mirrored implementation tests.
5. Update the single current-model paper with implemented methods and honest numerical limitations; independently review code and product facts. Supply one draft PR and its source/gate evidence. Delete this card on delivery and mark T01 completed in the milestone; T02 validation and human gate remain open.

## Gates

The agreed research set is fast, jest-coverage, complexity, dependencies and docs-check; run once on the finished revision and record actual evidence. Read test README first. No production/native/backend contract changes are authorized by this card.
