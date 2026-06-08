---
task_id: M14-T02-log-user-id-enrichment
milestone_id: "M14"
status: completed
ui_impact: "no"
areas: "frontend"
runtimes: "node, expo"
gates_fast: "./scripts/quality-fast.sh"
gates_slow: "N/A"
docs_touched: "none"
---

# Task Card

## Task metadata

- Task ID: `M14-T02-log-user-id-enrichment`
- Title: Enrich app diagnostics logs with user id when available
- Status: `completed`
- File location rule:
  - author active cards in `docs/tasks/M14-T02-log-user-id-enrichment.md`
  - move the file to `docs/tasks/complete/M14-T02-log-user-id-enrichment.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-06-08`
- Session interaction mode: `interactive (default)`

## Parent references

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M14-observability-and-diagnostics.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`

## Context Freshness

- Verified current branch + HEAD commit: `main` at `e9b8493`
- Start-of-session sync with `origin/main` completed?: `N/A` - this card was authored from the current checkout; executing agent must refresh branch/HEAD before edits.
- Parent refs opened in this session:
  - `AGENTS.md`
  - `docs/specs/01-worktree-and-environment.md`
  - `docs/specs/02-quality-and-test-gates.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/README.md`
  - `docs/specs/milestones/M14-observability-and-diagnostics.md`
  - `docs/specs/templates/task-card-template.md`
- Code/docs inventory freshness checks run:
  - `rg -n "logEvent|app_logs|logger|log\\.|console\\.|appVersion|build|platform|Platform|expo-application|Application" apps/mobile supabase docs/specs` - found the canonical helper, schema, tests, and call sites on `2026-06-08`.
  - `rg -n "logEvent\\(" apps/mobile/app apps/mobile/src -g '!**/__tests__/**'` - confirmed production log call sites are concentrated in auth, session recorder, sync scheduler, and background sync on `2026-06-08`.
  - `rg -n "expo-updates|Updates|runtimeVersion|updateId|channel" apps/mobile/package.json apps/mobile/app.config.ts apps/mobile/src apps/mobile/app` - confirmed update/runtime/channel metadata is not currently wired on `2026-06-08`.
- Known stale references or assumptions: executing agent must re-run inventory checks before implementation if branch/HEAD changed.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M14-T02-log-user-id-enrichment.md`

## Objective

Improve the existing Supabase-backed app diagnostics logger so `public.app_logs.user_id` is populated whenever a current authenticated user can be determined safely, without requiring every caller to pass `userId` manually.

## Scope

### In scope

- Add default user-id enrichment to `apps/mobile/src/logging/logEvent.ts`.
- Preserve existing explicit `userId` behavior for call sites that already know the user.
- Keep logging non-blocking: user-id lookup failure must not throw or alter auth, sync, or local-first flows.
- Update focused unit tests for the logger.
- Leave the existing app version, build number, platform, and variant metadata behavior intact.

### Out of scope

- Adding `expo-updates`.
- Populating `client_runtime_version`, `client_update_id`, or `client_channel`.
- Changing the `public.app_logs` table schema or RLS policy.
- Broad instrumentation sweeps beyond what is needed to prove default enrichment.
- Logging auth/session/user objects, passwords, tokens, or large sync payloads.

## UI Impact

- UI Impact?: `no`
- Rationale: this is a diagnostics/logging behavior change only. It does not change screens, routes, copy, layout, interactions, or visual components.

## Acceptance criteria

1. A `logEvent()` call with no `userId` inserts the current authenticated Supabase user id when a session is available.
2. A `logEvent()` call with an explicit non-null `userId` continues to insert that exact value.
3. A `logEvent()` call when no session is available inserts `user_id: null`.
4. A failure while resolving the current session does not throw and does not block the log insert attempt.
5. Existing metadata remains present on inserted rows: `client_platform`, `client_app_version`, `client_build_number`, and `client_variant`.
6. No new sensitive context keys are allowed through the logger sanitizer.

## Docs touched

- Planned docs/spec files to update and why:
  - `none` - expected change is implementation and tests only; architecture/data-model docs already describe `public.app_logs` and write-only diagnostics.

## Testing and verification approach

- Planned checks/commands:
  - Targeted Jest test for `apps/mobile/app/__tests__/logging-log-event.test.ts`.
  - `./scripts/quality-fast.sh`
