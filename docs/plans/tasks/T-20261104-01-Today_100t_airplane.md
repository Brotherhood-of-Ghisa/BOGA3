# T-20261104-01 — Today 100 t airplane reference

- Status: `in_progress`
- Depends on: none
- Milestone: none
- Areas: frontend; UI impact: yes

## Objective

Add an approximate 100 t Boeing 757-200 reference to Today → You's tonnage
chart, continuing the existing familiar-weight reference lines and icon style.
The operator approved this direction and requested creation and execution of
this card in the same session; one implementation PR carries its history.

## Scope and decided design

- Add one entry to the existing reference registry at 100000, labelled `≈100 t`.
- Draw an original, unbranded airplane side profile on the existing 32 × 16
  grid, using the existing chart renderer, tokens, stroke and passive semantics.
- Spoken description: `Boeing 757-200 at takeoff, approximately 100 tonnes`.
- Physical basis: Boeing's 757 airport-planning specifications list a 757-200
  configuration with maximum design takeoff weight 99790 kg (page 2-6):
  https://www.boeing.com/content/dam/boeing/v2/airports/acaps/757_Rev_H.pdf
- Reuse [[comparison.tonnage-references]] and [[copy.no-weight-unit]]. No
  eligibility, calculation, navigation, persistence or dependency changes.
- Product facts: none added, changed or decided. The reference's model and
  threshold belong in code/tests under the existing presentation fact.

## Freshness and open questions

No unresolved product choices. The initial discussion predates main's
6/20/40/60/80 t references and selected-day eligibility. The implementation
extends current main, including future-day projection and either-period
selection; it does not restore the earlier reach rule.

## Deliverables and acceptance

1. A distinct airplane, line and `≈100 t` label appear at the 100 t threshold.
2. Boundaries use raw figures; a rounded 99.9999 t does not unlock it.
3. The selected chart accessibility value speaks the model, takeoff context
   and approximate mass; the passive SVG does not add a focus stop.
4. Existing references and all six labels fit narrow/short charts and extreme
   scales without moving their numeric line positions or overlapping.
5. Jest proves actual, comparison and selected future-day behavior and metric
   switching. Native screenshots verify small and normal phone layouts.

## UX contract and target

Target: the existing Today → You chart and annotations, extended by one
same-style airplane and label. No new UI block, template or interaction.

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Read tonnage | Select Tons, then a day/period with at least 100 t | Plane, line, label and spoken comparison appear | Below threshold they are absent, including rounded-up display values |
| Select day/period | Scrub or step comparison; select a future day | References follow [[comparison.tonnage-references]] | Fitting alone never unlocks the airplane |
| Read sets | Switch Tons to Sets | Reference annotations and spoken comparisons disappear | Selected day and comparison retain existing behavior |

## Implementation and verification

Reuse `apps/mobile/components/today/tonnage-references.ts`; update
`apps/mobile/__tests__/today-progress-format.test.ts` and
`apps/mobile/__tests__/today-screen.test.tsx`. Existing component comments
and product facts already describe this extension; no durable doc change is
expected unless implementation changes their contract.

Independent reviewer agreed: `./boga test fast`, `./boga test jest-coverage`,
`./boga test complexity`, `./boga test dependencies`. Lower `frontend-ui` as
`covered-by-jest`: its existing flows never exercise high-tonnage annotations;
use boundary/render/geometry tests plus native small/normal screenshots.
Record results and evidence in the PR; remove this card when shipping.
