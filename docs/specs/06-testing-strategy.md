# Testing Strategy (High-Level)

## Purpose

Define the top-level testing stack and working practices for MVP.

Scope boundary:

- This doc owns testing strategy and verification policy.
- App-specific UI route/component inventories and navigation summaries live in `docs/specs/ui/**` (entrypoint: `docs/specs/ui/README.md`) and should remain brief/source-linked.

## Decisions and rationale

1. `Vitest` for unit/domain tests.
Reason: fast feedback loop for logic-heavy parts like set/session calculations and sync state behavior.

2. `React Native Testing Library + jest-expo` for UI/component tests.
Reason: validates real screen behavior with React Native-friendly tooling.

3. `Data layer integration tests` against local SQLite schema.
Reason: catches migration and persistence issues early in an offline-first app.

4. `Two-lane local data verification` for SQLite runtime confidence.
Reason: keep CI feedback fast with deterministic checks while still proving real-device migration and persistence behavior in native Expo runtime.

5. `Backend auth/RLS contract tests`.
Reason: prevents data-leak/security regressions as backend is introduced.

6. `Maestro` for MVP end-to-end flows.
Reason: practical mobile E2E coverage with lower setup cost than heavier alternatives.

7. `Quality gate in CI` (core tests must pass before merge).
Reason: keeps AI-generated changes safe and predictable as code volume grows.

8. `Supabase-local backend contract/integration testing` as the default backend verification lane for M5+.
Reason: validates real auth + `RLS` behavior before hosted deployment and preserves local-first confidence.

9. `Cross-stack E2E strategy` (`Maestro` + local Supabase) is documented before implementation.
Reason: keeps FE/backend integration test expectations explicit without forcing premature E2E build-out during backend foundation work.

## Local data two-lane policy (M2)

- Lane 1 (`CI-safe`):
  - Run fast checks in `apps/mobile` (`lint`, `typecheck`, `test`) and include targeted data-layer tests that validate migration/bootstrap orchestration and smoke insert/read behavior using deterministic test doubles.
  - Include migration-generation canary (`npm run db:generate:canary`) to detect schema/migration artifact drift.
- Lane 2 (`native runtime smoke`):
  - Run a focused smoke flow on Expo native runtime with real `expo-sqlite`.
  - Capture concise evidence: runtime environment, steps executed, migration success signal, and smoke write/read success signal.
- Rule:
  - Do not treat Lane 1 as a substitute for Lane 2 when validating runtime SQLite behavior; both lanes are required for milestone-level local data confidence.

## Default testing practice

- Every feature should include at least one success-path test and one offline/error-path test.
- During execution sessions, run a targeted test or gate after each meaningful change, then run `./scripts/quality-fast.sh` before task closeout.
- Run `./scripts/quality-slow.sh <area>` when the task card's risk triggers require slower local runtime/contract checks.

## Exercise-tag coverage policy (M12 onward)

- Applies to exercise-tag schema/repository/UI work in the mobile local runtime.
- Required coverage should include:
  - schema/migration assertions for `exercise_tag_definitions`, `session_exercise_tags`, and durable `session_exercises.exercise_definition_id` linkage,
  - repository/domain assertions for normalized duplicate prevention, scoped attach validation, and assignment uniqueness protection,
  - assignment-history semantics where soft-deleted tag definitions stay hidden from default suggestions but existing logged-exercise assignments remain queryable/listable,
  - recorder interaction assertions for add/select/create/manage (rename/delete/undelete) and chip removal,
  - completed-edit parity assertions for tag attach/remove behavior already supported in active recorder mode.
- Use targeted Jest coverage for the scenario matrix, and require `./scripts/quality-slow.sh frontend` at milestone closeout or when runtime-sensitive recorder tag behavior changes.

## Mobile auth bootstrap coverage policy (M11 onward)

