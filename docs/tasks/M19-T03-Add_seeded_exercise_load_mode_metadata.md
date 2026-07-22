---
task_id: M19-T03-Add_seeded_exercise_load_mode_metadata
milestone_id: "M19"
status: planned
ui_impact: "no"
areas: "frontend|docs"
runtimes: "node|docs"
gates_fast: "./boga test fast"
gates_slow: "N/A"
docs_touched: "docs/specs/05-data-model.md"
---

# M19-T03-Add_seeded_exercise_load_mode_metadata

## Task metadata

- Task ID: M19-T03-Add_seeded_exercise_load_mode_metadata
- Title: Add seeded exercise load mode metadata
- Status: `planned`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: 2026-07-22
- Session interaction mode: `interactive (default)`

## Parent references

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M19-per-side-muscle-volume.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Quality gates: `docs/specs/02-quality-and-test-gates.md`
- Project structure: `docs/specs/09-project-structure.md`

## Context Freshness

- Verified current branch + HEAD commit: authored on `codex/m19-load-mode` from `origin/main` at `ec88290`; verify current branch and HEAD during implementation kickoff.
- Start-of-session sync with `origin/main` completed?: `yes` for card authoring; branch was created from `origin/main` on 2026-07-22. Reverify before edits.
- Parent refs opened in this session:
  - `docs/specs/02-quality-and-test-gates.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/milestones/M19-per-side-muscle-volume.md`
- Code/docs inventory freshness checks run:
  - `rg -n "exercise-catalog-seeds|SYSTEM_EXERCISE|seed_" apps/mobile/src apps/mobile/app/__tests__` - rerun during task kickoff and inspect exact hits.
  - `rg --files apps/mobile | rg 'exercise-catalog-seeds|seed|catalog'` - candidate seed and catalog files listed on 2026-07-22.
- Known stale references or assumptions: seed catalogue may have changed after card creation; this task must re-count and validate every current seeded exercise.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M19-T03-Add_seeded_exercise_load_mode_metadata.md`

## Objective

Add explicit load-entry defaults for every starter exercise definition so seeded
and historical system exercises resolve deterministic per-side muscle volume
semantics.

## Scope

### In scope

- Add or extend seed metadata so every bundled system exercise has a resolved `loadInputMode`.
- Validate at test time that no seeded exercise definition is missing load-entry semantics.
- Classify load modes by movement load distribution, not equipment words.
- Include explicit coverage for the milestone examples:
  - barbell bench press: `total_load`
  - two-dumbbell bench press: `per_side_load`
  - single-dumbbell two-arm pullover: `total_load`
  - one-arm dumbbell row: `per_side_load`
- Preserve user edits to existing synced seed rows while ensuring analytics can resolve a default for starter exercises.

### Out of scope

- Adding the schema column or sync wire support; `M19-T02` owns that prerequisite.
- Changing custom exercise editor UI; `M19-T05` owns user controls.
- Changing analytics math; `M19-T04` owns computation.
- Inferring mode from free-form exercise names at runtime.

## UI Impact

- UI Impact?: `no`
- This task changes seed metadata and validation, not rendered UI.

## Acceptance criteria

1. Every current bundled exercise definition has an explicit `loadInputMode` or resolver entry.
2. Validation tests fail when a seeded exercise is missing a mode.
3. Single-implement symmetric exercises can be classified as `total_load`; the pullover example is covered.
4. Per-side implement and one-arm/one-leg exercises can be classified as `per_side_load`; the dumbbell bench and one-arm row examples are covered.
5. Seed updates do not overwrite user-customized exercise names or mappings unless the row still matches the bundle-migration guard conditions.
6. Data model docs capture where seeded defaults live if that becomes source-of-truth behavior.

## Docs touched

- Planned docs/spec files to update and why:
  - `docs/specs/05-data-model.md` - document seeded exercise load-mode defaults/resolution if the implementation introduces a reusable contract.
  - `docs/specs/milestones/M19-per-side-muscle-volume.md` - update only if seed classification changes a locked product example or task boundary.

## Testing and verification approach

- Planned checks/commands:
  - `./boga test fast`
  - `./boga test for --diff <range>`
- Test layers covered: seed metadata unit tests, bootstrap/repository tests if seed rows persist the new field.
- Execution triggers: always before task closeout.
- Slow-gate triggers: `N/A` unless the implementation changes sync/bootstrap behavior beyond local seed metadata.
- Hosted/deployed smoke ownership: `N/A`; no backend deployment occurs.
- CI/manual posture note: fast gate is required locally; run backend/frontend lanes only if `./boga test for` identifies a triggered path.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/src/data/exercise-catalog-seeds.ts`
  - `apps/mobile/src/data/bootstrap.ts` only if seeding persistence requires it
  - `apps/mobile/app/__tests__/exercise-catalog-seeds.test.ts`
  - targeted bootstrap/catalog tests under `apps/mobile/app/__tests__/`
- Project structure impact: none planned.
- Constraints/assumptions: one `loadInputMode` is enough because it describes whether the entered load is shared total load or already per side.

## Mandatory verify gates

- Standard local fast gate: `./boga test fast`
- Standard local slow gate: `N/A` unless `./boga test for --diff <range>` requires one.
- Additional gate(s), if any: follow `./boga test for --diff <range>`.

## Evidence

- Fill during implementation.
- Manual verification summary: fill during implementation.

## Completion note

- What changed:
- What tests ran:
- What remains:

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Update parent milestone task breakdown/status in the same session.
- Run `./scripts/task-closeout-check.sh docs/tasks/M19-T03-Add_seeded_exercise_load_mode_metadata.md` or document why `N/A`.
