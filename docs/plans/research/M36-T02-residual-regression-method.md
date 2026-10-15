# Session residual regression method notes

When assessing the statistical model, assumptions or findings, use the [research paper](M36-T04-research-review.md). These notes describe the numerical method checks; they introduce no separate error model.

## Responses and numerical fits

Keep latent strength S, observed analytical RM A and the independent reference M distinct. Session median percentage residuals describe performance relative to M. They need not equal zero in a stable programme: set selection and fatigue affect the session response. Aggregating dependent sets prevents counting each as an independent session but does not establish independence across workouts.

Use elapsed session time rather than a compressed row index for real histories. Fit constant, linear, quadratic, hinge and jump design matrices with scaled, reorthogonalized QR; reject rank deficiency and insufficient residual degrees of freedom. Cuts fall between distinct session times and cannot split a session. Retain gap intervals rather than treating their midpoint as a measured change date.

The checks exercise noiseless coefficient recovery, smooth no-break competitors, plateau/repeated-exposure examples, baseline/selection sensitivity, duplicate-set aggregation, sparse/rank/gap cases and earlier-only prefix/forecast behavior. BIC is a descriptive ranking sensitivity; selected breaks and small resampling examples do not produce calibrated significance. Full matching-family validation is governed by the [validation contract](M36-T04-validation-contract.md).

## Conditional uncertainty checks

Use the paper's exact-zero/three-point RIR model. Validate state order and probabilities, logged 1 including actual 0, safe-integer equivalent reps and the existing single-rep branch. Draw actual RIR conditional on the logged reading, then load from the relevant component. Compare scalar/grid likelihoods without an extra latent-RIR prior factor. Keep p endpoint/flat-profile diagnostics and load discrepancy at RIR 0.

Seeded standalone checks pass at p=0/0.5/0.75/1. Conditional frequencies and normalization checks exercise the sampler; toy joint profiles are method diagnostics, not independently calibrated uncertainty or power estimates. A deterministic +1 edit to logged effort is a metadata sensitivity, not a draw from the error model.

## Reproduction

The numerical helper is `apps/mobile/__tests__/helpers/residual-regression-research.ts`; method checks reuse the frozen synthetic fixture and adopted calculation kernel. No production dependency or copied RM constants are introduced.

```sh
apps/mobile/node_modules/.bin/tsx --tsconfig apps/mobile/tsconfig.json docs/plans/research/M36-T02-residual-regression-checks.ts
apps/mobile/node_modules/.bin/tsx --tsconfig apps/mobile/tsconfig.json docs/plans/research/M36-T02-residual-regression-checks.ts --correct-probability=0.75
```

The full study's simulation counts, oracle comparisons, identification limits and code-gate evidence belong in the research paper. No result here authorizes a production structural-break detector.
