---
task_id: T-20260624-01-shared-exercise-list-controls
milestone_id: "MVP"
status: completed
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/ux-rules.md, docs/specs/ui/screen-map.md, docs/specs/ui/components-catalog.md"
---

# Shared Exercise List Controls

## Task metadata

- Task ID: `T-20260624-01-shared-exercise-list-controls`
- Title: Shared Exercise List Controls
- Status: `completed`
- Session date: 2026-06-24
- Session interaction mode: `interactive`

## Parent references

- Project directives: `docs/specs/README.md`
- Milestone spec: N/A - user-requested UX improvement, no milestone spec.
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`

## Context Freshness

- Verified current branch + HEAD commit: pending at implementation start.
- Start-of-session sync with `origin/main` completed?: pending at implementation start.
- Parent refs opened in planning session:
  - `docs/specs/02-quality-and-test-gates.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/navigation-contract.md`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/templates/task-card-template.md`
- Code/docs inventory freshness checks run:
  - `rg` inventory for exercise picker/catalog/session-recorder paths, 2026-06-24.
  - Existing catalog stats/cache and exercise search modules reviewed, 2026-06-24.
- Known stale references or assumptions: none known; re-check source at implementation start.

## Objective

Create one shared exercise-list behavior surface for Exercise Catalog and the
session-recorder exercise picker: grouping, date range, recents sorting, row
stats, filtering, and local-only persisted preferences should behave consistently
across both features.

## Scope

### In scope

- Extract or introduce shared exercise list model/component code used by both
  `apps/mobile/app/(tabs)/exercise-catalog.tsx` and the recorder picker.
- Add local-only shared preferences for:
  - grouping on/off, default on;
  - date range, default `90d`;
  - recents-on-top, default on.
- Add date range options: `7d`, `30d`, `90d`, `1y`, `All`.
- Sort exercises by recency-weighted completed-set score when recents-on-top is
  enabled.
- Use the selected finite date range as the scoring window; for `All`, score only
  sets from the last year, then place all other exercises alphabetically.
- Use a fixed 60-day exponential half-life for scoring across all ranges.
- Group by the exercise primary muscle mapping's `familyName`, with `Other` for
  exercises without a primary muscle.
- Keep filtering behavior without flattening grouped layout.
- Add collapsible group sections in both catalog and recorder picker.
- Show matching catalog stats in recorder picker rows.

### Out of scope

- Recorder-specific add/preselection behavior; handled by
  `T-20260624-02-recorder-picker-preselection`.
- Syncing list preferences across devices.
- New data-model columns or Supabase migrations.
- Reworking exercise taxonomy or muscle mapping semantics.

## UI Impact

- UI Impact?: `yes`
- Reuse existing tokens/primitives from `apps/mobile/components/ui/`.
- No raw color literals should be introduced in screen/component `.tsx` files.
- UI docs update is required because current Exercise Catalog and recorder
  picker semantics change.

## UX Contract

### Key user flows

1. Flow name: Shared Exercise List Preferences
   - Trigger: user opens Exercise Catalog or the recorder exercise picker.
   - Steps: user opens the options/filter surface and changes grouping, date
     range, or recents-on-top.
   - Success outcome: the setting persists locally and is reflected in both
     Exercise Catalog and the recorder picker.
   - Failure/edge outcome: if no saved preference exists, defaults are grouping
     on, `90d`, and recents-on-top on.
2. Flow name: Grouped Exercise Browsing
   - Trigger: grouping is enabled.
   - Steps: macro muscle group headers render in taxonomy order with counts;
     user taps a non-empty header to expand/collapse.
   - Success outcome: visible exercises stay grouped and sorted by the selected
     recents/alphabetical rules.
   - Failure/edge outcome: zero-count groups remain visible with count `0`,
     appear collapsed, and tapping them does nothing.
3. Flow name: Filtered Exercise Browsing
   - Trigger: user types in the search/filter input.
   - Steps: matching exercises are filtered using the existing exercise name and
     primary-muscle metadata behavior.
   - Success outcome: grouping state is preserved when grouping is on; flat mode
     stays flat when grouping is off.
   - Failure/edge outcome: collapsed group state is respected even while search
     text is active.

### Interaction + appearance notes

- The options/filter surface should be shared where practical; the recorder
  picker hides catalog-only controls.
- Group headers show `Family · count` only; no chevron and no `Show`/`Hide` text.
- Initial group state is collapsed; expanded/collapsed state is in-memory per
  surface and is not persisted.
- Flat mode renders a plain list without an `All exercises` header.
- Recorder picker rows should match Exercise Catalog row information where
  practical, but recorder rows do not expose catalog edit/delete actions.

## Acceptance criteria

1. Exercise Catalog and recorder picker use shared code for grouping, filtering,
   date range, recents sorting, and row stats where practical.
2. Shared local-only preferences persist across both surfaces:
   grouping on/off, date range, and recents-on-top.
3. Defaults are grouping on, date range `90d`, and recents-on-top on.
4. Date range options are `7d`, `30d`, `90d`, `1y`, and `All`.
5. Recents scoring counts valid completed sets only, including warm-up sets.
6. Active drafts, planned-but-unperformed rows, and deleted/tombstoned rows do
   not contribute to recents scoring.
