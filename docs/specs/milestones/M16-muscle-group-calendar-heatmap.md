# M16 - Muscle Group Calendar Heatmap

## Milestone metadata

- Milestone ID: `M16`
- Title: Muscle group calendar heatmap
- Status: `in_progress`

## Parent references

- Project directives: `docs/specs/README.md`
- Product overview: `docs/specs/00-product.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- AI development playbook: `docs/specs/04-ai-development-playbook.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- Worktree/runtime isolation: `docs/specs/12-worktree-config-and-isolation.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
- UI route semantics: `docs/specs/ui/ux-rules.md`
- UI screen map: `docs/specs/ui/screen-map.md`
- UI navigation contract: `docs/specs/ui/navigation-contract.md`
- UI components catalog: `docs/specs/ui/components-catalog.md`
- Human run/test/debug guide: `RUNBOOK.md`
- Planning source: GitHub Issue `https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/79`

## Milestone objective

Add a muscle-group history overlay from the existing `Stats / History` muscle table. A user can tap a muscle group, inspect an 8-visible-week Monday-start calendar heatmap showing when that muscle was trained and how strongly, then tap a day to see the contributing exercises and sets.

The milestone must avoid a second analytics model. The existing Stats muscle calculation should be extracted into a shared muscle analytics engine and reused by both the current Stats summary and the new heatmap daily series, so future scoring changes affect both surfaces from one implementation point.

## Product / UX contract

### Entry flow

- Trigger: user opens `Stats / History` and taps a muscle group row.
- Steps:
  - tap an expanded muscle row, or tap a collapsed single-muscle family header such as `Chest`;
  - the app opens an in-route overlay card for that muscle group.
- Success outcome:
  - overlay title reflects the selected muscle, for example `Chest history`;
  - latest weeks are visible first.
- Failure/edge outcome:
  - if the heatmap cannot load, show an inline overlay error and keep dismiss/backdrop behavior available.

### Heatmap browsing flow

- Trigger: muscle history overlay opens.
- Steps:
  - display a 7-column calendar grid with labels `Mon Tue Wed Thu Fri Sat Sun`;
  - display 8 week rows in the initial visible area;
  - allow vertical scrolling to older history, with latest weeks first at overlay open.
- Success outcome:
  - each cell represents one local calendar date;
  - cells use green intensity buckets based on the shared Stats muscle analytics score;
  - today's date has a light blue highlight independent of the green effort bucket.
- Failure/edge outcome:
  - days without selected-muscle effort remain neutral and tappable;
  - empty history shows a clear empty state without hiding the calendar structure unless no meaningful grid can be rendered.

### Selected-day detail flow

- Trigger: user taps a heatmap cell.
- Steps:
  - mark the selected cell;
  - show details for that local date inside the overlay.
- Success outcome:
  - detail panel shows date, selected muscle group, effort score/bucket, contributing exercises, and sets.
- Failure/edge outcome:
  - if no selected-muscle training exists for that date, show a clear empty state for that date.

### Overlay behavior

- Trigger: overlay is open.
- Steps:
  - card occupies roughly 75% of the screen height;
  - tapping outside the card dismisses it;
  - internal content scrolls vertically.
- Success outcome:
  - the user can inspect history without leaving `Stats / History`.
- Failure/edge outcome:
  - overlay dismissal never mutates session, exercise, tag, or sync data.

## In scope

- Refactor the current Stats muscle aggregation into a shared local analytics module.
- Preserve existing Stats summary behavior while moving it to the shared engine.
- Add a daily muscle effort series over local completed-session history.
- Add a reusable heatmap UI component suitable for the muscle history overlay.
- Make muscle rows and collapsed single-muscle family headers actionable in `Stats / History`.
- Show a selected-day detail panel with contributing exercises and sets.
- Update relevant UI docs for the new overlay, actionable muscle rows, and reusable component inventory.
- Add deterministic tests for date alignment, aggregation, rendering states, and interaction flows.

## Out of scope

- New persistent tables or materialized analytics caches.
- Backend, Supabase, sync, or RLS changes.
- Advanced fatigue modelling, RPE modelling, or recovery recommendations.
- Cross-muscle comparison views.
- Animations.
- Social/sharing features.
- Certification workflow changes.
- Displaying certification data before a real certification schema/source exists.

## Shared analytics engine contract

Create one canonical muscle analytics engine for both the Stats table and the heatmap. Suggested location:

```text
apps/mobile/src/data/muscle-analytics.ts
```

The exact file can change if an implementation agent finds a better existing home, but the boundary should stay explicit: data loading may remain in repository modules, while contribution math and pure aggregation live in a shared module.

### Current Stats scoring behavior to preserve

As of this milestone plan, existing Stats muscle totals are derived from:

1. completed, non-deleted sessions only;
2. non-warm-up exercise sets only;
3. valid parsed set volume using existing calculation helpers (`weight * reps` through the current helper path);
4. exercise-to-muscle mappings;
5. primary contribution weight `1`;
6. secondary contribution weight `0.5`;
7. stabilizer contribution weight `0`.

Existing mapping rows also store a numeric `weight`; the refactor task must confirm whether the current Stats behavior should continue deriving contribution from `role` or should switch to the stored mapping `weight`. Do not change the Stats result accidentally while extracting the shared engine.

### Required shared outputs

The shared engine should support both:

1. period summary aggregation for the current Stats muscle table;
2. daily aggregation for one selected muscle group for the heatmap.

Both outputs must use the same contribution helper so later score changes are made once.

M16-T02 implementation API:

- pure shared contribution and daily aggregation live in `apps/mobile/src/data/muscle-analytics.ts`;
- current Stats period totals reuse `collectMuscleSetContributions(...)`;
- selected-muscle daily heatmap data is exposed through `aggregateSelectedMuscleDailyEffort(...)` for pure callers and `computeSelectedMuscleDailyEffort({ muscleGroupId, start, end, timeZone? })` for local completed-session repository loading;
- `timeZone` is optional and defaults to the runtime local timezone; tests pass an explicit IANA timezone for deterministic local-date assertions.

### Data model / sync impact

M16 v1 has no planned schema changes.

Sync impact decision: `out of sync scope`.

Reason:

- the heatmap is a read-only derived local analytics view over existing synced/local user-domain entities;
- no new user-authored data, durable preference, or backend projection is introduced;
- existing session, exercise, set, and muscle-mapping sync behavior remains unchanged.

If any implementation task adds persisted analytics state, a durable selected-muscle preference, certification fields, or new entity relationships, that task must reopen the data-model sync gate and update `docs/specs/05-data-model.md` plus relevant sync contracts in the same session.

## Heatmap behavior

1. Week starts on Monday.
2. Columns are Monday through Sunday, labels displayed across the top.
3. Initial view shows the latest 8 week rows.
4. The overlay content scrolls vertically to older history.
5. Today's date receives a light blue highlight that remains visible for zero-effort and effort cells.
6. Effort color uses neutral for zero and green buckets for positive effort.
7. Bucket thresholds should be simple and explainable in v1.
8. Bucket normalization must not shift colors while the user scrolls the same loaded history window.
9. Tapping a cell updates the selected-day detail panel.
10. Detail rows should show enough set information to explain the score without duplicating the full completed-session screen.

## Certification consideration

Issue 79 asks for certified data to be visually distinguishable where appropriate. The current repo scan for this planning session did not find an implemented certification data model.

M16 v1 should therefore:

- avoid fake certification state;
- design the detail-row shape with an optional certification marker field if it can be done without schema changes;
- render certification markers only when a real source exists;
- keep certification workflow and immutability rules out of scope.

## Deliverables

1. Shared muscle analytics engine used by both Stats summary and heatmap daily aggregation.
2. Muscle-group heatmap overlay launched from `Stats / History`.
3. Selected-day detail panel explaining the selected date's effort.
4. Focused tests for analytics, date layout, UI rendering, interactions, and edge states.
5. Updated UI docs and milestone closeout evidence.

## Acceptance criteria

1. Existing Stats muscle table behavior is preserved after the shared analytics refactor.
2. Heatmap daily effort uses the same contribution helper as Stats muscle totals.
3. `Stats / History` muscle rows are actionable, including collapsed single-muscle family headers.
4. Overlay opens in-route, starts at latest weeks, occupies roughly 75% screen height, scrolls vertically, and dismisses on backdrop press.
5. Heatmap uses Monday-start columns and shows 8 visible week rows at initial open.
6. Today is lightly highlighted with a blue treatment separate from green effort intensity.
7. Cell selection renders an explanatory date detail panel.
8. Empty/no-training dates have clear feedback.
9. Date alignment is deterministic across month boundaries and Monday/Sunday edges.
10. Multiple sessions on the same date aggregate into one cell.
11. Exercises contributing to multiple muscles contribute according to the shared Stats muscle contribution math.
12. Warm-up and invalid sets follow existing Stats semantics.
13. No raw color literals are introduced in screen/component `.tsx` files unless explicitly allowlisted with rationale.
14. Relevant UI docs are updated in the same task that changes UI semantics, navigation behavior, or reusable component inventory.
15. No backend/sync/data-model change is introduced for v1 unless a task explicitly reopens the sync gate.

## Task breakdown

1. `docs/tasks/M16-T01-muscle-heatmap-milestone-spec.md` - create this milestone spec and lock the shared-analytics decision. (`planned`)
2. `docs/tasks/complete/M16-T02-shared-muscle-analytics-engine.md` - extract current Stats muscle contribution math into a shared analytics engine, preserve Stats behavior with tests, and add daily selected-muscle aggregation. (`completed`)
3. `docs/tasks/complete/M16-T03-calendar-heatmap-component.md` - build the reusable heatmap component with Monday-start columns, 8 visible week rows, vertical scrolling, bucket styling, today highlight, selection, and accessibility labels. (`completed`)
4. `docs/tasks/complete/M16-T04-stats-history-muscle-overlay.md` - make Stats muscle rows actionable, load heatmap data, show the overlay card, wire loading/error/empty states, and update UI docs. (`completed`)
5. `docs/tasks/complete/M16-T05-selected-day-detail-panel.md` - add selected-day detail content with contributing exercises/sets and empty-day handling. (`completed`)
6. `docs/tasks/M16-T06-qa-visual-evidence-and-doc-closeout.md` - run final integration/visual QA, capture required evidence, update closeout docs, and close the milestone when complete. (`planned`)

## Dependencies and parallelization

- `M16-T01` must land first.
- `M16-T02` and `M16-T03` can run in parallel after `T01`.
- `M16-T04` depends on `T02` and `T03`.
- `M16-T05` depends on `T02` and should integrate after `T04` establishes overlay state.
- `M16-T06` depends on all implementation tasks.

Suggested branch names:

- `codex/m16-t02-shared-muscle-analytics`
- `codex/m16-t03-calendar-heatmap-component`
- `codex/m16-t04-stats-history-muscle-overlay`
- `codex/m16-t05-selected-day-detail`
- `codex/m16-t06-qa-doc-closeout`

## Testing / verification expectations

Default local fast gate for implementation tasks:

```bash
./scripts/quality-fast.sh frontend
```

Targeted tests should be added and run during development before the full fast gate.

Required coverage:

- shared analytics preserves existing Stats period totals;
- daily aggregation groups by local calendar date;
- Monday-start week layout, including month/year boundaries;
- 8 visible week rows in the initial heatmap component state;
- multiple sessions on the same date;
- mixed exercises contributing to multiple muscles;
- warm-up exclusion and invalid set handling according to existing Stats behavior;
- zero-effort dates and no-history states;
- overlay open, cell select, selected-day detail, error state, and backdrop dismiss;
- today highlight rendering semantics.

Slow frontend gate posture:

- `./scripts/quality-slow.sh frontend` is not mandatory for every M16 task by default.
- Require it for milestone closeout or any task that adds/changes Maestro flows, native runtime assumptions, fixture seeding, or simulator-dependent visual evidence.

Visual evidence:

- UI implementation tasks must capture screenshots or equivalent simulator evidence for populated heatmap, empty/no-training state, selected-day details, and error state when feasible.

## Docs maintenance expectations

Implementation tasks should update these docs when their maintenance triggers fire:

- `docs/specs/ui/ux-rules.md` for new overlay/actionable muscle-row semantics and heatmap/detail state behavior.
- `docs/specs/ui/screen-map.md` for the new `Stats / History` overlay state.
- `docs/specs/ui/components-catalog.md` if a reusable heatmap component is added under `apps/mobile/components/**`.
- `docs/specs/ui/navigation-contract.md` only if the implementation adds route paths, query params, or navigation transitions. The planned v1 overlay should not require this.
- `docs/specs/05-data-model.md` only if a task introduces a persisted data-model or sync-scope change. Planned v1 should not.
- `RUNBOOK.md` only if local run/test/debug commands or artifact locations change. Planned v1 should not.

## Risks / open questions

- Current Stats aggregation appears role-based while mapping rows also have numeric `weight`; the shared-engine task must preserve current behavior first, then document any intentional switch separately.
- Local date bucketing can be subtle around timezone, daylight-saving, and completed-at boundaries; keep this logic pure and well tested.
- A large all-history daily aggregation may become expensive on older devices; v1 can cap the loaded history window if needed, but the cap must be documented and not affect visible scrolling unexpectedly.
- Overlay density on small phones may need iteration to keep 7 columns readable without horizontal scrolling.
- Certification display depends on a future real data source; do not imply certified state exists until it does.

## Completion note (fill when milestone closes)

- What changed:
- Verification summary:
- What remains:

## Status update checklist (mandatory during task closeout)

- Keep milestone `Status` current as tasks progress.
- Update task breakdown entries to reflect each task state (`planned | in_progress | completed | blocked | outdated`).
- If milestone remains open after a session, record why in the active task completion note and/or milestone completion note (status remains `in_progress`).
- Move completed task cards to `docs/tasks/complete/` and update references here.