- Applies to mobile auth/session-foundation work before generic sync exists.
- Required coverage should include:
  - launch/bootstrap with no stored authenticated session,
  - launch/bootstrap with a stored authenticated session,
  - session-restore failure falling back to a safe logged-out state with inline error reporting,
  - explicit sign-out / session-clear behavior,
  - missing auth config or auth-disabled bootstrap path when the task changes config/bootstrap handling.
- Prefer deterministic Jest coverage for the auth bootstrap/service logic and root wiring, then add real local-Supabase + `Maestro` proof once the user-facing auth/profile flow exists.
- Rule:
  - auth bootstrap must remain non-blocking for local-only tracker routes while logged out or when auth config is missing.

## Mobile profile-management coverage policy (M11 onward)

- Applies to authenticated profile UI/data work before generic sync exists.
- Required coverage should include:
  - sign-in success plus invalid-credentials or validation failure feedback,
  - signed-in profile load when a profile row already exists,
  - lazy profile provisioning when `user_profiles` is missing,
  - idempotent lazy profile provisioning when concurrent first-write races occur,
  - username save success plus inline failure feedback,
  - email update validation plus success vs pending-confirmation messaging,
  - password update success/failure with field clearing after submit,
  - backend-unavailable/profile-fetch failure staying inline on the profile route without signing the user out.
- Prefer deterministic Jest coverage for the mobile auth/profile service wrappers and the profile route state transitions, then add local-Supabase + `Maestro` proof for the full happy path with deterministic fixture credentials.

## Sync integration coverage policy (M13 onward)

- Applies to mobile/frontend-backend sync work.
- Required coverage should include the relevant subset of:
  - event envelope validation for required vs optional fields (`device_id`, `batch_id`, `sent_at_ms`, and per-event required fields),
  - entity-event compatibility checks across all M13 data-scope entities,
  - first-enable bootstrap pull + local merge + convergence flush,
  - event outbox ordering (`sequence_in_device`) and idempotency (`event_id`) behavior,
  - full M13 data-scope backup coverage across user-owned entities (not only session-core tables),
  - per-user composite-PK positive case: two distinct users (`user_a`, `user_b`) ingesting rows with the same `id` (e.g. shared seeded `exercise_definitions.id`) both succeed and each owns their per-user copy on the backend (no cross-owner conflict path exists by construction),
  - cadence behavior by context (`60s` general, `10s` while on `session-recorder`),
  - already-logged-in journey: user starts session recording and sync eventually converges,
  - logged-out-then-login journey: user logs in, bootstrap/merge converges, starts session recording, and sync eventually converges,
  - auth missing/expired or sync disabled due to no authenticated session,
  - offline or backend-unavailable retry/recovery behavior with locked backoff policy constants,
  - batch-order semantics (strict request-order processing, stop-on-first-failure, and prefix-commit behavior),
  - response contract semantics (`SUCCESS | FAILURE`, failure `error_index`, `should_retry`, free-text `message`, optional `error_event_id`),
  - projection/read-model correctness after event ingest/replay.
- Use mocks/fakes for broad scenario coverage, then require at least one real cross-stack proof path with local `Supabase` validating event ingest, idempotent retries, and restorable projection state.
- Backend-first M13 ingest/projection tasks should include the real local contract suite `./supabase/scripts/test-sync-events-ingest-contract.sh`.
- Current frontend baseline suites for this policy include:
  - `apps/mobile/app/__tests__/sync-bootstrap-merge.test.ts` (deterministic merge decisions + convergence-loop terminal behavior),
  - `apps/mobile/app/__tests__/sync-runtime-bootstrap.test.ts` (first-enable trigger and logged-out-then-login bootstrap trigger),
  - `apps/mobile/app/__tests__/sync-outbox-engine.test.ts` (batch response semantics, including retry scheduling and blocked failure mapping),
  - `apps/mobile/app/__tests__/sync-profile-status.test.ts` (profile-facing sync status mapping, including blocked and retry-scheduled states),
  - `apps/mobile/app/__tests__/settings-profile-navigation.test.tsx` (profile sync section render + toggle + inline blocked-failure messaging),
  - `apps/mobile/app/__tests__/sync-reinstall-restore-parity.test.ts` (M13 reinstall restore-parity proof: real outbox delivery to local Supabase ingest + reinstall bootstrap/merge parity assertion for all M13 data-scope entities).
