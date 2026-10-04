# M32-T04 — Replace the Progress landing with tables

- Status: `planned`
- Depends on: `M32-T02`, `M32-T03`
- Milestone: `docs/plans/milestones/M32-progress-tables-and-individual-history.md`
- Areas: frontend screens/components; UI impact: yes

## Objective

Replace the current Progress landing with T01's accepted grouped muscle table
and selected muscle's inline exercise contribution table. Wire the derived
comparisons, distinct selection controls and individual-name heatmaps into one
shared implementation for Progress and its compatibility route.

## Scope

- In: landing layout, Working sets/Volume presentation, zero rows, inline
  contributions, name actions, state restoration and meaningful screen tests.
- Out: new charts/treemaps, weekly heatmap removal, family history, metric-rule
  changes, duplicated legacy screen implementations, unrelated navigation work.

## Decided

Milestone D1–D7 and T01's accepted target govern. Reuse existing UI tokens and
primitives. `/progress` replaces its alias-owned landing; `/stats-history` and
its valid period/breakdown entry context remain supported. Retain required
Sessions/exercise browsing access through the accepted design.

## Deliverables and acceptance

1. `Muscle | Now | Previous | Change` table groups individual rows under static
   taxonomy headings. Names wrap, numbers align without compaction, every
   interactive target is >=44pt, and long content scrolls above the fixed tabs.
   Working sets initially; Volume retains correct units, baseline/coverage copy.
   Metric explanations respect saved eligibility rather than unconditionally
   excluding warm-ups or implying Volume is limited to working sets.
2. Selecting a muscle renders one contribution table below, by exercise, with
   both periods, change and a non-interactive Total. Previous-only and zero rows
   work; an all-zero selected muscle shows a specific empty explanation.
3. Name presses open only the individual muscle/exercise heatmap. Selection and
   history actions are disjoint in touch and accessibility. Family headings
   remain inert; any family expansion used only for layout has no history action.
4. Sheets consume the preference established by T03. Opening/dismissing history
   preserves selection, period, metric and list position. Table selection is
   independent from the sheet's transient metric/day/week selection.
5. Keep landed period choices/comparison bounds, look-back and unrelated
   Settings values, including independent Working set/Volume eligibility.
   Refocus after eligibility changes refreshes table, contributions and history
   under the same durable active policy; volume-only rows remain available.
   No stale contribution/history data under a newly selected name or account,
   no premature empty state during loading, and a retry does not erase the
   user's selection. Return after edits refreshes derived values.
6. Real-data Jest screen tests prove one happy path and error/empty paths,
   selection vs name taps, family inertness, contribution reconciliation,
   previous-only exercises, Working sets/Volume, valid legacy entry parameters,
   sheet restoration, rapid switches and individual Daily/saved Weekly history.
   Include saved custom eligibility, volume-only rows and Settings/refocus
   recalculation with reconciled muscle/contribution totals in both periods.
   Remove obsolete UI assertions instead of retaining two landing variants.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Compare work | Open Progress; choose available period/metric | Exact aligned current/previous values; all relevant muscles visible | Loading/error/Retry clear; no available data remains distinct from zero |
| Explain a muscle | Select a muscle, scroll to contributions | Rows and Total reconcile; role captions do not weight sets | Previous-only exercise shown; all-zero explanation; stale requests ignored |
| Read history | Press a muscle/exercise name, select a day/week, dismiss | One entity in saved view; underlying table context retained | Group name inert; load failure recoverable; no view toggle |

## Specs to update

- `docs/specs/ui/screen-map.md`, `ux-rules.md`, `navigation-contract.md`: the
  shipped landing, two independent actions, legacy route and preserved entryways.
- T01's accepted target record: implemented states and intentional deviations.
- `components-catalog.md` only if a reusable primitive API changes; prefer a
  feature table over an unsolicited new global primitive.

## Gates

Mandatory `fast`; UI default `frontend-ui` (root stack/access changes would raise
the default to `frontend`, so avoid unrelated wiring). Query `./boga test for`
and agree the actual smallest lane set with the operator before extra lanes.
Capture relevant accepted states on small/large iPhones and compare with T01.
No new Maestro flow without a device-only claim and approval. Finish with
`jest-coverage`, `complexity`, `dependencies`. Delete this card and mark T04
completed in its PR.
