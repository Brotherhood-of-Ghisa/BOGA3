# M29-T02-Today_progress_card — Rebuild Today around the Progress card

- Status: `planned`
- Depends on: `M29-T01-Progress_summary_data`
- Milestone: `docs/plans/milestones/M29-today-landing-page.md`
- Areas: frontend; UI impact: yes

## Objective

Today loses its title, its next-workout / active-workout card and its separate
recent-sessions list, and opens on the Progress card of `today-landing.md`:
the week figures with last-week bars, the month working-sets line against the
previous month, and the latest session with `All sessions`. The current Group
activity section stays as it is until T04.

## Scope

- In: `app/(tabs)/today.tsx`; a Progress card component and a small cumulative
  line chart (`react-native-svg`, already a dependency); the empty state; Jest;
  Maestro changes this forces; the Today docs.
- Out: the group card (T04); Train; the Progress and Sessions screens.

## Decided

- The target and brief: `docs/specs/ui/design-targets/today-landing.md`
  (Progress card, no title, no `accent`, `View progress` → Progress tab,
  `All sessions` → Sessions list, latest session → completed session).
- D2, D3, D5, D6 (milestone).
- No in-progress card on Today; Train owns resuming.

## Open — resolve with the user at session start

1. **Group tags on the latest session.** The device does not know which groups
   a session was shared to. Take them from the group stream's session item
   when signed in, or drop the tags from the row?
2. **Chart component.** A Today-only chart, or a reusable primitive in
   `components/ui/` (then `components-catalog.md`)?
3. **Maestro.** `session-view.yaml` asserts `today-recents-section` and
   captures `today-recents`: replace with the latest-session row, or let Jest
   own it (spec 06, "Maestro scope policy")? Which flow captures the new Today
   states for the gallery?
4. **Accessibility of the chart.** The summary sentence as the chart's label,
   or a hidden table?

## Deliverables and acceptance

1. Today renders the Progress card exactly per the brief, from T01's read.
2. Empty history shows the `Your week starts here` panel with `Open Train`.
3. Loading and error keep the existing `StatePanel` recipes.
4. The removed next-workout/plan card and recents list leave no dead code,
   testIDs or docs behind.
5. A rendered HTML gallery of the new states at 390pt, re-sent after each
   iteration, accepted by the user.

## UX contract (UI tasks only)

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Open progress | Tap `View progress` | Progress tab | — |
| Open sessions | Tap `All sessions` | Sessions list | — |
| Open latest | Tap the latest-session row | Completed session view | Deleted since load → reload |
| First run | No completed sessions | Empty panel, `Open Train` → Train | — |

## Specs to update

- `docs/specs/ui/screen-map.md`, `navigation-contract.md` (Today's sections
  and transitions), `ux-rules.md` (the Today rule and the counting rules).
- `docs/specs/ui/design-targets/today-train.md` — Today's states that no longer
  exist.

## Gates

Expected from `./boga test for`: `fast` + `frontend-ui` (+ the area lane it
prints); agree the set with the operator. Before the PR: `jest-coverage`,
`complexity`.
