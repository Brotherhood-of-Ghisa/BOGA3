# M37-T03 — Integrate the experimental Strength regimes mode

- Status: `in_progress`
- Phase: updated design target; analytical approval recorded 2026-10-15. UI implementation and acceptance have not started.
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

## UX contract — owner direction, 2026-10-15

Design target: extend the approved two-curve concept in `docs/plans/designs/M36-T05-structural-break-concept.md` and the existing RM screen. This task owns the updated target; its visual review remains the implementation gate. The owner requested temporal regime colours/labels, no subtitles or technical references, model toggles and evidence shades. These directions supersede conflicting score/readout-heavy parts of the earlier concept.

**Compare periods.** Trigger: select Two curves. Steps: partition displayed sets chronologically using the fitted complete-session cut; match each period's points and curve by hue, label and a secondary non-colour cue. Use plain date labels such as Before [date] / From [date], with the first newer session as the display boundary; keep every set in one session together. This is a display partition, not an assertion of an exact physiological change date or probabilistic point membership. Success: the two periods can be identified without interpreting a recency gradient. Edge: if the fit is insufficient/unresolved, retain observations and a short plain-language state without inventing a second curve.

**Switch the comparison.** Trigger: use One curve / Two curves and Fixed / Estimated controls within the fitted view; keep the approved Reference default available. Steps: recompute the chosen fit using the approved fixed/shared-joint assumptions and unchanged scope, rejecting stale results. Fixed / Estimated are proposed visible labels for the internal Fixed / Joint methods. Success: compare one fitted amplitude or two time-separated amplitudes with the same observed sets. Gradual competitors remain part of the underlying evidence calculation. Edge: loading/failure retains controls and displays a compact status. Switching the view never alters logged sets or saved metrics.

**Inspect a set.** Trigger: select a scatter point or View sets. Steps: retain its date, logged reps/load/effort and existing details, using its period's colour/label in the fitted view. Success: the observation remains inspectable regardless of inference sampling or overlap. Edge: overlapping sets remain individually selectable; changing the cut updates their period coherently.

Appearance:

- No subtitles, explanatory paragraphs, statistical citations, formulae, parameter codes or probability percentages in the main chart view. Keep required state copy brief and plain.
- Period identity uses two stable accessible hues plus labels/patterns; do not reuse recency shading as an alternative regime assignment.
- Shades convey relative likelihood evidence with the approved monotone mapping and readable minimum contrast. Labels and selected-point affordances remain readable at weak evidence; zero evidence does not hide an estimable candidate.
- Unsupported fits remain explicitly exploratory without calibrated confidence claims. Resolve the compact visual treatment in the target rather than adding a technical subtitle.
- Reuse existing design tokens, chart axes, filters and point details. No production UI or native acceptance flow is changed during target preparation.

## Visual review target m1

The owner approved the UI guidelines on 2026-10-15; approval of the rendered target is pending. The review board is `apps/mobile/artifacts/design/strength-regimes/m1/review-board.png`; its prompt and source/output hashes are beside it. Built-in image generation extends the directly inspected approved native r1 screenshot. It is one design in four states, not four competing directions: one curve, two periods, weaker evidence and insufficient data. It covers the proposed model/assumption controls, temporal legend, selected-set card and no-subtitle direction. The board's large state headings are outside the app frames and are review labels only.

This target governs the proposed content hierarchy, date-based colour/shape assignment and plain copy for these states. It does not certify numeric coordinates, observation counts, touch sizes or accessibility; adopted calculation functions, frozen vectors and native implementation checks remain authoritative. Reference remains the default even though this review board selects Fit. Loading, retry, unsupported/exploratory and stale-result behavior follow the UX/assessment contracts; this board does not claim those additional states are approved by implication. No production UI or UI acceptance test has been implemented.
