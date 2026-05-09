---
task_id: M14-T01-minimal-supabase-app-logging
milestone_id: "M14"
status: completed
ui_impact: "no"
areas: "cross-stack"
runtimes: "expo|supabase|sql"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "N/A"
docs_touched: "docs/specs/milestones/M14-observability-and-diagnostics.md, docs/specs/05-data-model.md, docs/specs/03-technical-architecture.md, docs/specs/06-testing-strategy.md, docs/specs/tech/client-sync-engine.md, RUNBOOK.md"
---

# Task Card

## Task metadata

- Task ID: `M14-T01-minimal-supabase-app-logging`
- Title: Minimal Supabase-backed app logging
- Status: `completed`
- File location rule:
  - author active card in `docs/tasks/M14-T01-minimal-supabase-app-logging.md`
  - move the file to `docs/tasks/complete/M14-T01-minimal-supabase-app-logging.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-05-07`
- Session interaction mode: `interactive (default)`

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M14-observability-and-diagnostics.md`
  - If this milestone spec does not exist yet, create a lightweight milestone spec before implementation or replace `M14` with the correct existing milestone ID.
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit: `main @ 2bc7a1e`
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `yes` (`git fetch origin main`; local `HEAD` matched `origin/main` at `2bc7a1e`; existing task-card edits were preserved)
- Parent refs opened in this session:
  - `docs/specs/README.md`
  - `docs/specs/milestones/M14-observability-and-diagnostics.md` (created before implementation)
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/04-ai-development-playbook.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/12-worktree-config-and-isolation.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/ui/README.md`
  - `RUNBOOK.md`
- Code/docs inventory freshness checks run:
  - Confirm existing mobile Supabase client location: `apps/mobile/src/auth/supabase.ts` (`getSupabaseMobileClient()` is synchronous and returns client or `null`)
  - Confirm auth service location: `apps/mobile/src/auth/service.ts`
  - Confirm sync runtime/engine/bootstrap locations:
    - `apps/mobile/src/sync/runtime.ts`
    - `apps/mobile/src/sync/engine.ts`
    - `apps/mobile/src/sync/bootstrap.ts`
  - Confirm Supabase migration folder: `supabase/migrations/`
  - Confirm whether `expo-application` is already present in the mobile app dependencies: missing at start; added with `npx expo install expo-application` as `~7.0.8`.
  - Confirm whether `expo-updates` is already present, or whether the project already uses EAS Update: `expo-updates` is not a direct dependency and is not configured in `app.config.ts`; no `expo-updates` dependency was added.
