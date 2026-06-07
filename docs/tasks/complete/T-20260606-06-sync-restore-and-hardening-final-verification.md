---
task_id: T-20260606-06-sync-restore-and-hardening-final-verification
milestone_id: "M13"
status: completed
ui_impact: "yes"
areas: "frontend|backend|cross-stack|docs"
runtimes: "node|expo|maestro|supabase"
gates_fast: "./scripts/quality-fast.sh"
gates_slow: "./scripts/quality-slow.sh frontend && ./scripts/quality-slow.sh backend"
docs_touched: "docs/specs/03-technical-architecture.md,docs/specs/05-data-model.md,docs/specs/06-testing-strategy.md,docs/specs/tech/client-sync-engine.md,docs/specs/ui/screen-map.md,docs/specs/ui/ux-rules.md,RUNBOOK.md"
---

# Task Card

## Task metadata

- Task ID: `T-20260606-06-sync-restore-and-hardening-final-verification`
- Title: Final verification for sync restore, FK hardening, logging, and existing-test compatibility
- Status: `completed`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-06-06`
- Session interaction mode: `interactive (default)`

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M13-simple-backend-sync.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- AI development playbook: `docs/specs/04-ai-development-playbook.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
- Client sync engine deep-dive: `docs/specs/tech/client-sync-engine.md`
- Review input: `docs/reviews/db-sync-offline-fk-review-2026-06-06.md`
- Preceding task cards:
  - `docs/tasks/T-20260517-01-personal-gym-list-sync.md`
  - `docs/tasks/T-20260606-01-sync-local-sqlite-fk-enforcement.md`
  - `docs/tasks/T-20260606-02-sync-pull-fk-error-classification.md`
  - `docs/tasks/T-20260606-03-sync-scheduler-result-semantics.md`
  - `docs/tasks/T-20260606-04-sync-push-fk-preflight.md`
  - `docs/tasks/T-20260606-05-sync-quarantine-and-observability.md`
