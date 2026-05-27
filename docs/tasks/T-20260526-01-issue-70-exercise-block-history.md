---
task_id: T-20260526-01-issue-70-exercise-block-history
milestone_id: "M1"
status: in_progress
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "N/A"
docs_touched: "docs/specs/ui/ux-rules.md, docs/specs/ui/screen-map.md, docs/specs/ui/components-catalog.md if a reusable component is added"
---

# Task Card

## Task metadata

- Task ID: `T-20260526-01-issue-70-exercise-block-history`
- Title: Issue 70 phase 0A - recent exercise block history in recorder
- Status: `in_progress`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-05-26`
- Session interaction mode: `interactive (default)`
- Implementation/review branches:
  - Base implementation branch: `codex/issue-70-exercise-block-history` contains the Agent 2A service/data implementation.
  - Agent 2B UX branch: `codex/issue-70-exercise-block-history-2B` branches from the Agent 2A state, wires the recorder UI, updates UI docs, runs targeted UX tests, and hands off to review.
  - Agent 3A numeric/service review branch: `codex/issue-70-exercise-block-history-3A` should branch from the latest accepted implementation state, test/review query correctness and metric accuracy, and commit any small review fixes separately.
  - Agent 3B UX quality review branch: `codex/issue-70-exercise-block-history-3B` should branch from the latest accepted implementation state, test/review recorder interaction and visual quality, and commit any small review fixes separately.
  - Agent 2C fixture/QA-data branch: `codex/issue-70-exercise-block-history-fixture` should branch from the latest Agent 3B state, add deterministic local fixture support for richer Maestro/visual QA, and hand back to Agent 3B.
  - Agent 3B follow-up should continue from `codex/issue-70-exercise-block-history-fixture` after Agent 2C completes, rerun UX visual QA using the new fixture, and update evidence.
  - Final orchestrator branch/review: the orchestrator should compare the 2A/2B/3A/3B outputs, perform final review, resolve any integration differences, and merge the accepted result toward `main`.
- Issue context:
  - GitHub Issue: `https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/70`
  - No new milestone is created for Issue 70. This is a single direct-execution task under the existing session-recorder parent milestone because the first slice is recorder UI plus local read-only derived history.

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M1-ui-session-recorder.md`
- Product overview: `docs/specs/00-product.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- Worktree isolation: `docs/specs/12-worktree-config-and-isolation.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
- UI route semantics: `docs/specs/ui/ux-rules.md`
- UI screen map: `docs/specs/ui/screen-map.md`
- UI navigation contract: `docs/specs/ui/navigation-contract.md`
- UI components catalog: `docs/specs/ui/components-catalog.md`
- Runbook: `RUNBOOK.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit: Agent 2A started on `codex/issue-70-exercise-block-history` at `add1664` after merging fresh `origin/main`; Agent 2B started from Agent 2A handoff commit `6b4c72c`.
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `yes` - Agent 2A ran `git fetch origin main codex/issue-70-exercise-block-history`; Agent 2B ran `git fetch origin main codex/issue-70-exercise-block-history` and confirmed no new `origin/main` commits were pending relative to the branch.
- Agent 3A started from Agent 2B handoff commit `41bc94a` on branch `codex/issue-70-exercise-block-history-3A`.
- Start-of-session sync completed in this Agent 3A session?: `yes` - ran `git fetch origin main codex/issue-70-exercise-block-history codex/issue-70-exercise-block-history-2B` and confirmed no local dirty entries before branching.
- Agent 3B started from Agent 3A handoff commit `80d7ad0` on branch `codex/issue-70-exercise-block-history-3B`.
- Start-of-session sync completed in this Agent 3B session?: `yes` - ran `git fetch origin main codex/issue-70-exercise-block-history codex/issue-70-exercise-block-history-2B codex/issue-70-exercise-block-history-3A`, confirmed no existing 3B branch, and created `codex/issue-70-exercise-block-history-3B` from `80d7ad0`.
- Agent 2C started from Agent 3B handoff commit `270337d` on branch `codex/issue-70-exercise-block-history-fixture`.
- Start-of-session sync completed in this Agent 2C session?: `yes` - ran `git fetch origin main codex/issue-70-exercise-block-history-3B`, confirmed local 3B matched `origin/codex/issue-70-exercise-block-history-3B`, and created `codex/issue-70-exercise-block-history-fixture` from `270337d`.
- Parent refs opened in this Agent 2A session:
  - `docs/specs/README.md`
  - `docs/specs/00-product.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/04-ai-development-playbook.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/12-worktree-config-and-isolation.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/navigation-contract.md`
  - `docs/specs/ui/components-catalog.md`
  - `docs/specs/milestones/M1-ui-session-recorder.md`
  - `RUNBOOK.md`
- Parent refs opened in this Agent 2B session:
  - `docs/specs/README.md`
  - `docs/specs/00-product.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/04-ai-development-playbook.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/12-worktree-config-and-isolation.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/navigation-contract.md`
  - `docs/specs/ui/components-catalog.md`
  - `docs/specs/milestones/M1-ui-session-recorder.md`
  - `RUNBOOK.md`
- Parent refs opened in this Agent 3A session:
  - `docs/specs/README.md`
  - `docs/specs/00-product.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/04-ai-development-playbook.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/12-worktree-config-and-isolation.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/navigation-contract.md`
  - `docs/specs/ui/components-catalog.md`
  - `docs/specs/milestones/M1-ui-session-recorder.md`
  - `RUNBOOK.md`
- Parent refs opened in this Agent 3B session:
  - `docs/specs/README.md`
  - `docs/specs/00-product.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/04-ai-development-playbook.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/12-worktree-config-and-isolation.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/navigation-contract.md`
  - `docs/specs/ui/components-catalog.md`
  - `docs/specs/milestones/M1-ui-session-recorder.md`
  - `RUNBOOK.md`
- Code/docs inventory freshness checks run in this Agent 2A session:
  - `rg --files apps/mobile/app apps/mobile/src apps/mobile/components | rg 'session-recorder|exercise-history|session|exercise|stats|history'` - identified existing recorder, exercise-history, session-list, calculation, and test surfaces.
  - `rg "estimated|1RM|one rep|volume|RIR|set_type|rir_" apps/mobile docs/specs -g '!docs/brainstorms/**'` - confirmed existing 1RM/volume helpers and `set_type` semantics.
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260526-01-issue-70-exercise-block-history.md` - confirmed branch/task metadata and required gates.
  - Source review of `apps/mobile/src/data/exercise-history.ts`, `apps/mobile/src/exercise-calculations/index.ts`, `apps/mobile/src/data/set-types.ts`, `apps/mobile/src/data/schema/sessions.ts`, `apps/mobile/src/data/schema/session-exercises.ts`, `apps/mobile/src/data/schema/exercise-sets.ts`, `apps/mobile/src/data/index.ts`, and relevant exercise-history/stats/calculation tests.