- Known stale references or assumptions:
  - The backend for this task is assumed to be Supabase/Postgres/RPC, not a separate Node/Next.js service.
  - `M14` was kept and `docs/specs/milestones/M14-observability-and-diagnostics.md` was created.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M14-T01-minimal-supabase-app-logging.md`

## Objective

Implement a minimal production logging mechanism for BoGa using Supabase only.

This task intentionally avoids external logging providers such as Sentry, Better Stack, Axiom, Firebase, or similar. The desired implementation is deliberately small: one Supabase table, one mobile logging helper, and a few high-value instrumentation points for auth and sync failures.

The purpose is to capture basic production diagnostics such as failed auth restore, failed sign-in, failed sync RPC calls, sync bootstrap failures, and remote fetch failures without building a full observability platform. Humanity may survive without another dashboard.

## Scope

### In scope

- Add a Supabase migration for `public.app_logs`.
- Enable RLS on `public.app_logs`.
- Allow authenticated users to insert logs.
- Do not allow client-side SELECT, UPDATE, or DELETE on logs.
- Add indexes useful for manual inspection in Supabase Dashboard / SQL Editor.
- Add a reusable mobile logging helper at `apps/mobile/src/logging/logEvent.ts`.
- Reuse the existing mobile Supabase client from `apps/mobile/src/auth/supabase.ts`.
- Add minimal instrumentation to:
  - `apps/mobile/src/auth/service.ts`
  - `apps/mobile/src/sync/runtime.ts`
  - `apps/mobile/src/sync/engine.ts`
  - `apps/mobile/src/sync/bootstrap.ts`
- Add `expo-application` to the mobile app dependencies if missing.
- Do not add `expo-updates` unless it is already present or the project already uses EAS Update.
- Update relevant architecture/data-model docs if this logging table becomes part of the shared project contract.

### Out of scope

- Sentry, Better Stack, Axiom, Firebase, Crashlytics, or any external logging provider.
- A full observability stack.
- A dashboard UI inside the app.
- Admin screens for logs.
- A separate backend/service-role logger, unless an actual backend runtime already exists in the repo.
- Broad instrumentation of every `supabase.from()` call.
- Broad instrumentation of every file matching `**/session*.ts`.
- Logging full payloads, auth/session/user objects, passwords, tokens, or large sync event bodies.

## UI Impact (required checkpoint)

- UI Impact?: `no`
- Rationale:
  - This task adds infrastructure, database schema, and mobile diagnostic instrumentation only.
  - It should not change visible app UI, navigation, copy, styling, interaction flows, or documented UI contracts.
  - Remove UI-only sections from this task card.

## Acceptance criteria

1. A Supabase migration creates `public.app_logs` with the required columns, constraints, RLS, policies, and indexes.
2. The migration lives under `supabase/migrations/` and uses a timestamped filename following the existing repo convention.
3. The migration is idempotent where practical:
   - `CREATE TABLE IF NOT EXISTS`
   - `CREATE INDEX IF NOT EXISTS`
   - policy creation guarded through a `DO` block checking `pg_policies`
4. `public.app_logs` allows authenticated INSERT only.
5. Clients cannot SELECT, UPDATE, or DELETE `app_logs` rows.
6. A reusable mobile helper exists at `apps/mobile/src/logging/logEvent.ts`.
7. The helper reuses `getSupabaseMobileClient()` from `apps/mobile/src/auth/supabase.ts`.
8. `getSupabaseMobileClient()` is treated correctly:
   - it is synchronous
   - it returns a Supabase client or `null`
   - it must not be awaited
9. `logEvent()` returns immediately if `getSupabaseMobileClient()` returns `null`.
10. `logEvent()` wraps its whole body in `try/catch` and never throws.
11. `source` is optional in the TypeScript params but defaults to `'app'` before insert, because the database column is `NOT NULL`.
12. `client_platform` is set from `Platform.OS` from `react-native`.
13. `client_app_version` is set from `Application.nativeApplicationVersion` from `expo-application`, falling back only to config-ish metadata if the native value is unavailable.
14. `client_build_number` is set from `Application.nativeBuildVersion` from `expo-application`.
15. `client_runtime_version`, `client_update_id`, and `client_channel` are populated from `expo-updates` only when `expo-updates` is already present or the project already uses EAS Update; otherwise they are inserted as `null` or omitted according to the helper implementation.
16. `client_variant` may come from config-ish metadata such as `Constants.expoConfig?.extra?.env`, because it is not the installed native app version/build source of truth.
17. If `expo-application` is not already present in the mobile app dependencies, it is added to the mobile app.
18. `expo-updates` is not added unless it is already present or EAS Update is already part of the project.
19. `expo-constants` is not used as the primary source for installed native app version/build tracking.
20. `context` uses `Record<string, unknown>`.
21. No detailed context schema is enforced yet.
22. Sensitive context keys are stripped before insert.
23. Auth restore and sign-in failures are logged.
24. Sync ingest RPC, sync bootstrap, sync flush transport, and sync bootstrap remote fetch failures are logged.
25. No broad instrumentation sweep is performed.
26. No external logging provider is introduced.
27. No full auth objects, session objects, user objects, passwords, tokens, or large sync payloads are logged.
28. Existing auth and sync behaviour is not changed except for non-blocking log attempts.
29. Relevant docs are updated or explicit no-update rationale is recorded.

## Docs touched (required)

- Planned docs/spec files to update and why:
  - `docs/specs/milestones/M14-observability-and-diagnostics.md` - create or update a lightweight milestone spec for diagnostics/logging if `M14` is the chosen milestone.
  - `docs/specs/05-data-model.md` - document `public.app_logs` if this table is considered part of the durable data model.
  - `docs/specs/03-technical-architecture.md` - document the minimal logging approach if diagnostics/logging becomes part of the app architecture contract.
- If a more appropriate existing milestone exists, replace `M14` and update this task card accordingly.
- UI docs update required?: `no`
  - Rationale: this task has no UI impact.

## Testing and verification approach

- Planned checks/commands:
  - Inspect generated migration for RLS, policies, constraints, and indexes.
  - Run existing mobile tests affected by auth/sync instrumentation.
  - Run project/type/lint gates available for the mobile app.
  - If Supabase local tooling is available, apply or validate the migration locally.
- Standard local gate usage:
  - `./scripts/quality-fast.sh frontend`
- Test layers covered:
  - Type-level validation for helper and instrumentation.
  - Unit tests for helper sanitizer/default behaviour if existing test setup makes this straightforward.
  - Existing auth/sync tests as regression coverage.
  - Supabase migration validation if local Supabase workflow is available.
- Execution triggers:
  - `always` for type/lint/targeted tests touching auth/sync/logging.
  - `file-change-triggered` for migration validation.
- Slow-gate triggers:
  - `N/A` unless the repo’s quality policy requires a slow frontend gate for auth/sync runtime changes.
- Hosted/deployed smoke ownership:
  - Deferred unless this task is being deployed to hosted Supabase in the same session.
- CI/manual posture note:
  - If CI is absent or partial, record local command output and manual Supabase Dashboard / SQL Editor verification notes.
- Notes:
  - Do not overbuild test scaffolding for this task.
  - Prefer small, focused tests around `logEvent()` if feasible.

## Evidence

- `npm test -- logging-log-event.test.ts --runInBand` failed before implementation because `apps/mobile/src/logging/logEvent.ts` did not exist.
- `npm test -- logging-log-event.test.ts auth-service.test.ts sync-outbox-engine.test.ts sync-runtime-bootstrap.test.ts sync-bootstrap-merge.test.ts --runInBand` passed: 5 suites, 31 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with existing warnings in unrelated tests.
- `./scripts/quality-fast.sh frontend` passed on retry: lint, typecheck, and 35 Jest suites / 209 tests.
- Initial `./scripts/quality-fast.sh frontend` run had two unrelated whole-suite test timeouts; rerunning the two failed suites in isolation passed: 2 suites, 35 tests.
- `git diff --check` passed.
- End-of-task sync check completed with `git fetch origin main`; local `HEAD` remained even with `origin/main`.
- `bash -n supabase/tests/auth-authz-contract.sh` passed.
- `./supabase/scripts/test-fast.sh` and `./supabase/scripts/test-auth-authz.sh` were attempted but blocked because Docker is unavailable: Docker daemon connection failed at `unix:///var/run/docker.sock`.