- Worktree/runtime isolation: `docs/specs/12-worktree-config-and-isolation.md`
- Human run/test/debug guide: `RUNBOOK.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit: `codex/review-db-sync-functionalities-for-issues` at `9927677`
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `N/A` — working on the existing feature branch; no upstream sync requested for this verification pass.
- Parent refs opened in this session:
  - `docs/specs/README.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/04-ai-development-playbook.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/12-worktree-config-and-isolation.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/tech/client-sync-engine.md`
  - `docs/reviews/db-sync-offline-fk-review-2026-06-06.md`
  - `RUNBOOK.md`
- Code/docs inventory freshness checks run:
  - Confirm current state of all preceding task cards and whether any were completed, superseded, or not yet started.
  - Inspect `apps/mobile/src/sync/**`, `apps/mobile/src/data/bootstrap.ts`, `apps/mobile/src/data/local-gyms.ts`, recorder gym picker code, and sync status/gate code.
  - Inspect backend Sync v2 wrappers under `supabase/scripts/test-sync-v2-*.sh` and `supabase/tests/sync-v2-*.sh`.
- Known stale references or assumptions:
  - Single-device-per-user remains the product assumption. Do not add multi-device conflict resolution in this final verification card.
  - Preceding tasks `T-20260606-01..05` are all `completed` and moved to `docs/tasks/complete/`. `T-20260517-01-personal-gym-list-sync` remains `planned` (unstarted) and owns the recorder gym-picker DB-backed list/visibility work.
  - The "remote gyms not visible on mobile" symptom is a **UI** bug, not a sync bug: the sync/data layer correctly restores remote gyms into local SQLite, but the recorder picker still seeds from the hardcoded `SEEDED_LOCATIONS` constant and never lists the local `gyms` table. Wiring the picker to read the table is `T-20260517-01`'s deliverable. Per human decision (interactive), this card verifies the sync layer and defers the picker-visibility assertion to `T-20260517-01`.
  - The 0517 freshness note that local `gyms` has no `deleted_at` is now stale — `deleted_at`/`local_dirty` columns exist in `apps/mobile/src/data/schema/gyms.ts`.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260606-06-sync-restore-and-hardening-final-verification.md`

## Objective

Prove the completed sync restore and FK-hardening work is compatible with all pre-existing relevant tests and gates, and add a final regression check for the concrete bug: an empty local DB connecting to a remote account with gyms must pull those remote gyms and show them on mobile.

## Scope

### In scope

- Verify all preceding sync restore/hardening tasks are either completed or explicitly superseded.
- Add a focused regression test for empty-local-db remote gym restore and mobile visibility if it does not already exist.
- Run the full pre-existing frontend and backend gates relevant to sync, data, auth, and mobile runtime behavior.
- Run the existing Sync v2 backend suites unchanged; do not weaken or delete existing tests to make the final gate pass.
- Run existing frontend sync suites unchanged except for intentional updates required by completed behavior changes.
- Verify structured logging exists for the new error/exception paths and that logger failures remain non-blocking.
- Verify docs are aligned with the final implemented behavior.

### Out of scope

- New feature work beyond the final regression test and any small fixes needed to make the completed task set pass.
- Multi-device conflict resolution.
- Hosted production reset unless explicitly requested by the human.
- Full user-facing sync repair UI beyond existing/status surfaces.

## UI Impact (required checkpoint)

- UI Impact?: `yes`
- Rationale:
  - The final regression must prove remote gyms restored into an empty local DB are visible in the mobile gym picker/list. If no UI code changes are required, still capture UI/e2e evidence or test evidence that covers the user-visible path.

## UX Contract

### Key user flows

1. Flow name: Empty local DB restores remote gyms
   - Trigger: User signs in or connects sync on a device with an empty local SQLite DB while remote already contains one or more personal gyms.
   - Steps: first sync/bootstrap pulls remote layer 0 data, persists gyms locally, then recorder/profile gym surfaces reload from SQLite.
   - Success outcome: remote gyms are visible on mobile without the user creating a new local gym, and the empty-state `Local Gym` starter is not shown as the only apparent option when restored gyms exist.
   - Failure/edge outcome: if remote pull fails, sync status/logs show a structured error and no false successful-sync timestamp is recorded.

### Interaction + appearance notes

- Do not redesign the picker/status UI in this final card.
- Reuse existing recorder gym picker/status surfaces.
- Keep diagnostic text concise if any visible state needs adjustment.

## Acceptance criteria

1. A regression test proves: remote account has gym rows, local SQLite starts empty, authenticated sync/bootstrap runs, local `gyms` contains the remote rows, and the mobile gym picker/list displays them.
2. The regression test fails on the known bug where remote gyms are not synced/visible.
3. Existing frontend sync/data/auth tests continue to pass without deleting or weakening assertions.
4. Existing backend Sync v2 contract/e2e suites continue to pass without deleting or weakening assertions.
5. Existing Maestro slow gates relevant to signed-in sync/profile/data-smoke pass.
6. Local SQLite FK enforcement remains enabled and tested.
7. Pull-side FK failures remain structured/logged and do not advance cursors.
8. Scheduler success semantics still distinguish real convergence from auth-required/retryable/structural failures.
9. Push-side FK preflight and quarantine behavior still allow valid independent rows to sync while blocked rows remain diagnosable.
10. Structured logging for new sync errors/exceptions is covered by tests or explicit manual evidence.
11. Logger failures are covered as non-blocking for the new instrumentation paths.
12. UI docs and sync/data docs match final behavior, especially personal gym restore visibility and empty-state behavior.
13. Any remaining failures are fixed in this task unless they are outside scope and explicitly approved as a follow-up by the human.

## Docs touched (required)

- Planned docs/spec files to update and why:
  - `docs/specs/03-technical-architecture.md` - update only if final behavior differs from preceding task docs.
  - `docs/specs/05-data-model.md` - verify sync runtime/quarantine/FK/gym restore state is accurately documented.
  - `docs/specs/06-testing-strategy.md` - add final regression/gate expectations if not already present.
  - `docs/specs/tech/client-sync-engine.md` - verify restore, logging, FK hardening, scheduler result, and quarantine behavior.
  - `docs/specs/ui/screen-map.md` - update if gym picker restore/empty-state behavior changed.
  - `docs/specs/ui/ux-rules.md` - update if personal gym restore/empty-state semantics changed.
  - `RUNBOOK.md` - review; update only if local run/test/log workflow changed.
- UI docs update required?: `yes`, if gym picker/list behavior or visible status semantics changed.
- Tokens/primitives compliance statement:
  - Reuse plan: existing recorder/profile/status components and UI primitives.
  - Exceptions: none planned.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md` or task scope?: `yes`
  - Planned captures/artifacts:
    - remote gym visible in picker/list after empty-local-db restore
    - sync status in successful restored state

## Testing and verification approach

- Planned checks/commands:
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/sync/cycle-round-trip.test.ts app/__tests__/sync/auth-required-envelope.test.ts app/__tests__/sync/drift-check.test.ts`
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/sync-cycle-pull.test.ts app/__tests__/sync-cycle-push.test.ts app/__tests__/sync-cycle-convergence.test.ts app/__tests__/sync-cycle-race.test.ts`
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/sync-scheduler.test.ts app/__tests__/sync/scheduler-state-table.test.ts app/__tests__/scheduler-status-accessor.test.ts app/__tests__/sync-status-composer.test.ts`
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/sync/dirty-bit-per-entity.test.ts`
  - `cd apps/mobile && npm test -- --runTestsByPath <new-or-existing-remote-gym-restore-regression-test>`
  - `cd apps/mobile && npm run db:generate:canary`
  - `./scripts/quality-fast.sh`
  - `./scripts/quality-slow.sh backend`
  - `cd apps/mobile && npm run test:sync:infra` when `SUPABASE_BRANCH_URL` / `SUPABASE_BRANCH_ANON_KEY` are available; otherwise document the narrow env-based deferral.
  - `cd apps/mobile && npm run test:e2e:ios:gates`
  - `cd apps/mobile && npm run test:e2e:ios:auth-profile`
- Standard local gate usage:
  - `./scripts/quality-fast.sh` is mandatory.
  - `./scripts/quality-slow.sh backend` is mandatory because this final check must preserve Sync v2 contract coverage.
  - `test:e2e:ios:gates` and `test:e2e:ios:auth-profile` are mandatory for mobile runtime/signed-in coverage.
  - `test:sync:infra` is mandatory only when branch Supabase env is configured; this is the only acceptable deferral listed by repo policy.
- Test layers covered:
  - Jest unit/integration
  - local SQLite migration/schema canary
  - live/branch sync infra where configured
  - local Supabase backend contract/e2e
  - Maestro iOS smoke/data-smoke/auth-profile
- Execution triggers:
  - always run in this final card after preceding implementation cards land.
- Slow-gate triggers:
  - mandatory.
- Hosted/deployed smoke ownership:
  - `N/A` unless a preceding task changed hosted deployment/config; if changed, this card must name the exact hosted smoke command or owner.
- CI/manual posture note:
  - CI does not cover slow backend/Maestro lanes. This card must record local evidence for all mandatory slow gates.

## Implementation notes

- Planned files/areas allowed to change:
  - tests under `apps/mobile/app/__tests__/**`
  - small fixes in `apps/mobile/src/sync/**`, `apps/mobile/src/data/**`, or recorder gym picker code if needed to make final verification pass
  - docs listed above
- Project structure impact:
  - no new top-level paths expected.
- Constraints/assumptions:
  - Do not remove or weaken pre-existing tests.
  - Prefer fixing implementation over changing expectations unless the expectation is demonstrably stale and docs are updated.
  - Do not log full row payloads or user-entered values.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh`
- Standard local slow gate:
  - `./scripts/quality-slow.sh backend`
  - `cd apps/mobile && npm run test:e2e:ios:gates`
  - `cd apps/mobile && npm run test:e2e:ios:auth-profile`
- Additional gate(s):
  - `cd apps/mobile && npm run db:generate:canary`
  - `cd apps/mobile && npm run test:sync:infra` when branch Supabase env is configured
  - targeted tests listed above

## Evidence

- New regression test: `apps/mobile/app/__tests__/sync/remote-gym-restore.test.ts` — `1 passed` (empty local DB + authed `runSyncCycle` against stubbed RPC restores all 3 remote layer-0 gyms into local SQLite, clean and undeleted, in the picker's id+name read shape).
- Targeted Jest (10 fast-lane suites + the new test): `npm test -- --runTestsByPath app/__tests__/sync/cycle-round-trip.test.ts app/__tests__/sync/auth-required-envelope.test.ts app/__tests__/sync/drift-check.test.ts app/__tests__/sync-cycle-pull.test.ts app/__tests__/sync-cycle-push.test.ts app/__tests__/sync-cycle-convergence.test.ts app/__tests__/sync-cycle-race.test.ts app/__tests__/sync-scheduler.test.ts app/__tests__/sync/scheduler-state-table.test.ts app/__tests__/scheduler-status-accessor.test.ts app/__tests__/sync-status-composer.test.ts app/__tests__/sync/dirty-bit-per-entity.test.ts app/__tests__/sync/remote-gym-restore.test.ts` → **10 suites / 128 tests passed**. The 3 infra-only suites (`cycle-round-trip`, `auth-required-envelope`, `drift-check`) are excluded from the fast lane by `jest.config.js` `testPathIgnorePatterns` and run only via `test:sync:infra`.
- `npm run db:generate:canary` → "No schema changes, nothing to migrate"; bundle wrote 2 entries. No drift (test-only change).
- `./scripts/quality-fast.sh` → `[quality-fast] done (all)` (lint + typecheck + jest + local backend/runtime smoke). Pre-existing plpgsql `_idx` shadow warning in `app_public.sync_push` is unrelated.
- `./scripts/quality-slow.sh backend` → `[quality-slow] done (backend)`; Sync v2 e2e suite passed (all 9 integration tests); sync-drift as-built + synthetic checks `errors=0 warnings=0`.
- `test:e2e:ios:gates` (smoke + data-runtime-smoke): first run produced a **vacuous pass** ("Unable to locate a Java Runtime"); re-run with `JAVA_HOME=/opt/homebrew/opt/openjdk` → **PASS** — `smoke-launch` (28s) and `data-runtime-smoke` (1m 3s) both flows passed. Artifacts: `apps/mobile/artifacts/maestro/ad-hoc/20260606-220949-24349`.
- `test:e2e:ios:auth-profile` (with `JAVA_HOME` set) → **PASS** — `auth-profile-happy-path` flow passed (44s), no Java-runtime error.
- `test:sync:infra`: **deferred** — `SUPABASE_BRANCH_URL` and `SUPABASE_BRANCH_ANON_KEY` are unset (confirmed in-session). This is the only repo-sanctioned deferral. The reinstall/restore guarantee is independently covered by the backend `sync-v2-*` contract suites (green above).
- UI/UX task visual artifacts note:
  - No picker screenshot of a restored remote gym is captured here: with `SEEDED_LOCATIONS` still backing the picker (pre-`T-20260517-01`), the recorder does not yet display DB-backed restored gyms. The user-visible path is covered at the data layer by the regression test; the visible-in-picker artifact is owned by `T-20260517-01`.
- Manual verification summary (required when CI is absent/partial): tasks 01–05 are compatible with all pre-existing fast-lane suites (128 tests) and the backend Sync v2 gate (9 tests); the empty-DB remote-gym restore is now guarded at the data layer; picker visibility is deferred to `T-20260517-01`. Details:
  - The sync-restore + FK-hardening series (tasks 01–05) is compatible with all pre-existing fast-lane sync/data/scheduler suites (128 tests green) and the backend Sync v2 contract/e2e gate (9 tests green). FK enforcement, pull-side FK classification + structured logging (`sync.pull_local_fk_violation`), classified `SyncCycleResult` scheduler semantics, push FK preflight, and quarantine behavior all remain covered and green. Structured cycle-result logging and logger-failure-is-non-blocking are exercised by `sync-cycle-convergence.test.ts`. The empty-DB remote-gym restore is now guarded at the data layer. Residual risk: the recorder picker does not yet surface restored gyms — deferred to `T-20260517-01` per human decision.

## Completion note

- What changed: added the fast-lane regression test `apps/mobile/app/__tests__/sync/remote-gym-restore.test.ts` and documented its scope/deferral in `docs/specs/06-testing-strategy.md`; no production code change was required (the sync/data layer from tasks 01–05 already restores remote gyms correctly). Details:
  - The test proves an empty local SQLite DB + first authenticated `runSyncCycle` (stubbed RPC) restores remote layer-0 gyms into the local `gyms` table, clean and undeleted, in the id+name shape the recorder picker reads.
  - The doc bullet records the data/sync coverage here and the picker-visibility deferral to `T-20260517-01`.
- What tests ran: all mandatory gates green except the env-gated `test:sync:infra`, which is deferred per repo policy. Details:
  - Targeted fast-lane sync/data/scheduler suites + the new test: **10 suites / 128 tests passed** (3 infra-only suites excluded by `jest.config.js`).
  - `npm run db:generate:canary`: no schema drift.
  - `./scripts/quality-fast.sh`: done (all).
  - `./scripts/quality-slow.sh backend`: Sync v2 e2e (9 tests) + drift checks green.
  - `npm run test:e2e:ios:gates`: smoke + data-runtime-smoke both passed (after setting `JAVA_HOME`; the first attempt was a vacuous pass with no Java).
  - `npm run test:e2e:ios:auth-profile`: happy-path flow passed.
  - `test:sync:infra`: deferred (branch Supabase env unset — the only repo-sanctioned deferral).
- What remains: the recorder picker-visibility half of the gym restore, deliberately deferred to `T-20260517-01`. Details:
  - The recorder gym **picker** does not yet display DB-backed restored gyms (still seeded from `SEEDED_LOCATIONS`). Making restored gyms visible in the picker is the deliverable of the still-`planned` `T-20260517-01-personal-gym-list-sync`; the picker-visibility regression assertion (and its screenshot artifact) lands with that card. Deferred per human decision in this interactive session.
  - `test:sync:infra` should be run once `SUPABASE_BRANCH_URL`/`SUPABASE_BRANCH_ANON_KEY` are provisioned, to exercise the live `cycle-round-trip` "wiped client re-pulls" reinstall assertion.

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If completed/outdated, move this file to `docs/tasks/complete/`.
- Ensure completion note includes final gate evidence.
- Update affected project-level docs before closeout.
- Run `./scripts/task-closeout-check.sh docs/tasks/T-20260606-06-sync-restore-and-hardening-final-verification.md` or document why `N/A`.