- Code/docs inventory freshness checks run in this Agent 2B session:
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260526-01-issue-70-exercise-block-history.md` - confirmed branch/task metadata and required gates at `6b4c72c`.
  - Source review of `apps/mobile/app/(tabs)/session-recorder.tsx`, `apps/mobile/components/session-recorder/session-content-layout.tsx`, `apps/mobile/components/session-recorder/types.ts`, `apps/mobile/src/data/exercise-block-history.ts`, and relevant recorder tests.
- Code/docs inventory freshness checks run in this Agent 3A session:
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260526-01-issue-70-exercise-block-history.md` - confirmed branch/task metadata and required gates at `41bc94a`.
  - Source review of `apps/mobile/src/data/exercise-block-history.ts`, `apps/mobile/src/exercise-calculations/index.ts`, `apps/mobile/src/data/set-types.ts`, `apps/mobile/src/data/schema/sessions.ts`, `apps/mobile/src/data/schema/session-exercises.ts`, `apps/mobile/src/data/schema/exercise-sets.ts`, and `apps/mobile/app/__tests__/exercise-block-history.test.ts`.
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/exercise-block-history.test.ts` - passed before Agent 3A edits.
- Code/docs inventory freshness checks run in this Agent 3B session:
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260526-01-issue-70-exercise-block-history.md` - confirmed branch/task metadata and required gates at `80d7ad0`.
  - Source review of `apps/mobile/app/(tabs)/session-recorder.tsx`, `apps/mobile/components/session-recorder/session-content-layout.tsx`, `apps/mobile/app/__tests__/session-recorder-interactions.test.tsx`, `apps/mobile/app/__tests__/session-recorder-screen.test.tsx`, and relevant UI docs.
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-interactions.test.tsx app/__tests__/session-recorder-screen.test.tsx` - passed before Agent 3B edits, 45 tests.
  - `cd apps/mobile && npm run lint:ui-guardrails` - passed before Agent 3B edits, 0 raw-color violations.
- Code/docs inventory freshness checks run in this Agent 2C session:
  - Source review of `apps/mobile/src/maestro/harness.ts`, `apps/mobile/app/maestro-harness.tsx`, `apps/mobile/app/__tests__/maestro-harness.test.ts`, `apps/mobile/src/data/exercise-block-history.ts`, session/exercise/set schema files, checked-in Maestro flows, `docs/specs/11-maestro-runtime-and-testing-conventions.md`, and `RUNBOOK.md`.
- Known stale references or assumptions:
  - Assumption: `n = 5` recent completed sessions at initial implementation unless the implementer finds an existing product constant or the human gives a different value before coding.
  - Assumption: "up to n sessions" means distinct completed sessions, newest first, not distinct `session_exercises` rows.
  - Assumption: multiple same-exercise `session_exercises` in one completed session are merged into one displayed block.
  - Agent 2A kept `n = 5` as `DEFAULT_RECENT_EXERCISE_BLOCK_LIMIT`.
- Optional helper command (recommended):
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260526-01-issue-70-exercise-block-history.md`

## Objective

Implement the first Issue 70 slice in the session recorder: when a user selects/logs an exercise, show a compact, read-only navigator through up to `n` most recent completed-session blocks containing that exercise, starting from the most recent block and exposing only summary stats.

## Workstream split

This remains one task card, but execution is split across per-agent branches so each workstream has a crisp ownership boundary and the final orchestrator can review/integrate deliberately.

1. Agent 2A - background service/data layer
   - Owns the read-only repository/service contract for recent exercise blocks.
   - Owns pure aggregation/format-ready data shapes, including block ordering, session-level merge behavior, and numeric stats.
   - Owns numeric/data tests before UX wiring.
   - Should not make recorder visual/layout decisions beyond exposing a clean API for Agent 2B.