- Local command wrapper for the restore-parity lane:
  - `apps/mobile/scripts/test-sync-reinstall-restore-parity.sh`
  - `npm run test:sync:reinstall-parity` (from `apps/mobile`)
  - behavior: enforces local Supabase runtime baseline, injects `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY` from local runtime status, and runs the dedicated Jest integration config (`apps/mobile/jest.integration.config.js`) targeting this suite.

## Maestro contract ownership (M10)

- `docs/specs/11-maestro-runtime-and-testing-conventions.md` is the authoritative Maestro runtime/testing contract.
- This document owns only the testing policy:
  - when Maestro slow gates are required,
  - which command wrappers are canonical,
  - which reset terms task cards must use,
  - where run evidence is expected.
- Runbooks such as `apps/mobile/README-maestro.md` and `apps/mobile/README_HUMAN_TESTING.md` should stay operational and link back to the contract instead of restating it in full.

## Standard local quality-gate wrappers (M5)

- Fast gate (default local closeout gate for covered workspaces):
  - `./scripts/quality-fast.sh`
  - area-specific form: `./scripts/quality-fast.sh frontend|backend`
- Slow gate (risk-triggered local gate, not always mandatory):
  - `./scripts/quality-slow.sh`
  - area-specific form: `./scripts/quality-slow.sh frontend|backend`
- Coverage intent (current repo):
  - `./scripts/quality-fast.sh frontend` -> `apps/mobile` `lint` + `typecheck` + `test`
  - `./scripts/quality-fast.sh backend` -> `./supabase/scripts/test-fast.sh`
  - `./scripts/quality-slow.sh frontend` -> `Maestro` local simulator smoke + data-smoke + auth/profile happy-path commands
- `./scripts/quality-slow.sh backend` -> local backend auth/RLS, sync API contract, and sync ingest contract suites (shared Supabase runtime baseline enforced)
- Rule:
  - wrappers reduce checklist repetition, but task cards still own trigger conditions and any hosted/manual checks.

## Shared Supabase runtime contract (slow real-instance tests)

- Scope:
  - applies to local real-instance test commands that hit a running Supabase stack rather than mocked clients.
  - current required entrypoints include:
    - `./supabase/scripts/test-auth-authz.sh`
    - `./supabase/scripts/test-sync-api-contract.sh`
    - `./supabase/scripts/test-sync-events-ingest-contract.sh`
    - `npm run test:e2e:ios:auth-profile` (via `apps/mobile/scripts/maestro-ios-auth-profile.sh`)
- Expected baseline state:
  - a local Supabase runtime is reachable,
  - `public.dev_fixture_principals` contains at least `anonymous`, `user_a`, `user_b`,
  - deterministic auth fixtures for `user_a` and `user_b` are provisioned with known credentials from `supabase/scripts/auth-fixture-constants.sh`.
- Enforcement path:
  - use `./supabase/scripts/ensure-local-runtime-baseline.sh` before real-instance slow tests.
  - behavior:
    - if runtime is down: start runtime + reset/seed + fixture provisioning,
    - if runtime is already up: reuse as-is (no reset), verify baseline fixture rows, and re-provision auth fixtures idempotently.
- Data-shape contract:
  - baseline rows must exist, but extra rows are allowed.
  - test suites must not assume empty tables beyond the baseline.