## Completion note

- What changed:
  - Added `public.app_logs` migration with RLS, authenticated insert grant, no client read/update/delete grants, guarded policy creation, and inspection indexes.
  - Added `apps/mobile/src/logging/logEvent.ts` plus tests for no-client no-op, metadata/default insert shape, sensitive context stripping, and never-throw behavior.
  - Instrumented auth restore/sign-in failures and sync ingest RPC, bootstrap/convergence, flush transport, and bootstrap remote fetch failures with non-blocking log attempts.
  - Added `expo-application`; did not add `expo-updates`.
  - Updated M14 milestone, architecture, data model, testing strategy, sync tech notes, and runbook.
- Sync impact decision:
  - `public.app_logs` is `out of sync scope`; it is operational diagnostics data, not user-domain backup/restore state.
- Remaining risk:
  - Supabase local migration/RLS contract execution is still required on a machine with Docker available. Static shell checks and frontend checks passed in this session.

## Implementation notes

### Database migration

Create a Supabase migration in:

`supabase/migrations/`

Use a timestamped filename following the existing repo convention, for example:

`supabase/migrations/20260507120000_create_app_logs.sql`

Create table:

`public.app_logs`

Columns:

- `id uuid primary key default gen_random_uuid()`
- `created_at timestamptz not null default now()`
- `level text not null check (level in ('debug', 'info', 'warn', 'error'))`
- `source text not null check (source in ('app', 'backend', 'database', 'sync', 'auth'))`
- `event text not null`
- `message text null`
- `user_id uuid null`
- `client_platform text null`
- `client_app_version text null`
- `client_build_number text null`
- `client_runtime_version text null`
- `client_update_id text null`
- `client_channel text null`
- `client_variant text null`
- `context jsonb null`

Enable RLS.

Add an INSERT-only policy for authenticated users.

Do not add client SELECT, UPDATE, or DELETE policies.

Add useful indexes:

- `created_at desc`
- `level, created_at desc`
- `event, created_at desc`
- `user_id, created_at desc`

Make the migration idempotent where practical:

- Use `CREATE TABLE IF NOT EXISTS`.
- Use `CREATE INDEX IF NOT EXISTS`.
- For policies, use a `DO` block that checks `pg_policies` before creating the policy, since `CREATE POLICY` does not support clean `IF NOT EXISTS`.

### Mobile logging helper

Create:

`apps/mobile/src/logging/logEvent.ts`

Optionally create:

`apps/mobile/src/logging/index.ts`

The helper must reuse the existing mobile Supabase client from:

`apps/mobile/src/auth/supabase.ts`

Use `getSupabaseMobileClient()`.

Important clarifications:

- `getSupabaseMobileClient()` is synchronous.
- It returns a Supabase client or `null`.
- It is not async and must not be awaited.
- Do not create a second mobile Supabase client.

Export:

`logEvent(params)`

Use these types:

```ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogSource = 'app' | 'backend' | 'database' | 'sync' | 'auth';

type LogEventParams = {
  level: LogLevel;
  source?: LogSource;
  event: string;
  message?: string;
  userId?: string | null;
  context?: Record<string, unknown>;
};
```

The helper should enrich each inserted row with client metadata without requiring callers to pass these fields:

- `client_platform`: use `Platform.OS` from `react-native`.
- `client_app_version`: use `Application.nativeApplicationVersion` from `expo-application`; fall back only to config-ish metadata when unavailable.
- `client_build_number`: use `Application.nativeBuildVersion` from `expo-application`.
- `client_runtime_version`, `client_update_id`, `client_channel`: use `expo-updates` only if `expo-updates` is already installed or EAS Update is already part of the project. Do not introduce `expo-updates` only for this logging task.
- `client_variant`: use existing config-ish metadata when available, for example `Constants.expoConfig?.extra?.env`.

Dependency guidance:

- `expo-application` is the required source for installed native app version/build number; add it with the Expo-compatible install path if missing.
- `expo-constants` is acceptable for config-ish metadata such as variant/environment, but not as the main source for installed native app version/build tracking.
- `expo-updates` is optional for this task and should only be used when the project already has it or already uses EAS Update.
