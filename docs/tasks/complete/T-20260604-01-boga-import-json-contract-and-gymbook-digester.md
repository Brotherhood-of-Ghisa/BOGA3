---
task_id: T-20260604-01-boga-import-json-contract-and-gymbook-digester
milestone_id: "M13"
status: planned
ui_impact: "no"
areas: "frontend|docs"
runtimes: "node"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "N/A"
docs_touched: "RUNBOOK.md,docs/specs/09-project-structure.md as needed"
---

# Task Card

## Task metadata

- Task ID: `T-20260604-01-boga-import-json-contract-and-gymbook-digester`
- Title: BOGA import JSON contract and GymBook export digester
- Status: `planned`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-06-04`
- Session interaction mode: `interactive (default)`

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M13-simple-backend-sync.md` (completed baseline; this is post-M13 import tooling)
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- AI development playbook: `docs/specs/04-ai-development-playbook.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- Worktree/runtime isolation: `docs/specs/12-worktree-config-and-isolation.md`
- Runbook: `RUNBOOK.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit: `main` at `66eeee8`
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `no` - planning card created from an interactive `/plan` discussion; perform normal start-of-session sync before implementation.
- Parent refs opened in this planning session:
  - `docs/specs/README.md`
  - `docs/specs/00-product.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/04-ai-development-playbook.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/12-worktree-config-and-isolation.md`
  - `docs/specs/templates/task-card-template.md`
  - `docs/tasks/README.md`
  - `RUNBOOK.md`
  - `apps/mobile/src/data/schema/sessions.ts`
  - `apps/mobile/src/data/schema/session-exercises.ts`
  - `apps/mobile/src/data/schema/exercise-sets.ts`
  - `apps/mobile/src/data/schema/gyms.ts`
  - `apps/mobile/src/data/schema/exercise-definitions.ts`
  - `apps/mobile/src/data/exercise-catalog-seeds.ts`
- Code/docs inventory freshness checks run:
  - `GymBook-Logs-2026-06-04.xml` inspection - export is UTF-16LE XML with no line terminators, root `<logs>`, and 2,971 `<log>` rows.
  - GymBook field inventory - each `<log>` row has `date`, `workout`, `time`, `exercise`, `targetRegion`, `targetMusclesPrimary`, `targetMusclesSecondary`, `type`, `reps`, `weight`, `notes`, and `skipped`; one malformed/incomplete `reps` count should be treated as validation input.
  - GymBook data profile - date range `2024-12-23` to `2026-06-04`, 212 training dates, 116 exercise names, 61 skipped rows, 255 empty-weight rows, 23 non-empty notes.
  - Exact exercise-name match against BOGA seed catalog - 114 of 116 GymBook exercise names match BOGA seeded exercise names exactly in the current seed bundle; unmatched names are `Zercher Squat` (11 rows) and `Ball Dumbbell Chest Press` (5 rows). Implementation must still resolve against the importing user's actual local exercise catalog, not just seed source.
  - Session clustering probe - grouping by date plus time gaps around 60-90 minutes yields roughly 222-225 sessions; many logged spans are unrealistically short because multiple sets share the same minute.
- Known stale references or assumptions:
  - The full GymBook export is a local private file and must not be committed. Commit only small synthetic or redacted fixtures.
  - Local mobile SQLite rows do not carry a backend `owner_user_id`; the selected local app database/profile is the effective import target. The digester must still ask "who is importing?" as a preflight/provenance question and use that answer to choose/load the target user's local exercise and gym catalogs.
  - This card defines and emits the BOGA-friendly JSON contract; `T-20260604-02-boga-import-json-local-importer` depends on this contract and should not start until it is reviewed/locked.
