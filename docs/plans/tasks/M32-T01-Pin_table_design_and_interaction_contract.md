# M32-T01 — Pin the table design and interaction contract

- Status: `planned`
- Depends on: planning PR merged; PR #497 landed (or equivalent on `origin/main`)
- Milestone: `docs/plans/milestones/M32-progress-tables-and-individual-history.md`
- Areas: docs, frontend design; UI impact: yes

## Objective

Pin an executable design brief for the chosen Progress table and contribution
states before changing the application. Incorporate the latest instruction:
individual names open heatmaps, while a separate muscle selection action shows
contributing exercises inline.

## Scope

- In: accepted target, UX contract, control/interaction wording, edge states.
- Out: production UI, new analytics, preference implementation, backend changes.

## Decided

Milestone D1–D7 govern. Use the two selected images under
`docs/plans/assets/M32-progress-tables/` as layout references. The written brief
governs tap behaviour, Daily default, existing period settings and metric rules.

## Open — resolve with the user at session start

- Pin a clear, >=44pt muscle selection affordance distinct from the name's
  heatmap action; avoid competing nested pressables.
- Reconcile reference controls with the landed calendar-week periods and shared
  target semantics from PR #497. Decide the compact presentation of retained
  exercise browsing/Sessions access without expanding the hero table.
- Resolve colours in the references against existing signed-delta token roles.
  Do not silently introduce a new data palette or destructive-red deltas.

## Deliverables and acceptance

1. A concise accepted target record under `docs/specs/ui/design-targets/`, linked
   from its UI index, marked as a replacement target awaiting implementation.
   Move only selected, necessary reference screenshots there; preserve native
   sources and remove the now-redundant planning image copies/links.
2. Final target states: default table, selected contributions, zero-current
   muscle with previous-only exercises, all-zero/no-history, loading/error,
   individual Daily history and a saved Weekly choice. Existing heatmaps may be
   referenced through their accepted repository target rather than redrawn.
3. Distinct selection/history hit targets, static family headings, non-action
   totals, readable wrapping numeric columns and scroll behaviour on small and
   large phones are specified. No runtime completion claim for unbuilt states.
4. Implementation tasks can consume the accepted record without reopening the
   agreed table direction or set-count definition.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Inspect contributions | Use a muscle's selection affordance; scroll to its exercise table | One selected muscle; both periods and Total reconcile | Zero-current exposes previous contributors; no data has an explicit empty state |
| Open history | Press an individual muscle/exercise name; dismiss its sheet | Exactly one entity; return to prior table state | Family label inert; no name/selection double action; failed history reads are inline |
| Respect saved view | Open history after selecting Daily/Weekly in Settings | Saved view and look-back apply; Daily for unset preference | No in-sheet view toggle; valid Weekly remains supported |

## Specs to update

- `docs/specs/ui/design-targets/` and `docs/specs/ui/README.md`: accepted replacement
  target only; do not prematurely label unimplemented semantics current.
- Current `ux-rules.md`, `screen-map.md` and `navigation-contract.md` are updated
  by the task that ships their behaviour.

## Gates

Docs-only scope: query `./boga test for`, propose the lane set and run fast.
Quality targets before the PR: `jest-coverage`, `complexity`, `dependencies`,
subject to the operator agreement required by AGENTS.md. No simulator lane for
design records alone; no new Maestro flow. Delete this card in its shipping PR.
