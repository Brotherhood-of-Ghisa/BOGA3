# M37-T03 — Integrate the experimental Strength regimes mode

- Status: `in_progress`
- Phase: implementation and native validation complete; implemented-UI acceptance pending; analytical approval recorded 2026-10-15. Owner approved the visual design and requested implementation on 2026-10-15; implemented-UI acceptance is the remaining gate.
- Depends on: M37-T02 + human analytical approval; analytical and visual design approvals recorded; native validation and implemented-UI acceptance remain
- Milestone: `docs/plans/milestones/M37-strength-regime-inference.md`
- Areas: frontend; UI impact: yes

## Objective and scope

Connect the approved assessment contract to the existing RM screen, replacing its Reference mode as approved by the owner. Preserve navigation, workout drafts and logged metrics. This is an experimental branch deliverable, not automatic production activation.

## Decided and human gates

The owner approved removal of Reference mode. Offer One curve / Two curves and Parsimonious / Rich, initially One curve + Parsimonious. Parsimonious means fixed uncertainty; Rich means shared joint uncertainty estimation. Use the same exercise/gym/time/effort scope, with an explicit All gyms option alongside individual gyms. Display all qualifying points but retain the validated inferential sample. Joint p/load uncertainty is shared; weak evidence can show a tentative candidate with readable evidence-driven emphasis. Unavailable fits retain observations without a historical-reference fallback; never label a candidate as confirmed membership/change.

The owner approved the updated visual design and requested implementation on 2026-10-15. The m2 target plus the All gyms-only m3 revision and approved UX contract are the build inputs. T02 analytical approval is recorded separately. Implemented-UI acceptance remains outstanding.

## Deliverables and acceptance

1. Promote only independently validated pure fitting/assessment code into the correct production layer; research callers reuse that authority without duplicating the model. No new schema/server API. Document adopted product/technical rules in their owners.
2. Add mode/method controls, one no-break fit or tentative older/recent curves, counts and boundary uncertainty. Labels/patterns supplement colour; opacity conveys evidence, not a confidence interval or posterior percentage. Keep existing point details/selection and logged metrics; do not expose a historical-reference mode or overlay.
3. Keep analysis derived, responsive and cancellable. Reject late results after account/exercise/filter/source changes; handle no-fit, weak identification and unsupported calibration contexts according to the approved contract. Recompute only the changed snapshot.
4. Test numerical promotion parity, real migrated-SQLite scope/provenance, selectors/geometry/accessible readouts, no reference fallback, insufficient/weak/failed states, stale/cancelled work, source edits and preserved navigation/drafts. Reuse frozen and approved assessment cases rather than rerun statistical calibration in UI tests.
5. Agree a minimal native scenario for actual touch/SVG layout, mode/method changes and return/draft preservation, which Jest cannot fully prove. Obtain human implemented-UI acceptance; update paper/owning docs and deliver an independently reviewed draft PR. Activation/merge remain owner decisions.

## Gates

Fast and all three quality gates plus docs-check; propose the exact focused native lane/scenario set before running it. New Maestro scenarios need owner agreement and a stated native-only proof. Human design/analytical/UI gates cannot be replaced by automated checks.

## UX contract — owner direction, 2026-10-15

Design target: extend the approved two-curve concept in `docs/plans/designs/M36-T05-structural-break-concept.md` and the existing RM screen. This task owns the updated target; its visual review remains the implementation gate. The owner requested temporal regime colours/labels, no subtitles or technical references, model toggles and evidence shades. These directions supersede conflicting score/readout-heavy parts of the earlier concept.

**Compare periods.** Trigger: select Two curves. Steps: partition displayed sets chronologically using the fitted complete-session cut; match each period's points and curve by hue, label and a secondary non-colour cue. Use plain date labels such as Before [date] / From [date], with the first newer session as the display boundary; keep every set in one session together. This is a display partition, not an assertion of an exact physiological change date or probabilistic point membership. Success: the two periods can be identified without interpreting a recency gradient. Edge: if the fit is insufficient/unresolved, retain observations and a short plain-language state without inventing a second curve.

