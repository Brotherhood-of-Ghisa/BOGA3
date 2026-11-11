# M42-T05 — Heatmap injury overlay and reload analytics

- Status: `planned`
- Depends on: [M42-T01](M42-T01-Injury_contract_and_sync_schema.md), [M42-T02](M42-T02-Mobile_injury_management_ui.md), [M42-T04](M42-T04-Set_rehab_tagging_and_metric_protection.md)
- Milestone: [M42](../milestones/M42-injury-and-discomfort-tracking.md)
- Areas: frontend UI, stats, analytics; UI impact: yes

## Objective and scope

Overlay active injuries onto the 3D/2D muscle heatmap mesh and provide a tissue
reload monitoring card in Progress / Recovery to track gradual load tolerance
on injured structures. Follow milestone D1 and D5. This task does not touch
the MCP server or backend sync RPCs.

## Baseline to verify

Inspect `apps/mobile/components/stats/muscle-body-projection.ts`,
`muscle-body-card.tsx`, `muscle-map-reference.ts`, and
`apps/mobile/components/stats/progress-muscle-view.tsx`. Review theme token
conventions in `components/ui/tokens.ts`.

## Open — resolve before coding

- Visual rendering of injured muscles:
  - Contrast styling: amber/coral border, hatch pattern, or subtle pulse on
    faces matching the injured `muscle_group_id` and `side`.
  - Distinguish `acute` (high vigilance highlight) from `managing` /
    `monitoring` (subtle badge or contour).
- Tissue Reload card in Progress:
  - Weekly working sets and rehab volume accumulated on the injured muscle group.
  - Recovery trend comparing current weekly sets to 4-week pre-injury baseline
    average.
  - Caution indicator: alerts if weekly set volume spikes >30% over the 4-week
    pre-injury baseline average, gated by an absolute volume floor (minimum $\ge 6$
    sets) to prevent false alerts on trivial volume changes.

## Deliverables and acceptance

1. Extend `muscle-body-projection.ts` and `muscle-body-card.tsx` to accept an
   active injury overlay mapping.
2. Render injury badges and highlighted contours on the 3D muscle mesh across
   light and dark theme modes.
3. Implement "Tissue Reloading" card in Progress/Recovery showing weekly sets
   on recovering muscles.
4. Unit, projection, and visual regression tests across orientation (front/back)
   and theme modes.

## Gates

Expected from `./boga test for`:
`fast` | `frontend-ui` (or platform default)
