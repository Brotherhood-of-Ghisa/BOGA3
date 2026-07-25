---
task_id: M19-T10-Expose_per_side_volume_in_muscle_history
milestone_id: "M19"
status: completed
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo|maestro|docs"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/milestones/M19-per-side-muscle-volume.md, docs/specs/ui/screen-map.md, docs/specs/ui/ux-rules.md, apps/mobile/components/heatmaps/README.md"
---

# M19-T10-Expose_per_side_volume_in_muscle_history

## Task metadata

- Task ID: M19-T10-Expose_per_side_volume_in_muscle_history
- Title: Expose per-side volume in muscle history
- Status: `completed`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: 2026-07-24
- Session interaction mode: `interactive (default)`

## Parent references

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M19-per-side-muscle-volume.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Quality gates: `docs/specs/02-quality-and-test-gates.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
- Project structure: `docs/specs/09-project-structure.md`

## Context Freshness

- Verified current branch + HEAD commit: `codex/m19-muscle-history-volume` from `main` at `57e5a6f`.
- Start-of-session sync with `origin/main` completed?: `yes`; local `main` matched `origin/main` before branch creation.
- Parent refs opened in this session:
  - `docs/specs/02-quality-and-test-gates.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/11-maestro-runtime-and-testing-conventions.md`
  - `docs/specs/milestones/M19-per-side-muscle-volume.md`
  - `docs/specs/ui/README.md`
- Code/docs inventory freshness checks run:
  - inspected the muscle-history metric constants, overlay props, route state, and tests in `stats-history.tsx` and `stats-screen.test.tsx`
  - inspected per-side contribution and daily/weekly aggregation in `muscle-analytics.ts`
  - inspected `stats-heatmap-ux.yaml` and confirmed its four-muscle-metric expectation is stale
  - ran `./boga test for` over the planned file set
- Known stale references or assumptions: none; implementation must expose exactly Volume and Near failure, not restore muscle-level 1RM or Top weight.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M19-T10-Expose_per_side_volume_in_muscle_history.md`

## Objective

Expose M19's per-side, role-weighted muscle volume in the Stats / History
muscle overlay for both daily and weekly heatmaps, while retaining Near failure
and keeping muscle-level 1RM and Top weight unavailable.

## Scope

### In scope

- Add selectable `Volume` and `Near failure` metric chips to muscle history.
- Default a newly mounted Stats route to `Volume`.
- Drive daily heatmap values and detail from the selected muscle metric.
- Drive weekly heatmap values and the selected-week banner from the selected muscle metric.
- Aggregate one selected muscle across every exercise mapped to it.
- Aggregate a selected muscle family across its selected member-muscle contributions.
- Reuse the existing M19 per-side and primary/secondary role-weighted volume.
- Reconcile focused Jest, Maestro, heatmap, and UI source-of-truth documentation.

### Out of scope

- Muscle-level estimated 1RM or Top weight selection.
- Any change to per-exercise entered-load volume or record semantics.
- Schema, migration, sync, or backend changes.
- Durable persistence of the selected metric.
- New per-set load-mode or left/right tracking.

## UI Impact

- UI Impact?: `yes`
- The muscle-history overlay changes from one fixed metric to a two-option selector and defaults to Volume.

## UX Contract

### Key user flows

1. Review muscle volume:
   - Trigger: user opens History, switches to By Muscle, and selects a muscle or muscle family.
   - Steps: overlay opens on Volume; user selects Daily or Weekly and optionally selects a day/week.
   - Success outcome: heatmap intensity and detail use the existing per-side, role-weighted volume aggregate across qualifying exercises/muscles.
   - Failure/edge outcome: loading, query failure, no history, and zero-volume dates retain their existing in-overlay states without blocking dismissal.
2. Review near-failure history:
   - Trigger: user selects the Near failure metric chip.
   - Steps: the current Daily/Weekly view remains selected and its heatmap/detail updates in place.
   - Success outcome: values use near-failure counts and the selected week remains selected where applicable.
   - Failure/edge outcome: 1RM and Top weight are not offered for muscle history.

### Interaction + appearance notes

- Reuse the existing compact `SegmentedChips` selector.
- Keep the Daily/Weekly selector and overlay geometry unchanged.
- Metric selection is transient route state; no new persisted preference.
- No new colors, tokens, primitives, or navigation behavior.

## Acceptance criteria

1. Muscle history exposes exactly `Volume` and `Near failure`.
2. `Volume` is selected on initial Stats route mount.
3. Daily heatmap intensity and selected-day detail update with the selected metric.
4. Weekly heatmap intensity and selected-week banner update with the selected metric.
5. Different exercises mapped to one selected muscle aggregate using M19 per-side load normalization and role factors.
6. A selected family aggregates contributions for all selected member muscle IDs.
7. Muscle-level estimated 1RM and Top weight remain unavailable.
8. Per-exercise history continues to expose its existing four entered-load metrics unchanged.
9. Existing loading, error, empty, zero-value, and dismissal behavior remains intact.
10. UI source-of-truth docs and the focused Maestro flow describe the shipped two-metric behavior.

## Docs touched

