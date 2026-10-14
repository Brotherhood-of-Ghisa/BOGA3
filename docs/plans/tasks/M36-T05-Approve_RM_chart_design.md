# M36-T05-Approve_RM_chart_design — Design and obtain human approval of the RM scatter chart

- Status: `in_progress`
- Depends on: M36-T04
- Milestone: `docs/plans/milestones/M36-rm-performance-curve-analytics.md`
- Areas: frontend; UI impact: yes

- Workstream: 3 — Graphics and design

## Objective

Design the first-release interactive reps-versus-load scatter view using the validated analytical contract and BoGa’s current design system. Pin a human-approved design target and UX contract before production UI implementation or UI acceptance testing.

## Scope

- In: First-release chart/filters/readout/states/accessibility/entry; separate exploratory two-strength-curve design for eventual validated inference.
- Out: Production code, UI acceptance test execution, production breakpoint UI, new design system or altered metric conventions.

## Decided

The owner accepted the T04 research limits and exact shared fixture by requesting continuation on 2026-10-14. Work starts from `4a042ab7` on the authorised experimental branch stack; the draft targets `m36-t04-statistical-validation`. Main stays untouched. Repo-native review r1 is the design target after Figma exhausted its Starter tool quota; no production UI or acceptance testing begins before human design approval.

## Proposed — human design review required

The [review brief](../designs/M36-T05-rm-chart-review.md) pins the target, flows and proposed filter/selection/entry semantics. All design choices remain proposals pending human review; the adopted analytical rules and research limits remain accepted. Additional weekly fitted overlays remain excluded from the release target. The owner requested a separate [two-curve structural-break concept](../designs/M36-T05-structural-break-concept.md); its score and activation require further research/validation, not an implicit scope change.

## Deliverables and acceptance

1. Follow `docs/specs/ui/ai-design-policy.md` and spec 08. Reuse `uiRoles`, `uiFonts`, primitives and existing chart/readout/selection conventions; assess `react-native-svg` before proposing another renderer.
2. Design X = RIR0-equivalent repetitions u=m+n and Y = the approved load coordinate, qualifying-set scatter and estimated reference overlay. Differentiate by date/recency using existing roles and additional text/accessible cues; recency must not imply a PR or significance.
3. Show date, actual reps m, recorded RIR n, equivalent reps u, load and unchanged displayed 1RM. Missing/unknown RIR is excluded from normalized points, not inferred as zero; design its no-normalizable-data state. Design appropriate exercise, time-range and effort filters with visible applied state and deterministic selection after changes.
4. Cover coincident points, small/dense histories, empty/insufficient/no-reference states, errors/retry, deleted/unavailable exercise, small and large phones, all appearance presets, touch ergonomics and VoiceOver access to values.
5. Use Figma where useful and link exact frames/version if selected; keep external artifacts in Figma and target/screenshots beside the UX contract or PR, not persistent specs. Report conflicts with existing contracts.
6. Record explicit human design approval for the chart, edge states, filter semantics and proposed final entry. T07 cannot begin UI implementation and T08 cannot run UI acceptance tests before this approval; a material design revision renews approval.

7. Use the same shared wave prefix/oracle to human-review weekly scatter/reference/readout, primary plateaus and same-load/RIR progress, with stable/smooth controls shown as methodological comparisons and insufficient-baseline states. Keep the approved fixed reference; any request for additional weekly fitted curves must be clarified and approved before entering the visual target. Do not prescribe exact programme parameters here.

8. Accommodate eventual structural-break outputs in a separate exploratory design: old/candidate curves with the same adopted shape and different S; chronological suffix/session dependence, adequacy/no-fit/weak/supported states, explicit score semantics, uncertainty and readable opacity/pattern/text cues. Document existing T02/T04 coverage and the unassigned future inference/delivery gap. Do not add a detector, probability claim or second curve to T06–T09's first-release implementation.

## UX contract (proposed; T05 pins the approved target)

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Inspect a set | Choose an observation (or overlapping group), then a specific set | Read exact date, reps, Weight/load, effort and 1RM | Every coincident set remains reachable; missing effort is explicit |
| Filter observations | Select exercise, time range and effort cohort | Chart/reference/readout reflect approved scope | No qualifying sets or reference support has a designed state |
| Open and return — design only | Propose entry from the current selected-exercise context | Preserve exercise/context and existing Back behavior | No production navigation is wired until T09 |

## Specs to update

No design targets in specs. Graduate approved observable decisions to `docs/product/`; update `docs/specs/ui/design-language.md`/`ux-rules.md` only for accepted shared rules.

## Gates

Design review against the approved analytical contract, token/contrast/accessibility review and complete state coverage. No production UI acceptance suite at this stage.

Review the shared wave’s weekly prefix targets with the human; no extra fitted-curve feature or UI acceptance suite is inferred.

Expected gates are proposals, not approval. Run `./boga test for` on the actual diff and agree every lane beyond `fast` with the operator. Every code PR adds/updates focused Jest coverage and passes `./boga test fast`; run `jest-coverage`, `complexity` and `dependencies` once on the finished PR. Read the owning test directory README first. Docs-only work proposes `docs-check`; any exemption from the normal gates needs explicit operator agreement. Record results and artifacts in the PR, not this card. Run `./boga doctor` before claiming a lane cannot run.