- Parallel-run contract (same machine):
  - each initialized BOGA worktree has its own readable Supabase `project_id`, slot-derived port block, containers, and database volume.
  - runtime bootstrap remains serialized per worktree via a lock in `ensure-local-runtime-baseline.sh` to avoid startup/reset races within the same slot.
  - backend contract suites must use per-run unique entity IDs so repeated runs in one slot do not collide.
  - avoid manual destructive operations (`db reset`, stack restart) in a worktree while another suite is actively using that same worktree slot.
  - use `./scripts/worktree-doctor.sh` when a backend suite appears to hit the wrong local Supabase instance.

## Worktree isolation testing policy

- Worktree setup and runtime isolation are owned by `docs/specs/12-worktree-config-and-isolation.md`.
- Before running local gates in a linked worktree, initialize it with:
  - `./scripts/worktree-setup.sh`
- Diagnostic entrypoint:
  - `./scripts/worktree-doctor.sh`
- Completed-worktree Supabase cleanup:
  - `./scripts/worktree-sweep.sh`
  - `./supabase/scripts/local-runtime-up.sh` runs this sweep opportunistically before starting the current slot.
  - cleanup is limited to slots whose registered worktree path is gone/invalid or no longer active in the same git worktree group, never the current slot.
- Placement rule:
  - BOGA worktrees must not be nested inside another BOGA checkout.
  - quality wrappers and runtime helpers fail before starting services when nested placement is detected.
- Dependency isolation rule:
  - each worktree owns its own `apps/mobile/node_modules`;
  - symlinked `apps/mobile/node_modules` is refused by runtime guards.
- Supabase isolation rule:
  - generated `supabase/config.toml` is per-worktree and slot-derived;
  - tests should consume local runtime values from `supabase status -o env` or project wrappers, not hardcoded ports.

## Current CI posture (M5)

- There is currently no CI pipeline configured for this repo.
- Until CI exists, task cards must explicitly document:
  - what is run locally for verification,
  - whether `quality-slow` is required and the trigger for it,
  - what is deferred/manual (for example hosted deployment smoke checks),
  - when manual checks must run (per change, before handoff, milestone closeout, release closeout).
- When CI is introduced, update this doc and `docs/specs/04-ai-development-playbook.md` in the same task to move applicable manual gates into CI.

## Backend / Supabase testing model (M5 onward)

- Scope:
  - applies to `supabase/**`, backend helper workspaces, and any cross-stack mobile+backend verification.
- Test layers (top-level ownership):
  - `DB` tests (`pgTAP` preferred, or equivalent SQL-level test path):
    - cover `RLS` policies, SQL functions, constraints, and invariants.
    - required for policy/function/constraint changes.
  - `Edge` unit tests (runtime-native, for example `deno test`) when Edge Functions/custom backend runtime code exists:
    - cover validation, mapping, and pure logic.
  - `Supabase-local integration/contract tests` (required for backend auth/authz/API work):
    - run against local Supabase runtime and verify real auth context + `RLS` behavior.
    - cover success, validation failure, unauthorized, and cross-user denial paths.
    - for auth/profile tables keyed directly to `auth.users(id)` instead of `owner_user_id`, still cover owner success plus cross-user denial explicitly.
    - for operational diagnostics tables such as `public.app_logs`, cover authenticated insert plus client-side read/update/delete denial.
  - Hosted/deployed smoke validation:
    - validates environment-specific behavior (secrets/bindings, ingress, hosted auth/provider config, migration execution on hosted instance).
    - manual by default until CI exists.
  - Cross-stack `E2E` (`Maestro` + local Supabase):
    - strategy is documented during M5.
    - first implementation should land once mobile sync integration exists, alongside mock-backend sync scenario coverage.
- Deterministic backend fixture baseline:
  - maintain named fixture identities for ownership tests (at minimum `anonymous`, `user_a`, `user_b`; optional admin/service-role-only helper path).
  - enforce the baseline through `./supabase/scripts/ensure-local-runtime-baseline.sh` (reset/seed only when runtime is absent; non-destructive baseline verification/provisioning when runtime is already running).