7. Completed sessions created from performed planned rows count normally.
8. Scoring uses a fixed 60-day exponential half-life and selected range window;
   `All` uses a last-year scoring cap.
9. Recents sort tie-breaks by most recent completed use, then exercise name.
10. Recents-off sort is alphabetical inside grouped and flat layouts.
11. Group order follows taxonomy order: Chest, Shoulders, Back, Arms, Core,
    Legs, Lower Legs, then Other.
12. Group counts reflect visible exercises after filters/search.
13. Zero-count groups remain visible, collapsed, and non-interactive.
14. Exercise Catalog row stats use the selected date range and default to `90d`.
15. Recorder picker rows show the same stats line as Exercise Catalog rows.
16. Catalog-only filters remain catalog-only; recorder picker hides deleted
    exercises and keeps never-done exercises visible by default.
17. Screen UI uses documented tokens/primitives/shared components for common
    buttons/text/layout/list patterns, or records a justified exception.
18. No raw color literals are introduced in screen files unless explicitly
    allowed by the task and documented with rationale.
19. Relevant `docs/specs/ui/*.md` docs are updated in the same task.

## Docs touched

- `docs/specs/ui/ux-rules.md` - update picker/catalog list semantics,
  preferences, grouping, filtering, and row behavior.
- `docs/specs/ui/screen-map.md` - update Exercise Catalog and recorder picker
  screen state summaries.
- `docs/specs/ui/components-catalog.md` - update if a reusable exercise-list
  component or preference/control component is introduced.
- `docs/specs/ui/navigation-contract.md` - no update expected unless route/query
  behavior changes.
- UI docs update required?: `yes`
- Tokens/primitives compliance statement:
  - Reuse plan: existing `uiColors` tokens and current list/modal button
    patterns.
  - Exceptions: none planned.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md`: `yes`.
  - Planned captures/artifacts: Exercise Catalog grouped/flat states and
    recorder picker grouped/flat states, including zero-count group behavior.

## Testing and verification approach

- Planned checks/commands:
  - Targeted Jest for exercise catalog stats/search/list behavior.
  - Targeted React Native tests for Exercise Catalog and session recorder picker.
  - `./boga test fast`
  - `./boga test frontend`
- Test layers covered: unit, component interaction, Maestro frontend gate.
- Slow-gate triggers: mobile UI screen/component changes require frontend gate.
- CI/manual posture note: frontend Maestro lanes are local-only and must be run
  locally before PR.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/app/(tabs)/exercise-catalog.tsx`
  - `apps/mobile/app/(tabs)/session-recorder.tsx`
  - `apps/mobile/src/exercise-catalog/**`
  - `apps/mobile/src/data/exercise-catalog-stats.ts`
  - shared component path under `apps/mobile/components/**` if needed.
- Project structure impact: no new top-level paths expected.
- Constraints/assumptions:
  - Preferences are local-only and out of sync scope.
  - Avoid adding new database schema unless implementation proves existing
    storage patterns cannot support the preference.

## Mandatory verify gates

- Standard local fast gate: `./boga test fast`
- Standard local slow gate: `./boga test frontend`
- Additional gate(s): run `./boga test for` before closeout to confirm required
  lanes from the final diff.

## Evidence

- Targeted Jest for the combined exercise-list/recorder changes passed:
  7 suites, 102 tests.
- `./boga test fast` passed.
- `./boga test backend` passed.
- `./boga test docs-check` passed.
- `./boga test meta-tests` passed.
- `./boga doctor` passed after restarting Docker Desktop.
- `./boga test frontend` passed:
  - `ios-smoke`: `apps/mobile/artifacts/maestro/ad-hoc/20260624-151246-13257`
  - `ios-data-smoke`: `apps/mobile/artifacts/maestro/ad-hoc/20260624-151334-14376`
  - `ios-auth-profile`: `apps/mobile/artifacts/maestro/ad-hoc/20260624-151501-15809`
  - `ios-sync-e2e`: `apps/mobile/artifacts/maestro/ad-hoc/20260624-151648-17338`
- UI/UX task visual artifacts note: Maestro artifacts above cover the required
  simulator interaction evidence for shared picker/catalog behavior.
- Manual verification summary:
  - Frontend Maestro lanes were run locally because
  they are local-only.

## Completion note

- What changed: added shared exercise list preferences/model/controls for
  Exercise Catalog and recorder picker, with grouped macro-family sections,
  date range, recents sorting, shared row stats, and matching UI docs/tests.
- What tests ran: targeted Jest, `./boga test fast`, `./boga test backend`,
  `./boga test docs-check`, `./boga test meta-tests`, `./boga doctor`, and
  `./boga test frontend`.
- What remains: no implementation follow-up for this task.

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to
  `docs/tasks/complete/`.
- Fill completion note and evidence.
- Update relevant UI docs.
- Run `./scripts/task-closeout-check.sh <task-card-path>` or document why N/A.
