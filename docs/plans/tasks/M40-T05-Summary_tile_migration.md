# M40-T05 — SummaryTile and At a glance migration

- Status: `planned`
- Depends on: `M40-T02-Compact_card_and_gallery`
- Milestone: `docs/plans/milestones/M40-coded-ui-patterns.md`
- Areas: frontend; UI impact: yes

## Objective

Implement the headline summary tile using the accepted compact visual language,
and migrate At a glance's selected top data tile. Humans must approve the native
metric hierarchy, density, comparisons and integration before it ships.

## Decided and scope

Load `docs/plans/M40-pattern-contracts.md` for the operator-approved native
templates and shared row contract. This selection is settled; recheck current
main for drift, and obtain a new template decision only for a material deviation
or new derivative. Coded-result acceptance remains required for this migration.

Follow D1–D6. This family's prominence comes from headline figures and grouped
metrics; compact spacing remains the default. Reuse the shared header and the
existing WeekFigure/Stat presentation instead of inventing sizes or comparison
graphics. The approved reference is Group stats in GroupGlancePage. Preserve its
existing appearance as an extraction; no extra supporting section is needed.
Period/metric controls that govern several cards keep their current scope and
placement.
No calculation, comparison, date-formatting or PR-emphasis changes are intended.

## Open — resolve with the human at session start

- Recheck the selected Group stats tile against current main and report drift;
  preserve the approved appearance and both headline metrics.
- Agree the smallest metric/header API; the first consumer has no additional
  supporting section. Do not add unused chart/action slots or a universal
  dashboard builder.
- Show any new variant's inherited parent rules and proposed differences before
  coding; reconfirm native review states/viewports.

## Deliverables and acceptance

1. Production SummaryTile with compact token-based insets, headline metric roles
   and consistent label/comparison alignment. Reuse current metric rendering;
   data producers keep calculation and formatting responsibilities.
2. Migrate the accepted At a glance tile while preserving selected period,
   metric, stale/held reads, refresh, error/retry, existing copy and accessibility.
3. Extend the native gallery with the actual tile, short/large/zero values,
   comparison states and relevant loading/error/long-content fixtures.
4. Jest covers the visual role/spacing contract and preserved period/metric
   presentation. Adopted consumers cannot override the contract locally.
5. Present current native before/after captures and the running gallery/reference
   at the agreed sizes. Record explicit human acceptance of the coded result at
   the reviewed commit per D5; the HTML sketch's acceptance does not count.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Read headline figures | Open At a glance; read the selected period's headline tile | Larger figures remain scannable within the compact spacing contract | Large/zero/unavailable values retain existing formatting and readable layout |
| Change context | Use the existing period/metric controls; inspect updated figures | Tile follows the same context as the rest of the screen | Held, offline or failed reads keep current feedback and retry behavior |

## Specs and gates

Update `docs/specs/ui/components-catalog.md` and owning component contracts;
graduate accepted shared presentation rules into `docs/specs/ui/design-language.md`.
Load `docs/specs/tech/training-metrics-contract.md` for preserved figures and
`apps/mobile/__tests__/README.md` before test edits. Start from fast + relevant
native UI/group lanes via `./boga test for`; agree any reductions with the
reviewer, retaining native captures/human review. Run jest-coverage, complexity,
dependencies and independent code/product reviews. Preserve acceptance/evidence
in the PR, delete this card in the shipping PR and update the milestone.