- Execution triggers (minimum expectations):
  - always run cheap tests relevant to the changed layer(s).
  - `./scripts/quality-fast.sh backend` is the default backend fast gate for covered local backend work.
  - run `Supabase-local integration/contract` tests when changing:
    - `supabase/migrations/**`
    - `supabase/functions/**`
    - auth configuration/policies
    - sync API contracts/fixtures
  - in current repo conventions, those backend integration/contract suites are grouped under `./scripts/quality-slow.sh backend`, but tasks must still mark them as required when risk triggers apply (not every backend task requires all slow suites)
  - run hosted smoke validation when changing:
    - deployment/env/secrets config
    - hosted-only behavior
    - milestone/release closeout that requires fresh hosted evidence
  - cross-stack `E2E` runs are not required during M5 backend foundation unless a task explicitly scopes them.
- Coverage policy for Supabase API surfaces:
  - if implementation uses custom runtime code (for example Edge Functions), require unit tests plus local integration/contract tests.
  - if implementation is mostly `PostgREST/RPC`, unit-test surface may be small; compensate with stronger DB + local integration/contract coverage.

## Backend local runtime baseline (implemented in `T-20260220-08`)

- Current implemented command path (`supabase/**`):
  - `./supabase/scripts/local-runtime-up.sh` (starts local stack + local health function serve)
  - `./supabase/scripts/reset-local.sh` (local migration/bootstrap + deterministic seed)
  - `./supabase/scripts/ensure-local-runtime-baseline.sh` (shared runtime preflight; lock + conditional bootstrap/reset + deterministic fixture enforcement)
  - `./supabase/scripts/db-lint-local.sh` (fast schema lint)
  - `./supabase/scripts/smoke-health.sh` (health endpoint smoke)
  - `./supabase/scripts/smoke-seed.sh` (fixture baseline smoke through local REST API)
  - `./supabase/scripts/test-fast.sh` (combined fast backend-local smoke suite)
  - repo-level wrapper mapping:
    - `./scripts/quality-fast.sh backend` -> `./supabase/scripts/test-fast.sh`
    - `./scripts/quality-slow.sh backend` -> backend contract suites (`test-auth-authz.sh`, `test-sync-api-contract.sh`, `test-sync-events-ingest-contract.sh`) that each call `ensure-local-runtime-baseline.sh`
- Current automated backend-local coverage (minimum baseline):
  - migration/reset/seed flow
  - deterministic fixture presence (`anonymous`, `user_a`, `user_b`, optional helper fixture)
  - local Edge health endpoint reachability
  - local DB schema lint
- Local Edge-function smoke note:
  - local Supabase gateway still expects auth headers; health smoke scripts must call the endpoint with the local `ANON_KEY`.
- `npm run lint` / `typecheck` / `test` posture for this baseline:
  - no backend Node/TS helper workspace was introduced in `T-20260220-08`, so FE-style `npm` gates are `N/A` here.
  - runtime-specific Supabase local gates above are the required baseline until a backend workspace/test harness is added.
- Hosted/deployed smoke command path:
  - deferred to `T-20260220-09` (manual by default until CI exists).

## Project structure conventions for testing assets (M5 backend additions)

- `apps/mobile/.maestro/flows` remains the canonical location for Maestro flow definitions.
- `apps/mobile/.maestro/maestro.env.sample` is the checked-in Maestro config sample; `apps/mobile/.maestro/maestro.env.local` is the canonical per-worktree untracked config.
- `apps/mobile/src/auth/` is the canonical location for shared mobile auth client, storage, session-service, and provider modules.
- Repo-root `e2e/` is reserved for cross-stack orchestration/tests (strategy documented in M5; implementation may be added later).
- `supabase/` is the backend root for migrations, seeds, functions, and backend-local test assets.
- `supabase/scripts/` is the canonical location for backend local runtime/test wrappers.
- `supabase/tests/` is the canonical location for backend-local smoke/integration test entrypoints until a dedicated helper workspace is introduced.
- Do not couple backend foundation work to a mobile test-directory refactor (for example moving `apps/mobile/app/__tests__`) unless a dedicated task explicitly scopes that change.