- UI docs update required?: `yes`; the metric selector and muscle-history value semantics changed.
- Tokens/primitives compliance statement: reused the existing `SegmentedChips`,
  overlay styles, and token-backed heatmaps; introduced no raw colors, new
  primitives, or component API changes.
- `docs/specs/milestones/M19-per-side-muscle-volume.md` - reopen M19, add the missing deliverable/acceptance criterion/task, and re-close after verification.
- `docs/specs/ui/screen-map.md` - describe the two muscle-history metrics.
- `docs/specs/ui/ux-rules.md` - replace the fixed Near failure contract with Volume/Near failure semantics.
- `apps/mobile/components/heatmaps/README.md` - align the integration description with the selectable metrics.
- `docs/specs/ui/navigation-contract.md` - no update planned because routes, params, transitions, and dismissal behavior do not change.
- `docs/specs/ui/components-catalog.md` - no update planned because no reusable component API changes.

## Testing and verification approach

- Planned checks/commands:
  - focused Jest for `muscle-analytics.test.ts` and `stats-screen.test.tsx`
  - focused `stats-heatmap-ux.yaml` iOS simulator flow
  - `./boga test for --diff origin/main...HEAD`
  - `./boga test fast`
  - `./boga test frontend`
- Test layers covered: pure analytics, React Native screen interaction/state, focused simulator interaction/visual evidence, full required local gates.
- Execution triggers: always before task closeout.
- Slow-gate triggers: route UI and committed Maestro-flow changes require the frontend gate.
- Hosted/deployed smoke ownership: `N/A`; no backend or deployment change.
- CI/manual posture note: focused and aggregate iOS proof must run locally on this machine.
- Manual verification summary (required when CI is absent/partial): the focused
  simulator flow passed and its screenshots were visually inspected for weekly
  Volume, daily Volume, daily Near failure, a populated weekly Near failure
  banner, and the Back family overlay; the full local frontend gate also passed.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/app/(tabs)/stats-history.tsx`
  - `apps/mobile/app/__tests__/stats-screen.test.tsx`
  - `apps/mobile/app/__tests__/muscle-analytics.test.ts`
  - `apps/mobile/.maestro/flows/stats-heatmap-ux.yaml`
  - `apps/mobile/components/heatmaps/README.md`
  - the docs listed above
- Project structure impact: none.
- Constraints/assumptions: family volume is the sum of the current selected member-muscle contributions; one set may contribute to more than one selected family member according to its mappings.

## Mandatory verify gates

- Standard local fast gate: `./boga test fast`
- Standard local slow gate: `./boga test frontend`
- Additional gate(s), if any: follow `./boga test for --diff origin/main...HEAD`; run the focused heatmap flow for direct feature evidence.

## Evidence

- Focused analytics and screen coverage:
  - `npm test -- --runInBand app/__tests__/muscle-analytics.test.ts app/__tests__/stats-screen.test.tsx`
  - result: 2 suites, 63 tests passed
- Focused simulator interaction and visual evidence:
  - `stats-heatmap-ux.yaml` passed with screenshots for weekly Volume, daily Volume, daily Near failure, populated weekly Near failure, and the Back family overlay
  - artifact root: `apps/mobile/artifacts/maestro/M19-T10-rerun/20260724-215236-32627/`
- Required gates:
  - `./boga test fast` passed, including lint, typecheck, 105 Jest suites / 929 tests, local-Supabase backend smoke, docs-check, and meta-tests
  - `./boga test frontend` passed on the final full rerun, including iOS smoke, data smoke, auth/profile, and sync round trip
  - frontend artifact roots: `apps/mobile/artifacts/maestro/M19-T10-full-rerun/`
- UI/UX traceability:
  - Flow 1 is covered by the default-Volume route assertion, daily/weekly value tests, cross-exercise analytics test, family aggregation test, and focused simulator screenshots.
  - Flow 2 is covered by the metric-selector callback/state assertions, daily/weekly Near failure assertions, and focused simulator screenshots.
  - Existing loading, error, empty, and dismissal states remain covered in `stats-screen.test.tsx`.
- Documentation maintenance:
  - updated M19, `screen-map.md`, `ux-rules.md`, and the heatmap README
  - navigation contract unchanged because no route/param/transition changed
  - components catalog unchanged because no reusable component API changed
- Environment repair during verification:
  - started Docker Desktop after `./boga doctor` reported the daemon stopped
  - removed 904 MB of regenerable old `ad-hoc` Maestro artifacts and pruned 635.4 MB of Docker images unused by any container after the first frontend attempt filled the disk
  - final fast and frontend runs passed after repair

## Completion note

- What changed: muscle history now defaults to per-side Volume, exposes exactly Volume and Near failure, keeps the selected metric across Daily/Weekly switches, uses metric-aware daily legends and details, and retains the selected weekly banner while metrics change.
- What tests ran: focused Jest, focused `stats-heatmap-ux.yaml`, `./boga test fast`, and `./boga test frontend`; all final runs passed.
- What remains: nothing for M19-T10.

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update the M19 task breakdown in the same session.
- Update the M19 milestone status and completion note in the same session.
- Run `./scripts/task-closeout-check.sh docs/tasks/M19-T10-Expose_per_side_volume_in_muscle_history.md`.
