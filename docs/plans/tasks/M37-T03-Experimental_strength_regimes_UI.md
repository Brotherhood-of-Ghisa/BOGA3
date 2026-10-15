# M37-T03 — Integrate the experimental Strength regimes mode

- Status: `planned`
- Depends on: M37-T02 + human analytical approval; updated design approval is the pre-implementation gate within this task
- Milestone: `docs/plans/milestones/M37-strength-regime-inference.md`
- Areas: frontend; UI impact: yes

## Objective and scope

Connect the approved assessment contract to a separate mode of the existing RM screen. Preserve Reference mode, navigation, workout drafts and logged metrics. This is an experimental branch deliverable, not automatic production activation.

## Decided and human gates

Reference stays the default; Strength regimes offers Fixed / Joint, initially Fixed. Use the same exercise/gym/time/effort scope. Display all qualifying points but retain the validated inferential sample. Joint p/load uncertainty is shared; weak evidence can show a tentative candidate with readable evidence-driven emphasis. Do not replace missing reference support with fitted regimes or label a candidate as confirmed membership/change.

Before implementation, pin an updated target based on the approved two-curve concept, covering selectors, readouts and loading/insufficient/failure states; obtain human design approval. Analytical approval of T02 is independently required. No UI acceptance testing precedes design approval.

## Deliverables and acceptance

1. Promote only independently validated pure fitting/assessment code into the correct production layer; research callers reuse that authority without duplicating the model. No new schema/server API. Document adopted product/technical rules in their owners.
2. Add mode/method controls, one no-break fit or tentative older/recent curves, counts and boundary uncertainty. Labels/patterns supplement colour; opacity conveys evidence, not a confidence interval or posterior percentage. Keep existing point details/selection and separate the fitted amplitudes from reference M.
3. Keep analysis derived, responsive and cancellable. Reject late results after account/exercise/filter/source changes; handle no-fit, weak identification and unsupported calibration contexts according to the approved contract. Recompute only the changed snapshot.
4. Test numerical promotion parity, real migrated-SQLite scope/provenance, selectors/geometry/accessible readouts, no reference fallback, insufficient/weak/failed states, stale/cancelled work, source edits and preserved navigation/drafts. Reuse frozen and approved assessment cases rather than rerun statistical calibration in UI tests.
5. Agree a minimal native scenario for actual touch/SVG layout, mode/method changes and return/draft preservation, which Jest cannot fully prove. Obtain human implemented-UI acceptance; update paper/owning docs and deliver an independently reviewed draft PR. Activation/merge remain owner decisions.

## Gates

Fast and all three quality gates plus docs-check; propose the exact focused native lane/scenario set before running it. New Maestro scenarios need owner agreement and a stated native-only proof. Human design/analytical/UI gates cannot be replaced by automated checks.
