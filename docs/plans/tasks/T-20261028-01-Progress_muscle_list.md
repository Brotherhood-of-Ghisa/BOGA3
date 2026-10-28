# T-20261028-01 — Align Progress Muscle List with Exercise List

- Status: `in_progress`
- Depends on: none
- Milestone: none
- Areas: frontend; UI impact: yes

## Objective

Remove the small charts from Progress's List view by Muscle and adopt the
existing List view by Exercise as the design reference. Make the comparison
easier to scan while preserving muscle history and contribution disclosure.

## Scope and decisions

- Remove mini charts for both Sets and Volume.
- Adopt Exercise's separate Now / Prev / Change columns, sortable headers,
  typography, row spacing and responsive stacking. Keep a separate trailing
  contribution chevron, and align expanded contributors with their muscle.
- Keep muscle names as history links and chevrons as contribution toggles.
- Preserve the saved family-grouping default and each breakdown's per-visit
  Filters override, search, sort state, period, gym and secondary-set choices.
- Preserve Detailed/Broad muscle reporting, calculations, history and 3D.
- Reuse the existing comparison and table primitives. Remove newly unused
  ticker reads, rendering, helpers, exports, tests and fixtures after checking
  every caller; retain any shared history functionality still in use.
- No new dependency, migration, setting or Maestro scenario.

## Design target and open questions

Repo-native target: the current Progress List by Exercise, captured in the
running app before changing the layout. The separate muscle chevron is an
intentional difference. The user approved the columns/spacing and retained
interactions in this conversation. No product questions remain open.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Compare muscles | Open Progress, List, Muscle; switch Sets/Volume and sort each header | Separate aligned Now/Prev/Change figures, no mini charts | Small phones, long names and large figures remain readable using the Exercise fallback; existing empty/loading/error states remain usable |
| Inspect a muscle | Tap its name; return; tap its chevron | History keeps the selected context; contributors expand/collapse without navigating | No contributors shows the existing empty state; name and chevron remain separate accessible tap targets |
| Group and filter | Open on Settings defaults; change grouping/search/gym/secondary sets | Existing family sections and figures follow those choices | No search matches shows its existing empty state; switching breakdowns preserves each view's visit state |

## Deliverables and acceptance

1. Implement the agreed layout and remove chart-only plumbing completely.
2. Update real-data Jest coverage for columns, sorting, grouping defaults and
   overrides, history, contributors, empty/error states and chart absence.
   Retain regressions for shared Exercise, history and 3D paths.
3. Update the owning Progress screen documentation and source comments.
   Product facts: presentation change only; no calculation or grouping-rule
   change. Run the independent product review and record any fact decision.
4. Capture Exercise reference and changed Muscle states on small and large
   iOS phones; check both metrics, grouping, expanded and empty states.
5. Independent code and product reviews are clean; all selected local gates
   and PR CI are green before reporting readiness.
6. Delete this ephemeral card in the shipping change; preserve it in git
   history. Do not reference its path or ID from persistent code/docs.

## Gates and review

Default: `fast` + `frontend-ui`. Proposed minimum iOS lanes: `ios-smoke` and
`ios-data-smoke` (the latter includes muscle reporting); the independent
reviewer agrees the final set after `./boga test for`. Run `jest-coverage`,
`complexity` and `dependencies` once on the finished change as required.
Record output, screenshots, lane agreement and review verdicts in the PR.
No PR until the parent reviewer is satisfied. The human will merge it.