**Switch the comparison.** Trigger: use One curve / Two curves and Parsimonious / Rich controls, initially One curve + Parsimonious. Steps: recompute the chosen fit using the approved fixed/shared-joint assumptions and unchanged scope, rejecting stale results. Parsimonious / Rich are the owner-approved visible names for the internal fixed/shared-joint methods; Reference / Fit is removed. Success: compare one fitted amplitude or two time-separated amplitudes with the same observed sets. Gradual competitors remain part of the underlying evidence calculation. Edge: loading/failure retains controls and displays a compact status. Switching the view never alters logged sets or saved metrics.

**Inspect a set.** Trigger: tap a scatter point or choose an observation through View sets. The Selected set panel describes that observation, not an automatically chosen representative set. Retain its date, reps, RIR, chart load, logged Weight and existing 1RM, using its period's colour/label. Keep selection until another set is chosen or a filter/source change invalidates it; never leave stale details. Success: observations remain inspectable regardless of inference sampling or overlap. Edge: overlapping sets remain individually selectable; changing the cut updates their period coherently. A selected card in a mockup illustrates this interaction, not automatic initial selection.

**Choose gyms.** Owner decision, 2026-10-15: the gym filter offers All gyms as well as individual gyms. All gyms pools qualifying observations for the selected exercise across gyms, applying the same time/effort filters to both plotting and fitting. Preserve each set's gym provenance and existing loading/bodyweight calculations; expose the gym in selected-set details and include the selected gym scope in snapshot invalidation. Changing gym scope recomputes the fit and invalidates stale results. Do not treat gym changes as proof of strength changes: equipment/context differences can mimic a temporal break, and pooling does not extend validated calibration coverage. Include All gyms in the updated visual target and test combined/single-gym scope without duplicate sets. This decision adds an option; it does not change the initial gym selection.

**Data scope.** Use all qualifying completed working sets with known canonical RIR within the selected exercise, gym, time range and effort filters for the scatter plot. This does not imply full-account or all-history fitting. Retain the approved inference sample: the first working ordinal in each completed session, chosen before inspecting effort or residuals. If that set lacks effort, omit it from fitting without substituting a later set; missing RIR never means zero. Distinguish plotted-set and fitting-session counts. Sparse fitting samples can therefore leave many visible points but no supported two-curve fit. The real-data preview does not authorize changing this sampling rule.

Appearance:

- No subtitles, explanatory paragraphs, statistical citations, formulae, parameter codes or probability percentages in the main chart view. Keep required state copy brief and plain.
- Period identity uses two stable accessible hues plus labels/patterns; do not reuse recency shading as an alternative regime assignment.
- Shades convey relative likelihood evidence with the approved monotone mapping and readable minimum contrast. Labels and selected-point affordances remain readable at weak evidence; zero evidence does not hide an estimable candidate.
- Unsupported fits remain explicitly exploratory without calibrated confidence claims. Resolve the compact visual treatment in the target rather than adding a technical subtitle.
- Reuse existing design tokens, chart axes, filters and point details. No production UI or native acceptance flow is changed during target preparation.

## Previous review target m1

The owner approved the UI guidelines on 2026-10-15; approval of the rendered target is pending. The review board is `apps/mobile/artifacts/design/strength-regimes/m1/review-board.png`; its prompt and source/output hashes are beside it. Built-in image generation extends the directly inspected approved native r1 screenshot. It is one design in four states, not four competing directions: one curve, two periods, weaker evidence and insufficient data. It covers the proposed model/assumption controls, temporal legend, selected-set card and no-subtitle direction. The board's large state headings are outside the app frames and are review labels only.

This target governs the proposed content hierarchy, date-based colour/shape assignment and plain copy for these states. It does not certify numeric coordinates, observation counts, touch sizes or accessibility; adopted calculation functions, frozen vectors and native implementation checks remain authoritative. This earlier board shows Reference / Fit; that selector was subsequently removed by explicit owner direction. Loading, retry, unsupported/exploratory and stale-result behavior follow the UX/assessment contracts; this board does not claim those additional states are approved by implication. No production UI or UI acceptance test has been implemented.

## Approved visual review target m2 + m3