## Maestro runtime topology summary (M10)

- Primary automation runtime:
  - `Maestro + iOS Simulator + Expo development client`
- Canonical command surface:
  - `npm run test:e2e:ios:smoke`
  - `npm run test:e2e:ios:data-smoke`
  - `npm run test:e2e:ios:auth-profile`
  - `./scripts/quality-slow.sh frontend`
- Canonical reset terms:
  - `full reset`
  - `data reset`
  - `teleport`
- Canonical artifact root:
  - `apps/mobile/artifacts/maestro/<task-id-or-ad-hoc>/<timestamp>/`
- Minimum expected runtime artifacts:
  - `runtime.env`
  - `provision.log`
  - `launch.log`
  - `teardown.log`
  - `expo-start.log`
  - `simulator-system.log`
  - `maestro-junit.xml`
- Per-worktree configuration baseline:
  - source `.maestro/maestro.env.local` from the sample file and keep shared-build overrides there rather than hardcoding machine-specific paths in docs/tasks.

## iOS UI smoke policy (Maestro, current stage)

- Jest/React Native Testing Library remains the default for component logic, state transitions, and CI-safe assertions.
- Maestro is used for simulator/device-integrated UI smoke checks that confirm core screens are reachable and visibly intact.
- In the standard local gate matrix, current `Maestro` checks are classified as `frontend + slow` and run via `./scripts/quality-slow.sh frontend`.
- `./scripts/quality-slow.sh frontend` currently runs:
  - `npm run test:e2e:ios:smoke`
  - `npm run test:e2e:ios:data-smoke`
- `npm run test:e2e:ios:auth-profile`
- Current required Maestro coverage includes:
  - app launch visible state
  - session recorder visible state
  - logged-out profile state
  - fixture-backed sign-in
  - signed-in profile state
  - username update
  - sign-out back to the logged-out profile state
- Reset/setup policy for this flow:
  - use `full reset` because smoke is the cold-start coverage lane;
  - use `teleport` to the recorder once launch visibility is confirmed.
- Required screenshots for smoke flow:
  - `01-app-launch`
  - `02-session-recorder-visible`
- Screenshot capture is automated by the Maestro flow and stored under the canonical artifact root from the M10 contract.
- Rule:
  - require `./scripts/quality-slow.sh frontend` when a task changes the committed smoke/data-smoke flows, Maestro runtime scripts, development-client/runtime handshake, harness setup behavior, or user-facing UI that needs fresh real-simulator smoke evidence.

## iOS simulator auth/profile happy-path policy (Maestro, M11)

- Purpose:
  - validate the real local-Supabase login/profile happy path on the iOS simulator with deterministic fixture credentials.
- Command:
  - `npm run test:e2e:ios:auth-profile`
  - (also covered by `./scripts/quality-slow.sh frontend`)
- Reset/setup policy for this flow:
  - use `full reset` so the run starts logged out with no restored mobile session;
  - preflight Supabase with `./supabase/scripts/ensure-local-runtime-baseline.sh` so the shared local runtime baseline exists before sign-in;
  - use the deterministic local fixture credentials (`user_a` by default) from `supabase/scripts/auth-fixture-constants.sh`;
  - use a per-run username value so repeated local runs still exercise the username-save path even when the backend profile row already exists.
- Required screenshots for auth/profile flow:
  - `05-auth-profile-logged-out-start`
  - `06-auth-profile-signed-in`
  - `07-auth-profile-signed-out-end`
- Required when any of these are true:
  - milestone/release closeout needs fresh M11 auth/profile proof,
  - profile-route UI/state semantics change,
  - auth bootstrap/session restore behavior changes,
  - local Supabase-backed auth/profile wiring changes.
- Evidence expectations:
  - include command result and artifact root from `apps/mobile/artifacts/maestro/<task-id-or-ad-hoc>/<timestamp>/`.
  - include the screenshot filenames captured under that artifact root.