2. Agent 2B - recorder UX
   - Owns loading the service output from recorder exercise cards.
   - Owns the block panel, `<<`/`>>` controls, inline loading/empty/error states, accessibility labels, and UI docs.
   - Should not rewrite numeric aggregation rules unless Agent 2A's contract is incomplete; if so, update service tests first.
3. Agent 3A - numeric accuracy review
   - Owns independent verification of query semantics and calculations.
   - Focuses on correctness of `n`, ordering, duplicate same-session exercise rows, warm-up exclusion, invalid input handling, and `<=2 RIR` count.
4. Agent 3B - UX quality review
   - Owns interaction/appearance review against `docs/specs/08-ux-delivery-standard.md` and `docs/specs/ui/**`.
   - Focuses on mobile density, state clarity, disabled button behavior, non-blocking failure states, and screenshot evidence.
5. Agent 2C - fixture/QA data support
   - Owns deterministic local fixture setup for richer real-SQLite visual QA.
   - Should not change production exercise-block metric semantics or recorder UX except where needed to expose/test fixture-driven states.
   - Should prefer app-owned harness setup over long visible UI setup, using existing `data reset` + `teleport` conventions.
   - Should hand back to Agent 3B for final UX screenshot/evidence pass after the fixture path works.

## Scope

### In scope

- Add a read-only local repository/aggregation path for recent exercise blocks.
- Add a small service/repository API that recorder UI can consume without knowing SQL/join details.
- Load up to `n` most recent completed, non-deleted sessions containing the selected exercise definition.
- Merge multiple logged instances of the same exercise inside one session into one block.
- Show the most recent block by default for each selected exercise in the recorder.
- Let the user navigate older/newer blocks with `<<` and `>>` controls.
- Show only:
  - age in days ago,
  - estimated `1RM`,
  - total volume,
  - highest weight,
  - number of sets with not more than `2 RIR` (displayed as `Near failure`).
- Add targeted data aggregation and recorder UI tests.
- Split verification between numeric/service tests and UX interaction/quality tests.
- Add deterministic local QA fixture support if needed to let Agent 3B test populated/older/newer block UX from real SQLite data without manually creating many sessions.
- Update relevant UI docs to reflect the new recorder block-history behavior.

### Out of scope

- Creating a new milestone for Issue 70.
- Planner/ghost repeat-set generation.
- Copying prior block sets into the active session.
- Showing full historic set rows/details inside the recorder.
- New schema, migrations, backend changes, sync contract changes, or analytics materialization.
- Supabase/auth user creation for this UX proof; local SQLite fixture data is enough unless a later sync-specific task explicitly broadens scope.
- Route, query-param, or navigation changes.
- Broad Maestro runtime refactors beyond the minimal harness/fixture/flow support needed for this QA scenario.

## UI Impact (required checkpoint)

- UI Impact?: `yes`
- Rationale: the recorder exercise card gains a new read-only historical stats panel and time navigation controls.

## UX Contract

### Key user flows

1. Flow name: Select exercise and see latest block stats
   - Trigger: User taps `Log new exercise` and selects an exercise from the recorder picker.
   - Steps: Start or restore an active session -> open exercise picker -> select an exercise with previous completed-session history.
   - Success outcome: The new exercise card appears with a compact prior-block stats panel showing the most recent completed-session block for that exercise.
   - Failure/edge outcome: If no prior completed block exists, the exercise remains fully loggable and shows a compact empty state such as `No previous blocks`.
2. Flow name: Navigate block history in time
   - Trigger: User taps the history panel `<<` or `>>` control on an exercise card.
   - Steps: With a historical block panel visible -> tap `<<` to move older -> tap `>>` to move newer.
   - Success outcome: Stats update in place; `<<` is disabled on the oldest loaded block and `>>` is disabled on the most recent block.
   - Failure/edge outcome: If only one block exists, both controls are disabled or visually unavailable while the current stats remain visible.
3. Flow name: Continue logging while history is unavailable
   - Trigger: Local history load is pending or fails.
   - Steps: Select an exercise while repository load is pending/failing.
   - Success outcome: The user can still enter sets, add tags, change exercise, and submit/save the session.
   - Failure/edge outcome: History loading/error state stays inline and non-blocking; it must not block autosave or session submission.

### Interaction + appearance notes

- Keep the panel compact inside each exercise card, below exercise tags and above set rows unless implementation finds a clearer local placement.
- Use existing UI tokens and existing recorder/card patterns; do not introduce raw color literals.
- Use `<<` and `>>` button labels as requested, with accessibility labels that describe older/newer block navigation.
- Stats should be scannable in a dense mobile layout; avoid full historic set detail.
- Keep empty/loading/error states quiet and inline.

## Acceptance criteria