The owner approved Reference removal and requested Parsimonious / Rich naming on 2026-10-15. The current review board is `apps/mobile/artifacts/design/strength-regimes/m2/review-board.png`, with exact generation prompt and source/output hashes beside it. The two selectors are now One curve / Two curves and Parsimonious / Rich. One curve + Parsimonious is the proposed initial view. Visible names map to existing fixed versus shared-joint uncertainty; no likelihood, parameter-estimation or sampling rule changed. The board otherwise preserves temporal colours, markers, date labels, shades and the selected-set readout. Owner approved the visual design on 2026-10-15 and authorized the All gyms revision plus implementation/testing. The m3 board at `apps/mobile/artifacts/design/strength-regimes/m3/review-board.png` applies only that filter-label change; m2 governs all other visuals. The approved UX contract governs interactions and states. Previous images remain intact; this record fixes pre-build inputs. Current implementation and validation are recorded below.

## Real-account numerical preview

On 2026-10-15 the owner authorized another read-only BOGA_DEV preview for the same named account. The generated m2 board uses illustrative points, not account-derived fits. A separate actual-data figure is `apps/mobile/artifacts/review/strength-regimes-real-data/real-workout-curves.png`, with restricted raw input, computed coordinates and SHA256 manifest beside it. Scientific plotting uses the canonical estimator/recorded coordinates; no image generation redraws these observations. It compares Zercher Squat and Dumbbell Bench Press at AF SP over their full fetched completed history, without mixing gyms. There are 15/40 eligible plotted sets but only 3/1 known-effort first-working-set samples respectively. Exploratory one-curve lines are explicitly labelled; no second regime is fitted or fabricated. This is numerical grounding for insufficient/unsupported states, not implementation, UI acceptance or visual approval of m2. No remote records changed.

## Implementation and review checkpoint — 2026-10-15

The experimental branch now connects the promoted likelihood fitter to One/Two curves and Parsimonious/Rich controls, adds All gyms, keeps the approved first-ordinal sample and rejects invalidated work. Chart periods use dedicated categorical teal/plum roles, circles/solid versus diamonds/dashed, and Before/From labels; the selected card shares the current period identity. Reference UI is removed. All plotted/selected metrics retain canonical loading. The current paper reflects this model and runtime state.

Unsupported real histories stay explicitly exploratory with uniform readable curves, without calibrated evidence shading or intervals; this applies even to the synthetic UI fixture, which is not calibration evidence. Internal diagnostics retain the searched fits, raw likelihood contrast and observed session boundary bracket. The eight-per-side search minimum is not a sufficiency claim.

Independent code/product review found the selected-period identity gap and the need to retain the superseded stable product-fact ID; both were fixed. Dedicated role contrast and connected migrated-SQLite tests cover both methods, pooled gyms, selection and unchanged workout rows. Final numerical/test evidence is recorded locally under `apps/mobile/artifacts/review/strength-regimes-ui/`.

The operator was asked to agree fast + coverage + complexity + dependencies + docs-check and one focused native scenario (selectors, All gyms, overlap selection and workout return/draft preservation). The standing non-native quality set is agreed; the owner approved the focused native scenario and branch push on 2026-10-16. The focused `ios-rm-curve` lane owns the approved native proof; final large/small viewport runs passed. Native screenshots/comparison and device interaction proof are recorded; implemented-UI acceptance remains outstanding; the draft PR is prepared from these passing gates; do not mark this task complete or activate/merge it.

Final automated gates passed: fast (290 Jest suites / 3,956 tests plus its required lint/typecheck/UI/meta/backend smoke lanes), coverage (86.87% branches / 94.50% lines), complexity, dependencies (13 unchanged known violations) and docs-check. Native validation passed on iPhone 17 Pro and iPhone 13 mini after rounding only the synthetic fixture to discrete 2.5 kg loads. Actual plot touch, coincident choices, both methods, gym filtering, insufficient state, History return and intact planned workout passed. See local `apps/mobile/artifacts/review/strength-regimes-ui/native-review.md`; coverage is now 86.87% branches / 94.50% lines. Human implemented-UI acceptance remains pending.