## iOS simulator data smoke policy (Maestro, current stage)

- Purpose:
  - validate runtime migration + smoke insert/read behavior on real Expo iOS runtime (`expo-sqlite`) when change risk is runtime-sensitive.
- Command:
  - `npm run test:e2e:ios:data-smoke`
  - (also covered by `./scripts/quality-slow.sh frontend`)
- Reset/setup policy for this flow:
  - use `data reset` to clear app-owned SQLite state without re-testing install semantics;
  - use `teleport` to land directly on the recorder before performing the write/read assertions;
  - avoid `full reset` here unless the task specifically needs cold-install evidence.
- Required when any of these are true:
  - `apps/mobile/src/data/bootstrap.ts` changes.
  - `apps/mobile/src/data/migrations/**` changes.
  - `apps/mobile/drizzle/**` migration artifacts or schema outputs change.
  - `apps/mobile/package.json` changes include Expo/SQLite/Drizzle dependency updates.
  - `apps/mobile/app/maestro-harness.tsx` or `apps/mobile/src/maestro/**` changes.
  - `apps/mobile/.maestro/**` or `apps/mobile/scripts/maestro*` changes affect data-smoke setup or runtime orchestration.
  - milestone/release closeout requires fresh native runtime data evidence.
- Optional (recommended) when:
  - data-layer behavior changes are low risk and local runtime confidence is desired before handoff.
- Usually not required when:
  - changes are limited to data-repository pure logic that does not alter runtime migration/bootstrap wiring and Lane 1 checks are green.
- Evidence expectations:
  - include command result and artifact root from `apps/mobile/artifacts/maestro/<task-id-or-ad-hoc>/<timestamp>/`.
  - include screenshot paths or the screenshot filenames captured under that artifact root.
  - required screenshots for data smoke flow:
    - `03-data-runtime-smoke-start`
    - `04-data-runtime-smoke-success`

## iOS simulator parallel-run policy (Maestro)

- Problem:
  - parallel local agents can collide on simulator selection and Expo dev-server ports.
- Enforcement:
  - iOS Maestro runner scripts now rely on explicit per-worktree config instead of host-level locking.
  - each worktree must own one Metro port and one simulator target.
- Configuration:
  - `EXPO_DEV_SERVER_PORT` (generated default: `8082 + worktree slot`; must be unique per workspace on a shared host)
  - `IOS_SIM_UDID` (preferred on a shared host)
  - `IOS_SIM_DEVICE` (fallback only when the simulator name is unique for that workspace)
  - `IOS_SIM_AUTO_CREATE` (generated default: `1` for setup-created worktree env files; creates a slot-named simulator when possible)
- Operational rules:
  - parallel runs are safe only when each worktree uses a unique `EXPO_DEV_SERVER_PORT` and a unique simulator target.
  - if two worktrees point at the same simulator or port, the runners can clobber each other; there is no longer an automatic host-level lock to prevent that.
  - direct environment overrides remain allowed, but they should match the values committed to that workspace's `.maestro/maestro.env.local`.
- Documentation rule:
  - keep machine-specific simulator/port overrides in `.maestro/maestro.env.local`, not in shared docs or task cards.

## Planned next phase (UI quality and appearance)

1. Add visual regression testing for critical screens/components.
Reason: catch layout and styling regressions (spacing, clipping, overlap) that behavior tests miss.

2. Define a lightweight UI contract per key screen (visibility, tap targets, no overlap, small-phone fit).
Reason: make visual correctness explicit so both humans and AI can validate against clear rules.

3. Add screenshot checkpoints in end-to-end flows.
Reason: verify real user journeys preserve expected appearance.

4. Establish baseline update policy for snapshots.
Reason: ensure visual changes are intentional and reviewed, not silently accepted.

5. Use visual diff output as AI iteration input.
Reason: helps AI make targeted UI fixes and faster design refinements.
