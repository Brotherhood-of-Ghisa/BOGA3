---
task_id: T-20260526-01-issue-70-exercise-block-history
milestone_id: "M1"
status: planned
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
- Status: `planned`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-05-26`
- Session interaction mode: `interactive (default)`
- Implementation/review branch:
  - Use one integration branch: `codex/issue-70-exercise-block-history`.
  - Agent 2A (service/data implementation) should create/switch to that branch from fresh `main`, implement the background-service/data layer slice, run its targeted numeric tests, and hand off with a clean working tree or clearly documented partial state.
  - Agent 2B (UX implementation) should continue from the Agent 2A branch state, wire the recorder UI, update UI docs, run targeted UX tests, and hand off to testing/review.
  - Agent 3A (numeric/service reviewer) should test/review the data/service layer for query correctness and metric accuracy.
  - Agent 3B (UX quality reviewer) should test/review the recorder interaction and visual quality, apply small verification fixes on the same branch when appropriate, and otherwise leave actionable findings in the task completion/review notes.
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

- Verified current branch + HEAD commit: task authored on `main` at `df5e97f`.
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `yes` - task-writing session ran `git fetch origin main && git pull --ff-only origin main`; local `HEAD...origin/main` was `0 0`.
- Parent refs opened in this task-writing session:
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
  - `docs/specs/templates/task-card-template.md`
  - `docs/plans/README.md`
  - `RUNBOOK.md`
- Code/docs inventory freshness checks run:
  - `rg --files apps/mobile/app apps/mobile/src apps/mobile/components | rg 'session-recorder|exercise-history|session|exercise|stats|history'` - identified existing recorder, exercise-history, session-list, calculation, and test surfaces.
  - `rg "estimated|1RM|one rep|volume|RIR|set_type|rir_" apps/mobile docs/specs -g '!docs/brainstorms/**'` - confirmed existing 1RM/volume helpers and `set_type` semantics.
  - Source review of `apps/mobile/src/data/exercise-history.ts`, `apps/mobile/src/exercise-calculations/index.ts`, `apps/mobile/src/data/set-types.ts`, `apps/mobile/app/(tabs)/session-recorder.tsx`, `apps/mobile/components/session-recorder/session-content-layout.tsx`, `apps/mobile/components/session-recorder/types.ts`, and relevant recorder/exercise-history tests.
- Known stale references or assumptions:
  - Assumption: `n = 5` recent completed sessions at initial implementation unless the implementer finds an existing product constant or the human gives a different value before coding.
  - Assumption: "up to n sessions" means distinct completed sessions, newest first, not distinct `session_exercises` rows.
  - Assumption: multiple same-exercise `session_exercises` in one completed session are merged into one displayed block.
  - Agent 2 must refresh this section with the branch HEAD and any newly inspected files before edits.
- Optional helper command (recommended):
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260526-01-issue-70-exercise-block-history.md`

## Objective

Implement the first Issue 70 slice in the session recorder: when a user selects/logs an exercise, show a compact, read-only navigator through up to `n` most recent completed-session blocks containing that exercise, starting from the most recent block and exposing only summary stats.

## Workstream split

This remains one task card and one integration branch, but execution should be split into service/data and UX workstreams so each agent has a crisp ownership boundary.

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
  - number of sets with not more than `2 RIR`.
- Add targeted data aggregation and recorder UI tests.
- Split verification between numeric/service tests and UX interaction/quality tests.
- Update relevant UI docs to reflect the new recorder block-history behavior.

### Out of scope

- Creating a new milestone for Issue 70.
- Planner/ghost repeat-set generation.
- Copying prior block sets into the active session.
- Showing full historic set rows/details inside the recorder.
- New schema, migrations, backend changes, sync contract changes, or analytics materialization.
- Route, query-param, or navigation changes.
- Maestro automation unless implementation unexpectedly changes native/runtime-sensitive behavior.

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
- Tokens/primitives compliance statement:
  - Reuse plan: existing `SessionContentLayout`, route-local recorder card patterns, and `uiTokens`/`uiColors` from `apps/mobile/components/ui`.
  - Exceptions: none expected; no raw literals or new primitive extraction required.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md` or task scope?: `yes`
  - Planned captures/artifacts:
    - Recorder card showing a populated latest block.
    - Recorder card after navigating to an older block.
    - Empty or error state for an exercise without available block history.

## Testing and verification approach

- Planned checks/commands:
  - Agent 2A / Agent 3A numeric-service lane:
    - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/exercise-block-history.test.ts`
    - If implementation extends existing `exercise-history` tests instead of adding a new file, adapt to the exact service/data test path.
  - Agent 2B / Agent 3B UX lane:
    - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-interactions.test.tsx app/__tests__/session-recorder-screen.test.tsx`
    - If UX coverage lands in a narrower new test file, adapt to the exact recorder UI test path.
  - If implementation extends existing `exercise-history` repository instead of adding a new file, adapt the targeted path to the actual test file names.
  - `cd apps/mobile && npm run lint:ui-guardrails`
  - `./scripts/quality-fast.sh frontend`
- Standard local gate usage:
  - `./scripts/quality-fast.sh frontend` required.
  - `./scripts/quality-slow.sh frontend` is `N/A` unless implementation unexpectedly changes native runtime behavior, Maestro harness flows, navigation, or keyboard/geometry-sensitive UI.
- Test layers covered:
  - Numeric/service layer: unit/data aggregation tests for recent block query/aggregation and metric calculation.
  - UX layer: React Native Testing Library route/component tests for recorder display, navigation buttons, empty/loading/error states, and non-blocking logging behavior.
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
  - `apps/mobile/app/__tests__/exercise-block-history.test.ts` or equivalent data test file
  - `apps/mobile/app/__tests__/session-recorder-interactions.test.tsx` and/or `session-recorder-screen.test.tsx`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/components-catalog.md` only if a reusable component is added
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

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `N/A` for planned scope; run `./scripts/quality-slow.sh frontend` only if implementation expands into native/runtime-sensitive behavior.
- Optional closeout validation helper:
  - `./scripts/task-closeout-check.sh docs/tasks/T-20260526-01-issue-70-exercise-block-history.md`
- Additional gate(s):
  - Numeric/service: `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/exercise-block-history.test.ts` or adapted exact target file.
  - UX: `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-interactions.test.tsx app/__tests__/session-recorder-screen.test.tsx` or adapted exact target files.
  - `cd apps/mobile && npm run lint:ui-guardrails`

## Evidence

- Targeted Jest output:
  - Fill at implementation/test closeout.
- UI guardrail output:
  - Fill at implementation/test closeout.
- Fast gate output:
  - Fill at implementation/test closeout.
- UI/UX task visual artifacts note:
  - Required; record screenshot/capture paths or equivalent evidence for populated, navigated, and empty/error block panel states.
- Manual verification summary:
  - Fill at implementation/test closeout. Include whether Agent 3 reviewed/tested the Agent 2 branch.
- Deferred/manual hosted checks summary:
  - N/A expected; no hosted/backend work.

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed:
- What tests ran:
- What remains:

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