1. Selecting or adding an exercise in `/session-recorder` starts a non-blocking load for recent blocks keyed by `exerciseDefinitionId`.
2. The repository returns at most `n` distinct completed sessions containing the exercise, ordered newest first by `sessions.completedAt`.
3. Default `n` is `5` unless the implementation finds a better existing constant or receives a human override before coding.
4. A completed session containing multiple `session_exercises` rows for the same `exerciseDefinitionId` is represented as one block with sets aggregated across all matching rows.
5. Active, draft/impossible, soft-deleted, and incomplete/no-`completedAt` sessions are excluded.
6. Warm-up sets are excluded from `1RM`, total volume, highest weight, and `<=2 RIR` stats.
7. `1RM` uses the existing Wathan helper path from `apps/mobile/src/exercise-calculations/index.ts`.
8. Total volume sums valid eligible `weight * reps` values using the existing parser/helper semantics.
9. Highest weight is the max valid eligible set weight; display a clear empty value when no eligible set parses cleanly.
10. `<=2 RIR` count includes only eligible sets whose normalized `setType` is `rir_0`, `rir_1`, or `rir_2`.
11. The most recent block is shown first.
12. `<<` navigates older and is disabled at the oldest loaded block.
13. `>>` navigates newer and is disabled at the most recent block.
14. Loading, empty, and error states are inline and do not block set entry, tags, exercise actions, autosave, or submit/save.
15. Changing an existing exercise card to a different exercise resets that card's block navigator to the new exercise's most recent block.
16. Existing recorder behavior for set entry, add set, tags, gym selection, completed-edit mode, and submit/save continues to pass.
17. Screen UI uses documented tokens/primitives/shared components for common buttons/text/layout/list patterns, or records a justified exception.
18. No raw color literals are introduced in screen files unless explicitly allowed by the task and documented with rationale.
19. Relevant `docs/specs/ui/*.md` docs are updated in the same task, or explicit no-update rationale is recorded.
20. `docs/specs/ui/navigation-contract.md` is not updated unless routes, params/query behavior, redirects, or transitions change.

## Docs touched (required)

- Planned docs/spec files to update and why:
  - `docs/specs/ui/ux-rules.md` - document the new recorder exercise block-history semantics, inline non-blocking state handling, and `<<`/`>>` navigation behavior.
  - `docs/specs/ui/screen-map.md` - update the `/session-recorder` key states to mention per-exercise recent block stats.
  - `docs/specs/ui/components-catalog.md` - update only if the implementation adds a reusable `session-recorder` component for the block-history panel; otherwise record explicit no-update rationale.
  - `docs/specs/ui/navigation-contract.md` - no update expected because no route/query transition is planned.
  - `docs/specs/11-maestro-runtime-and-testing-conventions.md` - update if Agent 2C adds a new supported harness query parameter such as `fixture=exercise-block-history`.
  - `RUNBOOK.md` - update only if local run/test/debug commands or manual verification workflow change.
- For significant cross-cutting behavior changes:
  - No `docs/specs/03-technical-architecture.md` update expected; this is a local read-only derived view.
  - No `docs/specs/04-ai-development-playbook.md` update expected.
  - No `docs/specs/05-data-model.md` update expected because there is no schema/entity/ownership/sync-scope change.
  - No `docs/specs/06-testing-strategy.md` update expected unless a new test layer or verification policy is introduced.
- UI docs update required?: `yes`
- UI docs trigger map:
  - `docs/specs/ui/README.md` says UI semantics/pattern expectation changes require `docs/specs/ui/ux-rules.md`.
  - `screen-map.md` changes because `/session-recorder` key states gain a new visible per-exercise history panel.
  - `navigation-contract.md` should stay unchanged unless implementation changes route paths, params, redirects, or transitions.
  - `components-catalog.md` changes only if a reusable component role is added or changed.
  - `docs/specs/11-maestro-runtime-and-testing-conventions.md` changes if the canonical harness contract changes.
- Tokens/primitives compliance statement:
  - Reuse plan: existing `SessionContentLayout`, route-local recorder card patterns, and `uiTokens`/`uiColors` from `apps/mobile/components/ui`.
  - Exceptions: none expected; no raw literals or new primitive extraction required.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md` or task scope?: `yes`
- Planned captures/artifacts:
  - Recorder card showing a populated latest block.
  - Recorder card after navigating to an older block.
  - Empty or error state for an exercise without available block history.
  - Agent 3B follow-up QA recommendation:
    - Add a reusable Maestro fixture path that provisions a deterministic local test profile/state with several completed logs across at least two exercises and multiple dates, then opens the recorder and validates populated, older/newer, empty, and error/non-blocking states from real SQLite data.
    - Owner: Agent 2C fixture/QA-data branch, then Agent 3B follow-up for final UX visual evidence.

## Testing and verification approach

- Planned checks/commands:
  - Agent 2A / Agent 3A numeric-service lane:
    - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/exercise-block-history.test.ts`
    - If implementation extends existing `exercise-history` tests instead of adding a new file, adapt to the exact service/data test path.
  - Agent 2B / Agent 3B UX lane:
    - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-interactions.test.tsx app/__tests__/session-recorder-screen.test.tsx`
    - If UX coverage lands in a narrower new test file, adapt to the exact recorder UI test path.
  - Agent 2C fixture/QA-data lane:
    - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/maestro-harness.test.ts app/__tests__/exercise-block-history.test.ts`
    - Add/adapt a focused fixture test if the fixture seeding helper lives outside the harness module.
    - Run the new Maestro exercise-block-history fixture flow or document the exact simulator/runtime blocker.
  - If implementation extends existing `exercise-history` repository instead of adding a new file, adapt the targeted path to the actual test file names.
  - `cd apps/mobile && npm run lint:ui-guardrails`
  - `./scripts/quality-fast.sh frontend`
- Standard local gate usage:
  - `./scripts/quality-fast.sh frontend` required.
  - `./scripts/quality-slow.sh frontend` is `N/A` unless implementation unexpectedly changes native runtime behavior, Maestro harness flows, navigation, or keyboard/geometry-sensitive UI.
