---
task_id: M26-T04-Rehome_existing_Progress_surfaces
milestone_id: "M26"
status: planned
ui_impact: "yes"
areas: "docs|frontend"
runtimes: "docs|node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md"
---

# M26-T04 — Rehome existing Progress surfaces

## Task metadata

- Status: `planned`
- Session interaction mode: `interactive`
- Parent milestone: `docs/plans/milestones/M26-four-tab-navigation.md`
- Depends on: M26-T01
- UI Impact: `yes`

## Context freshness at task start

- Run the task bootstrap helper and record branch/HEAD.
- Reread required specs and the relevant test README.
- Inventory the current `stats-history.tsx`, `/sessions`, `/exercise-history`,
  muscle overlay, `DailyHeatmap`, and `WeeklyHeatmap` before edits.

## Objective

Make Progress the canonical entry to current history and analytics without
adding, replacing, or semantically changing any metric.

## Figma guidance

- [Primary prototype](https://www.figma.com/proto/mrItXBs0wGf0mHEJy8fPqQ/BOGA-%C2%B7-Scalable-navigation-proposals?node-id=0-1&p=f&t=semh9yQSkSY6O3h6-0&scaling=min-zoom&content-scaling=fixed&starting-point-node-id=8%3A737&show-proto-sidebar=1)
- Frames: `03 Progress · Dashboard`, `09 Progress · Exercise heat map`,
  `10 Progress · Session history`.
- Hard constraint: implementation truth is the existing dashboard/heat-map
  code. Prototype-only trend lines, milestone cards, or metrics are prohibited.

## UX contract

### Inspect current dashboard

- Trigger: open Progress.
- Steps: select existing time range and exercise/muscle breakdown controls.
- Success outcome: current metrics and tables render with unchanged semantics.
- Failure/edge outcome: empty/error/loading states match the current dashboard.

### Drill into history

- Trigger: press Sessions, an exercise, a muscle, or a history row.
- Steps: follow existing routes/overlays and use their current filters.
- Success outcome: full sessions and daily/weekly heat maps remain reachable.
- Failure/edge outcome: invalid/missing IDs retain the current safe error state.

## Scope

- Add/canonicalize the Progress tab route and header context.
- Reuse or move current Stats / History composition without data-model changes.
- Preserve session-history and exercise/muscle drill-down behavior.
- Add route compatibility coverage for `/stats-history`.

Out of scope: new analytics, redesigned charts, new aggregation queries, or
changes to calculation semantics.

## Acceptance criteria

1. Progress exposes every existing Stats / History control and result.
2. Sessions, sets, volume/1RM/top-weight facts, exercise/muscle breakdowns, and
   current comparisons retain their source semantics.
3. Existing daily/weekly heat maps and their metric toggles remain reachable.
4. `/sessions`, completed-session details, and exercise-history filters/back
   behavior continue to work.
5. No new metric, milestone, trend, or analytics query is introduced.
6. Snapshot/behavior tests demonstrate parity with the pre-migration surface.
7. Visual evidence covers dashboard, full history, and at least one heat map.

## Implementation notes

- Prefer a thin `/progress` route that composes/extracts the existing screen
  over copying `stats-history.tsx`.
- Keep reusable analytics components route-neutral where practical.
- Preserve legacy path behavior until T06 defines the final adapter/redirect.

## Verification

- Unit/integration: time range, breakdown, sessions drill-down, exercise/muscle
  route or overlay, invalid ID, legacy path.
- Maestro: Progress -> sessions -> detail; Progress -> exercise heat map.
- Gates: `./boga test fast`, `./boga test frontend`, plus path-triggered lanes.

## Completion note

- What changed:
- What tests ran:
- Visual evidence:
- What remains:
