# M30-T03-Sets_mean_working_sets — An unqualified "Sets" means working sets

- Status: `planned`
- Depends on: `M30-T02-Working_set_measures`
- Milestone: `docs/plans/milestones/M30-working-sets-only-stats.md`
- Areas: frontend (counts and labels); UI impact: yes

## Objective

Every set count the app shows without a qualifier is working sets, labelled
`Sets` (M30 D4). The `N (W)` pairs and the separate working-set figures
collapse into that one count.

## Scope

- In:
  - Progress (`stats-history.tsx`): the summary `Sets (W/Sets)`, family and
    muscle rows, the exercise table and its sort modes, their a11y labels and
    `formatSetCountPair`.
  - The heatmap metric `W/sets` → `Sets` (`history-sheet.tsx`).
  - The exercise history card: header `N sets` and the `W/sets` stat.
  - The session list, History cards and Today recents (`countConfirmedSessionSets`).
  - The session view summary `Sets`, the View Session `Sets` fact and cards.
  - The completion screen (drop the `Working` fact), the share image, and the
    comparison cards (`· W working`).
  - The group friend session `Sets` and the stream card `N sets`
    (`groups/session-metrics.ts`).
  - The records panel's `Vol` detail: done in T01 (the volume record and its
    "N sets" count the record session's working sets); nothing left here.
  - The aggregator fields that become redundant (`setCount` vs
    `workingSetCount`): keep one.
  - Specs: `ux-rules.md` :297–347, :621–668 and :685–688; `screen-map.md`
    :163–180 and :441; `design-targets/progress.md` :80–82;
    `groups-contract.md` :1317; plus the Maestro flows that assert these labels.
- Out:
  - Row progress `n/m sets done` and the remove-exercise alert (row counts, not
    stats; M30 Scope).
  - Values other than counts (T02).

## Decided

- M30 D4.
- The design is the shipped screens with the pair or second figure removed. No
  new design target, so record the screenshots per
  `docs/specs/ui/ai-design-policy.md`.

## Open — resolve with the user at session start

1. The Progress exercise-table sort: which of the two modes survives, and how a
   saved preference that pointed at the removed mode migrates.
2. Whether the muscle pills' "Working sets by muscle" heading becomes "Sets by
   muscle".

## Deliverables and acceptance

1. No screen shows both an all-sets and a working-sets count, and no unqualified
   count includes warm-ups.
2. Jest for each surface; the Maestro flows that assert set labels are updated
   (no new flows).
3. A screenshot gallery of the changed screens, before and after, in the PR.

## Specs to update

The lines listed under Scope.

## Gates

Expected from `./boga test for`: `fast` + `frontend-ui` + the area e2e lanes it
prints (groups stream). Before the PR: `jest-coverage`, `complexity` and
`dependencies`.