- Test layers covered:
  - Numeric/service layer: unit/data aggregation tests for recent block query/aggregation and metric calculation.
  - UX layer: React Native Testing Library route/component tests for recorder display, navigation buttons, empty/loading/error states, and non-blocking logging behavior.
  - Fixture/QA layer: harness/fixture tests plus Maestro simulator visual proof using real local SQLite fixture data.
- Execution triggers:
  - Always for this task.
- Slow-gate triggers:
  - `N/A` for planned scope; require `./scripts/quality-slow.sh frontend` only if the implementation expands into Maestro/native-runtime-sensitive behavior.
- Hosted/deployed smoke ownership:
  - N/A; no backend/hosted changes.
- CI/manual posture note:
  - CI is absent/partial; local targeted tests, UI guardrail lint, frontend fast gate, and visual evidence must be recorded before closeout.
- Notes:
  - Prefer deterministic repository tests over fixture-heavy UI tests for duplicate-session-exercise and metric edge cases.
  - Prefer UX tests with mocked service output over database fixture setup for panel rendering, navigation, and failure-state behavior.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/src/data/exercise-block-history.ts` or a narrowly scoped addition to `apps/mobile/src/data/exercise-history.ts`
  - `apps/mobile/src/data/index.ts` if a new repository function needs a barrel export
  - `apps/mobile/app/(tabs)/session-recorder.tsx`
  - `apps/mobile/components/session-recorder/**` if extracting a focused display component keeps the route manageable
  - `apps/mobile/src/maestro/**` and `apps/mobile/app/maestro-harness.tsx` if adding fixture setup through the hidden harness
  - `apps/mobile/.maestro/flows/**` if adding a checked-in exercise-block-history visual QA flow
  - `apps/mobile/app/__tests__/exercise-block-history.test.ts` or equivalent data test file
  - `apps/mobile/app/__tests__/maestro-harness.test.ts` or equivalent harness/fixture test file
  - `apps/mobile/app/__tests__/session-recorder-interactions.test.tsx` and/or `session-recorder-screen.test.tsx`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/components-catalog.md` only if a reusable component is added
  - `docs/specs/11-maestro-runtime-and-testing-conventions.md` only if the harness query contract changes
  - `RUNBOOK.md` only if operator commands/workflows change
- Project structure impact:
  - No new top-level paths or canonical folder changes expected.
  - Adding a feature-specific data module under `apps/mobile/src/data/` and optional component under `apps/mobile/components/session-recorder/` fits existing structure and does not require `docs/specs/09-project-structure.md` updates.
- Constraints/assumptions:
  - No data model or sync impact: this is a read-only derived projection over existing local `sessions`, `session_exercises`, and `exercise_sets`.
  - Do not persist block navigator index in session drafts.
  - Do not enqueue sync events for history panel state.
  - Use existing set parsing/calculation helpers rather than duplicating math.
  - Keep history loading per exercise definition efficient enough for recorder use; avoid whole-history loading when a bounded query can return the recent session IDs first.
  - If two completed sessions share identical `completedAt`, tie-break deterministically, for example by `sessionId`.
  - Agent 2C should seed local SQLite fixture data, not create a Supabase/auth user, unless the human explicitly expands this into sync/auth QA.
  - Agent 2C should keep fixture data dev/test-only and reachable through the existing Maestro harness guard.

## Agent 3 testing/review checklist

- Confirm Agent 2 worked from branch `codex/issue-70-exercise-block-history`.
### Agent 3A - numeric/service checklist

- Confirm the service/data contract can be tested without rendering the recorder.
- Review the data query for:
  - distinct session limit before set loading,
  - newest-first ordering,
  - duplicate same-exercise rows in one session merged into one block,
  - exclusion of soft-deleted and incomplete sessions.
- Review metric logic for:
  - warm-up exclusion,
  - invalid text weight/reps handling,
  - `rir_0 | rir_1 | rir_2` count,
  - reuse of existing 1RM/volume parsing helpers.
- Run the numeric/service targeted tests and inspect at least one edge-case fixture directly.

### Agent 3B - UX quality checklist

- Confirm the UX consumes the service/data contract rather than duplicating query or calculation rules in the route component.
- Review recorder UI for:
  - default most-recent block,
  - `<<` older and `>>` newer directionality,
  - disabled boundary behavior,
  - empty/loading/error states remaining non-blocking.
- Review visual quality for:
  - compact mobile density without cramped or overlapping text,
  - clear distinction between historical stats and current editable sets,
  - accessibility labels for older/newer controls,
  - no raw color literals or token bypasses.
- Run the UX targeted tests, UI guardrail check, and full frontend fast gate; record exact results.
- Capture or verify the required visual evidence.
- Leave only high-signal findings with file/line references if anything remains.

### Agent 2C - fixture/QA-data checklist

- Branch from the latest `codex/issue-70-exercise-block-history-3B` state into `codex/issue-70-exercise-block-history-fixture`.
- Add a deterministic local fixture path, preferably via `boga3://maestro-harness?reset=data&fixture=exercise-block-history&teleport=session-recorder`.
- Fixture should create enough completed local history to exercise:
  - populated latest block,
  - older/newer block navigation,
  - at least five completed sessions for one exercise,
  - duplicate same-exercise rows inside one completed session,
  - at least one second exercise with different history,
  - at least one exercise with no prior block history.
- Add a checked-in Maestro flow or clearly named reusable QA flow that uses the fixture and captures the recorder panel.
- Update `docs/specs/11-maestro-runtime-and-testing-conventions.md` if the harness query contract changes.
- Update `RUNBOOK.md` only if a new human-facing command/workflow should be documented.
- Hand off to Agent 3B after fixture tests and the fixture Maestro flow pass, or document the exact blocker.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `N/A` for planned scope; run `./scripts/quality-slow.sh frontend` only if implementation expands into native/runtime-sensitive behavior.
- Optional closeout validation helper:
  - `./scripts/task-closeout-check.sh docs/tasks/T-20260526-01-issue-70-exercise-block-history.md`
- Additional gate(s):
  - Numeric/service: `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/exercise-block-history.test.ts` or adapted exact target file.
  - UX: `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-interactions.test.tsx app/__tests__/session-recorder-screen.test.tsx` or adapted exact target files.
  - Fixture/QA: `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/maestro-harness.test.ts app/__tests__/exercise-block-history.test.ts` or adapted exact target files.
  - `cd apps/mobile && npm run lint:ui-guardrails`
  - Agent 2C/3B fixture visual proof: run the checked-in exercise-block-history Maestro fixture flow and record the artifact path, or document the exact simulator/runtime blocker.

## Evidence

- Targeted Jest output:
  - Agent 2A: `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/exercise-block-history.test.ts` - passed, 7 tests.
  - Agent 2A: `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/exercise-history-repository.test.ts app/__tests__/exercise-calculations.test.ts app/__tests__/exercise-block-history.test.ts` - passed, 44 tests.
  - Agent 2A: `cd apps/mobile && npm test -- --runInBand` - passed, 50 suites / 364 tests / 1 snapshot.
  - Agent 2B: `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-interactions.test.tsx app/__tests__/session-recorder-screen.test.tsx` - passed, 45 tests.
  - Agent 2B: `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/exercise-block-history.test.ts app/__tests__/session-recorder-interactions.test.tsx app/__tests__/session-recorder-screen.test.tsx` - passed, 52 tests.
  - Agent 2B: `cd apps/mobile && npm test -- --runInBand` - passed, 50 suites / 367 tests / 1 snapshot. Existing console warnings from unrelated VirtualizedList/logging tests appeared, but all suites passed.
  - Agent 3A: `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/exercise-block-history.test.ts` - passed before review edits, 7 tests.
  - Agent 3A: `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/exercise-block-history.test.ts` - passed after adding numeric-review coverage, 11 tests.
  - Agent 3B: `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-interactions.test.tsx app/__tests__/session-recorder-screen.test.tsx` - passed before review edits, 45 tests.
  - Agent 3B: `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-interactions.test.tsx app/__tests__/session-recorder-screen.test.tsx` - passed after UX quality fix, 45 tests.
  - Agent 3B: `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-interactions.test.tsx app/__tests__/session-recorder-screen.test.tsx` - passed after relabeling the `RIR <= 2` metric to `Near failure`, 45 tests.
  - Agent 2C: `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/maestro-harness.test.ts app/__tests__/exercise-block-history.test.ts` - passed after adding harness fixture support, 18 tests.
- UI guardrail output:
  - Agent 2A: `cd apps/mobile && npm run lint:ui-guardrails` - passed, 0 raw-color violations.
  - Agent 2B: `cd apps/mobile && npm run lint:ui-guardrails` - passed, 0 raw-color violations.
  - Agent 3A: `cd apps/mobile && npm run lint:ui-guardrails` - passed, 0 raw-color violations.
  - Agent 3B: `cd apps/mobile && npm run lint:ui-guardrails` - passed before and after review edits, 0 raw-color violations.
  - Agent 2C: `cd apps/mobile && npm run lint:ui-guardrails` - passed, 0 raw-color violations.
- Fast gate output:
  - Agent 2A: `./scripts/quality-fast.sh frontend` - failed during `npm run typecheck` before tests because `scripts/check-sync-schema-drift.ts` cannot resolve `better-sqlite3` and `pg` types and has three existing implicit-`any` diagnostics on `row` parameters.
  - Agent 2A: `cd apps/mobile && npm run lint` - passed.
  - Agent 2A: `cd apps/mobile && npm run typecheck` - same `scripts/check-sync-schema-drift.ts` failure as the fast gate.
  - Agent 2B: `cd apps/mobile && npm run lint` - passed.
  - Agent 2B: `cd apps/mobile && npm run typecheck` - same existing `scripts/check-sync-schema-drift.ts` failure (`better-sqlite3` / `pg` type resolution and three implicit `row` anys), before task-specific type errors are reported.
  - Agent 2B: `./scripts/quality-fast.sh frontend` - `lint` passed, then failed at the same `npm run typecheck` blocker before running the test step.
  - Agent 3A: `./scripts/quality-fast.sh frontend` - first attempt failed at `npm run typecheck` because this worktree's `apps/mobile/node_modules` was missing declared devDependencies `better-sqlite3` and `pg`.
  - Agent 3A: `cd apps/mobile && npm install` - restored missing declared dependencies without tracked lockfile changes.
  - Agent 3A: `./scripts/quality-fast.sh frontend` - passed after dependency restore, 50 suites / 371 tests / 1 snapshot. Existing console warnings from unrelated VirtualizedList/logging tests appeared, but all suites passed.
  - Agent 3B: `./scripts/quality-fast.sh frontend` - passed, 50 suites / 371 tests / 1 snapshot. Existing console warnings from unrelated `logging-log-event` tests appeared, but all suites passed.
  - Agent 3B: `./scripts/quality-fast.sh frontend` - passed again after the `Near failure` label change, 50 suites / 371 tests / 1 snapshot. Existing console warnings from unrelated `logging-log-event` tests appeared, but all suites passed.
  - Agent 2C: `cd apps/mobile && npm run typecheck` - passed.
  - Agent 2C: `cd apps/mobile && npm run lint` - passed.
  - Agent 2C: `./scripts/quality-fast.sh frontend` - passed, 50 suites / 373 tests / 1 snapshot. Existing console warnings from unrelated `logging-log-event` tests appeared, but all suites passed.
- Maestro / simulator visual output:
  - Agent 3B: `PATH="/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk" TASK_ID=T-20260526-01-issue-70-exercise-block-history-3B ./scripts/maestro-ios-run-flow.sh --flow .maestro/flows/exercise-block-history-visual.tmp.yaml --scenario exercise-block-history-visual` - passed after tuning the temporary QA flow selector, 1 flow / 52s on simulator `BOGA wt1` (`8EE7AAC8-0DD9-4EFA-852A-737A7C5746F8`). The temporary flow created a completed `Barbell Back Squat` session, opened a new recorder session, selected the same exercise, waited for `exercise-block-history-panel-1`, and captured the populated panel screenshot. Artifact: `apps/mobile/artifacts/maestro/T-20260526-01-issue-70-exercise-block-history-3B/20260526-223857-24473/maestro-output/screenshots/exercise-block-history-populated-panel.png`.
  - Agent 3B: after relabeling the `RIR <= 2` metric as `Near failure`, the same temporary Maestro QA flow passed again, 1 flow / 52s on simulator `BOGA wt1` (`8EE7AAC8-0DD9-4EFA-852A-737A7C5746F8`). Artifact: `apps/mobile/artifacts/maestro/T-20260526-01-issue-70-exercise-block-history-3B/20260526-224517-25757/maestro-output/screenshots/exercise-block-history-populated-panel.png`.
  - Agent 2C: first checked-in fixture flow attempt reached the exercise picker but failed on an exact text selector for `Barbell Back Squat`; the flow was tuned to use the same stable point-tap picker strategy as existing flows.
  - Agent 2C: `PATH="/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk" TASK_ID=T-20260526-01-issue-70-exercise-block-history-2C ./scripts/maestro-ios-run-flow.sh --flow .maestro/flows/exercise-block-history-fixture.yaml --scenario exercise-block-history-fixture` - passed, 1 flow / 32s on simulator `BOGA wt1` (`8EE7AAC8-0DD9-4EFA-852A-737A7C5746F8`). The flow used `boga3://maestro-harness?reset=data&fixture=exercise-block-history&teleport=session-recorder`, selected `Barbell Back Squat`, captured latest and older populated panels, selected `Lat Pulldown`, and captured the empty state. Artifacts: `apps/mobile/artifacts/maestro/T-20260526-01-issue-70-exercise-block-history-2C/20260527-152125-8326/maestro-output/screenshots/exercise-block-history-latest.png`, `apps/mobile/artifacts/maestro/T-20260526-01-issue-70-exercise-block-history-2C/20260527-152125-8326/maestro-output/screenshots/exercise-block-history-older.png`, `apps/mobile/artifacts/maestro/T-20260526-01-issue-70-exercise-block-history-2C/20260527-152125-8326/maestro-output/screenshots/exercise-block-history-empty.png`.
- Closeout helper output:
  - Agent 2B: `./scripts/task-closeout-check.sh docs/tasks/T-20260526-01-issue-70-exercise-block-history.md` - failed because task status intentionally remains `in_progress` for Agent 3A/3B review handoff rather than final closeout.
  - Agent 3B: `./scripts/task-closeout-check.sh docs/tasks/T-20260526-01-issue-70-exercise-block-history.md` - failed because task status intentionally remains `in_progress` for final orchestrator comparison/integration rather than final closeout.
  - Agent 2C: `./scripts/task-closeout-check.sh docs/tasks/T-20260526-01-issue-70-exercise-block-history.md` - failed because task status intentionally remains `in_progress` for Agent 3B follow-up and final orchestrator comparison/integration rather than final closeout.
- UI/UX task visual artifacts note:
  - Agent 2B covered the key visible states through React Native Testing Library rendered-state assertions: populated latest block, older/newer navigation, empty state, and error state while set entry remains usable. No simulator screenshot was captured in this 2B pass because the task's slow native gate remains `N/A`.
  - Agent 3B captured simulator visual evidence for a populated recent-block panel via a temporary Maestro QA flow. The screenshot shows the panel in the real iOS simulator with `Previous block`, metric grid, disabled `<<`/`>>` controls, and editable set rows still visible below.
  - Agent 2C added a checked-in fixture flow and captured real-simulator screenshots for latest populated, older populated, and empty no-history states using deterministic local SQLite fixture data.
- Manual verification summary (required when CI is absent/partial): Agent 2A implemented and tested the service/data lane. Agent 2B wired the recorder UX, updated UI docs, and tested rendered interaction/state behavior. Agent 3A reviewed the numeric/service lane, added focused coverage for Wathan best-estimate selection, ordered limits, invalid dates/limits, and repository invalid-limit short-circuiting, then reran the frontend fast gate successfully. Agent 3B reviewed recorder interaction/visual quality, improved the block-history nav controls with button accessibility roles and 44pt touch targets, verified rendered state coverage, reran the UI guardrail check, reran the frontend fast gate successfully, and captured simulator screenshot evidence for the populated panel with Maestro. Agent 2C added deterministic local SQLite fixture support through the Maestro harness, checked in a reusable fixture flow, updated the Maestro contract and runbook command surface, reran targeted fixture tests, UI guardrails, frontend fast gate, and the new simulator fixture flow successfully.
- Deferred/manual hosted checks summary:
  - N/A expected; no hosted/backend work.

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed: Agent 2A added `apps/mobile/src/data/exercise-block-history.ts`, exported it from `apps/mobile/src/data/index.ts`, and added `apps/mobile/app/__tests__/exercise-block-history.test.ts`. The new data/service contract loads distinct recent completed, non-deleted sessions for an `exerciseDefinitionId`, fetches matching logged exercise rows and sets, merges duplicate same-exercise rows inside a session, and returns compact format-ready block stats: `daysAgo`, estimated 1RM, total volume, highest weight, and `<=2 RIR` set count.
- What changed: Agent 2B wired the recorder UI to `loadRecentExerciseBlocks`, adding a compact per-exercise read-only history panel below tags and above set rows. The panel shows latest block stats by default, supports `<<` older and `>>` newer navigation with disabled boundaries, resets when an exercise card changes definition, and keeps loading/empty/error states inline and non-blocking. Agent 2B also updated `docs/specs/ui/ux-rules.md` and `docs/specs/ui/screen-map.md`. `docs/specs/ui/components-catalog.md` was not changed because no reusable component API was added, and `docs/specs/ui/navigation-contract.md` was not changed because no route/param/transition behavior changed.
- What changed: Agent 3A added focused numeric/service review coverage to `apps/mobile/app/__tests__/exercise-block-history.test.ts` for Wathan best-estimate selection, newest-first limit application, invalid `now`/`completedAt`/`limit` handling, and repository invalid-limit short-circuiting before store access. No production code change was needed after review.
- What changed: Agent 3B reviewed recorder interaction/visual quality against the UX standard and UI docs, then made focused UX/accessibility fixes: the `<<` and `>>` previous-block controls now expose `accessibilityRole="button"` and use a 44pt minimum touch target, and the `RIR <= 2` metric display label is now `Near failure` for better readability while preserving the underlying metric semantics. Agent 3B also extended the recorder interaction test to lock the button roles and label.
- What changed: Agent 2C added dev-only `fixture=exercise-block-history` harness support, a deterministic local SQLite fixture seeding helper, and a checked-in Maestro flow at `apps/mobile/.maestro/flows/exercise-block-history-fixture.yaml`. The fixture seeds six `Barbell Back Squat` completed sessions, duplicate same-exercise rows in the latest completed session, a second exercise with separate history, warm-up/near-failure/invalid set cases, and leaves `Lat Pulldown` with no prior block history. Agent 2C updated the Maestro harness contract doc and `RUNBOOK.md` because the reusable flow is now part of the local QA command surface.
- What tests ran: Agent 2A targeted service/data tests passed; Agent 2B targeted recorder UX tests passed; combined service+UX targeted tests passed; full `npm test -- --runInBand` passed; `npm run lint` passed; `npm run lint:ui-guardrails` passed. Agent 3A reran the targeted numeric test before and after review edits, reran `npm run lint:ui-guardrails`, restored missing declared `apps/mobile` dependencies with `npm install`, and reran `./scripts/quality-fast.sh frontend` successfully. Agent 3B reran the targeted recorder UX tests before and after the UX fix, reran `npm run lint:ui-guardrails`, reran `./scripts/quality-fast.sh frontend`, and ran a temporary Maestro simulator QA flow that captured the populated block-history panel successfully. Agent 2C ran targeted harness/block-history tests, `npm run typecheck`, `npm run lint`, `npm run lint:ui-guardrails`, `./scripts/quality-fast.sh frontend`, and the checked-in Maestro fixture flow successfully.
- What remains: The task card intentionally remains `in_progress` for final orchestrator comparison/integration across agent branches, so Agent 2C did not move the card to `docs/tasks/complete/`. Agent 3B should continue from `codex/issue-70-exercise-block-history-fixture`, rerun any desired UX visual QA using the checked-in fixture flow, and update final evidence. No data model or sync-scope change was made.

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Ensure completion note is filled before handoff.
- If the task changed significant cross-cutting behavior, ensure the relevant project-level docs (`03`, `04`, `05`, `06`) were updated in the same session rather than only the milestone/task docs.
- For UI/UX tasks, update the relevant `docs/specs/ui/*.md` files or record explicit `no update` rationale, and keep entries synthetic/overview-first.
- If significant project-structure changes were made, update `docs/specs/09-project-structure.md` and mention it in completion note.
- Update parent milestone task breakdown/status in the same session.
- Run `./scripts/task-closeout-check.sh docs/tasks/T-20260526-01-issue-70-exercise-block-history.md` or document why `N/A` before handoff.
- Record `RUNBOOK.md reviewed (no changes required)` in the completion note if local operator workflow did not change.