- Standard local gate usage:
  - `./scripts/quality-fast.sh` - required because this changes mobile TypeScript logic and tests.
  - `./scripts/quality-slow.sh <frontend|backend>` - `N/A`; no UI, native dependency, backend schema, RLS, sync contract, or runtime topology changes are expected.
- Test layers covered:
  - Unit test coverage for logger enrichment, explicit override, no-session behavior, and non-blocking failure behavior.
- Execution triggers:
  - Always run the targeted logger test after implementation.
  - Run the fast gate before closeout.
- Slow-gate triggers:
  - `N/A` unless implementation unexpectedly changes backend schema/RLS, sync behavior, native dependencies, or UI/runtime behavior.
- Hosted/deployed smoke ownership:
  - `N/A`; no hosted deployment change expected.
- CI/manual posture note:
  - CI covers lint, typecheck, Jest, and open-handle guard. Local closeout still requires `./scripts/quality-fast.sh`; `test:handles` is only needed locally if implementation introduces timers, subscriptions, sockets, or async teardown.
- Notes:
  - The existing `public.app_logs` RLS only permits `user_id` when it is null or matches `auth.uid()`, so the implementation must avoid stale guessed ids.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/src/logging/logEvent.ts`
  - `apps/mobile/src/logging/index.ts` only if a small exported helper is needed
  - `apps/mobile/app/__tests__/logging-log-event.test.ts`
- Project structure impact:
  - No new paths or conventions expected.
- Constraints/assumptions:
  - Do not import `getAuthSnapshot` or auth service state into `logEvent.ts`; `apps/mobile/src/auth/service.ts` already imports logging, so that would create a dependency cycle.
  - Prefer deriving the current user id from the existing Supabase client session, or use a small logging-owned current-user cache if the implementation can keep it correct without stale ids.
  - Preserve the current fire-and-forget, best-effort logging contract.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh`
- Standard local slow gate: `N/A` - no slow-gate trigger expected.
- Optional closeout validation helper: `./scripts/task-closeout-check.sh docs/tasks/M14-T02-log-user-id-enrichment.md`
- Additional gate(s), if any:
  - Targeted Jest test for `logging-log-event.test.ts`.

## Evidence

- Targeted logger test output: ✅ `npm test -- --runTestsByPath app/__tests__/logging-log-event.test.ts` from `apps/mobile` passed: 1 suite, 10 tests.
- `./scripts/quality-fast.sh` output: ✅ passed from repo root. Frontend lint/typecheck/Jest passed (88 suites, 771 tests); backend fast local Supabase smoke passed. Existing lint warnings remained warnings only.
- Manual verification summary: `logEvent()` enriches omitted `userId` from `client.auth.getSession()` when available; explicit `userId` and explicit `null` are preserved; session lookup failures fall back to `user_id: null` and still attempt the insert; existing client metadata and sanitizer behavior remain intact. No `expo-updates` runtime/channel fields or schema/RLS changes were made.
- Manual verification summary (required when CI is absent/partial): `logEvent()` enrichment and non-blocking fallback behavior were verified by focused unit coverage and the fast gate; no hosted/manual smoke is required for this diagnostics-only client helper change.
- Deferred/manual hosted checks summary: `N/A`

## Completion note

- What changed: `logEvent()` now performs best-effort current-user enrichment through the existing Supabase mobile client only when `userId` is omitted, and focused logger tests cover enrichment, explicit IDs, no session, lookup failure, metadata, and sensitive key stripping.
- What tests ran: `npm test -- --runTestsByPath app/__tests__/logging-log-event.test.ts`; `./scripts/quality-fast.sh`.
- What remains: No implementation blockers. Optional `expo-updates` runtime/channel enrichment remains out of scope.

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Ensure completion note is filled before handoff.
- If the task changed significant cross-cutting behavior, ensure the relevant project-level docs were updated in the same session rather than only the milestone/task docs.
- If significant project-structure changes were made, update `docs/specs/09-project-structure.md` and mention it in completion note.
- Update parent milestone task breakdown/status in the same session.
- Run `./scripts/task-closeout-check.sh docs/tasks/M14-T02-log-user-id-enrichment.md` or document why `N/A` before handoff.