- Optional helper command (recommended at execution start):
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260604-01-boga-import-json-contract-and-gymbook-digester.md`

## Objective

Define the source-app-neutral BOGA import JSON contract and implement the first source-specific digester: GymBook XML export to BOGA-friendly JSON, with explicit user/profile, exercise, gym, and time-inference decisions. This task does not write imported rows into BOGA data.

## Scope

### In scope

- Add a documented BOGA-friendly JSON contract for session imports.
- Add a GymBook digestion script with a meaningful name, for example `digest-gymbook-export.ts`.
- Parse UTF-16LE GymBook XML safely and tolerate the one-line export shape.
- Ask "who is importing?" during digester preflight and record the answer in JSON metadata/reports.
- Load the target import profile's local BOGA exercise list before resolving exercise names, because each user owns their own exercise catalog after sync/bootstrap.
- Load the target import profile's local BOGA gym list before gym assignment, because gyms are user-owned.
- For missing GymBook exercise names, ask for a mapping or explicit create-new decision after the import user/profile is known; do not silently map unknowns.
- For this export, support decisions for `Zercher Squat` and `Ball Dumbbell Chest Press`.
- If creating new exercises, either require muscle mappings or record a clear warning/report item that the created exercise has no muscle mappings yet.
- Skip `skipped = Yes` GymBook rows and report the skipped count.
- Preserve non-empty GymBook notes in the JSON package as source metadata/warnings because the current BOGA session/set schema has no notes column.
- Parse kg weight strings into BOGA-ready `weightValue` strings and empty weights into empty `weightValue`, preserving bodyweight sets as reps-only.
- Infer sessions from GymBook set timestamps by date/time clustering rather than by `workout` alone.
- Apply the agreed duration rule:
  - a normal inferred session should last around 60 minutes,
  - if raw timestamps produce a duration under 30 minutes, output a 60-minute duration and warning,
  - if raw timestamps produce a duration over 90 minutes, output a warning that requires review.
- Gym assignment is driven from the target user's local BOGA gym list:
  - ask which gym to use for midday workouts,
  - ask which gym to use for weekday evening workouts,
  - ask which gym to use for weekend workouts,
  - allow an explicit "no gym" choice for each bucket.
- Add dry-run/report mode so the user can review sessions, skipped rows, warnings, missing mappings, gym assignment counts, and unresolved decisions before producing final JSON.
- Add small redacted/synthetic fixtures and tests for parser, digestion, validation, user/profile preflight, exercise/gym decision handling, and duration inference.
- Update `RUNBOOK.md` with the digest/review workflow.

### Out of scope

- Writing rows into local SQLite/Drizzle.
- Remote Supabase import.
- Service-role/admin import.
- Hosted database writes.
- Schema changes.
- UI changes.
- New mobile screens or in-app import flow.
- Importing skipped GymBook rows.
- Fully automated exercise/muscle inference for unmatched exercises without user confirmation.
- Committing the private full GymBook export.

## UI Impact (required checkpoint)

- UI Impact?: `no`
- Rationale: this task adds command-line import digestion tooling and tests only; it does not change screens, routes, navigation, visual appearance, or touch interactions.

## Acceptance criteria

1. The BOGA-friendly JSON contract is documented and source-app neutral enough for future non-GymBook digesters.
2. The GymBook digester can parse the provided UTF-16LE XML shape and produce a BOGA-friendly JSON package without committing the private export.
3. The digester records source metadata including source app, source file identity/hash, generated timestamp, importing user/profile label, timezone/date assumptions, and digest options.
4. The digester asks/accepts "who is importing?" before exercise or gym mapping decisions.
5. Exercise mapping decisions are based on the importing user's actual local BOGA exercise catalog.
6. Gym assignment decisions are based on the importing user's actual local BOGA gym list.
7. The digester groups GymBook rows into inferred BOGA sessions by date/time clusters, not by `workout` alone.
8. The digester skips `skipped = Yes` rows and reports the skipped count.
9. The digester preserves set order inside each inferred session deterministically from GymBook export order and timestamps.
10. Sessions whose raw GymBook timestamp span is under 30 minutes are represented with a 60-minute duration and a warning.
11. Sessions whose raw GymBook timestamp span is over 90 minutes produce a review warning.
12. The digester never silently maps `Zercher Squat` or `Ball Dumbbell Chest Press`; decisions must be provided through interactive prompt or mapping file.
13. The output JSON contains no unresolved exercise or gym decisions unless explicitly generated as a review-only draft that the importer must reject.
14. Non-empty GymBook notes are preserved in source metadata/report output rather than lost silently.
15. Dry-run/report mode summarizes source rows, skipped rows, inferred sessions, duration warnings, exercise decisions, gym bucket assignments, and notes warnings.
16. Targeted tests cover parser, duration inference, skipped-row handling, unresolved mapping rejection, and JSON contract validation.
17. `RUNBOOK.md` documents the digest/review command flow.
18. No private full export data or personal workout details are committed beyond small synthetic/redacted fixtures.

## Docs touched (required)

- Planned docs/spec files to update and why:
  - `RUNBOOK.md` - add operator workflow for GymBook digestion, decision files, dry-run review, and JSON handoff to the importer.
  - `docs/specs/09-project-structure.md` - update only if implementation introduces a new canonical import-tool folder or reusable import package location beyond existing `apps/mobile/scripts/**`.
  - `docs/specs/06-testing-strategy.md` - update only if importer/digester verification becomes a stable new shared test layer; targeted tests plus existing gates are expected.
- Project-level docs rule:
  - If implementation changes cross-cutting local operator workflow or script placement conventions, promote stable behavior to the relevant project-level docs in the same session.

## Testing and verification approach

- Planned checks/commands:
  - targeted parser/digester tests for UTF-16LE GymBook XML fixtures
  - targeted inference tests for under-30-minute extension and over-90-minute warning
  - targeted JSON contract validation tests
  - `cd apps/mobile && npm test -- --runTestsByPath <new digest test files>`
  - `./scripts/quality-fast.sh frontend`
- Standard local gate usage:
  - `./scripts/quality-fast.sh frontend` is mandatory because this changes mobile workspace TypeScript scripts/tests.
  - `./scripts/quality-slow.sh frontend`: `N/A` unless implementation unexpectedly touches mobile runtime, sync, migrations, or app behavior.
- Test layers covered:
  - unit/parser
  - domain/inference
  - contract/JSON validation
- Execution triggers:
  - always run targeted tests and frontend fast gate for script changes.
- Slow-gate triggers:
  - `N/A` unless runtime/sync/app code is touched.
- Hosted/deployed smoke ownership:
  - `N/A`; remote import and hosted writes are out of scope.
- CI/manual posture note:
  - CI does not cover local private export digestion. Record dry-run summaries from the full private GymBook export in the completion note without committing the export.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/scripts/**` or a documented subfolder under it for import/digestion scripts
  - `apps/mobile/app/__tests__/**` or existing mobile test location for digest tests
  - `RUNBOOK.md`
  - `docs/specs/09-project-structure.md` only if new canonical import-tool placement needs documenting
- Project structure impact:
  - Prefer existing `apps/mobile/scripts/**` because the digester must inspect mobile local exercise/gym catalogs.
  - If a reusable `apps/mobile/scripts/import/**` subfolder is introduced, decide whether that is minor enough to leave `09-project-structure` unchanged or update it as the canonical import-tool home.
- Constraints/assumptions:
  - The BOGA-friendly JSON contract is the handoff boundary to `T-20260604-02-boga-import-json-local-importer`.
  - Local-only context means no `owner_user_id` exists in SQLite; the selected local app database/profile is the effective user target.
  - The full GymBook export path is local/private and must stay out of committed fixtures.
  - Timezone/date interpretation should default to the operator's local timezone unless an explicit `--timezone` option is supplied.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `N/A` unless runtime/sync/app behavior is touched.
- Optional closeout validation helper: `./scripts/task-closeout-check.sh docs/tasks/T-20260604-01-boga-import-json-contract-and-gymbook-digester.md`
- Additional gate(s), if any:
  - targeted import parser/digester/contract tests
  - dry-run against the full private GymBook export without committing it

## Evidence

- To be filled during implementation.
- Manual verification summary:
  - Record digest summary counts from the full private GymBook export.
  - Record warnings and unresolved decisions from dry-run review.
- Deferred/manual hosted checks summary:
  - Remote import and hosted Supabase write validation are out of scope.

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed:
- What tests ran:
- What remains:

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Ensure completion note is filled before handoff.
- If the task changed significant cross-cutting behavior, ensure the relevant project-level docs (`03`, `04`, `05`, `06`) were updated in the same session rather than only the milestone/task docs.
- If significant project-structure changes were made, update `docs/specs/09-project-structure.md` and mention it in completion note.
- Run `./scripts/task-closeout-check.sh docs/tasks/T-20260604-01-boga-import-json-contract-and-gymbook-digester.md` (or document why `N/A`) before handoff.
