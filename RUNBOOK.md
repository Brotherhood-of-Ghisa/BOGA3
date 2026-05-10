# RUNBOOK

## Purpose

Human-operator guide for local development, runtime operations, logs, and tests across the mobile frontend, Maestro E2E runtime, and Supabase backend.

## Scope and conventions

- Run commands from repo root unless a section says otherwise.
- This runbook is for local development/runtime only.
- Authoritative Maestro runtime contract still lives in `docs/specs/11-maestro-runtime-and-testing-conventions.md`.

## Prerequisites

- Node.js + npm
- Xcode + iOS Simulator (`xcrun simctl`)
- CocoaPods (`pod`)
- Maestro CLI (`maestro`)
- Docker (for local Supabase stack)
- `jq` (required by backend contract test scripts)

## Worktree setup and isolation

Authoritative design: `docs/specs/12-worktree-config-and-isolation.md`.

BOGA worktrees must live outside another BOGA checkout. Use the wrapper when possible:

```bash
./scripts/worktree-create.sh codex/my-branch
```

Initialize or repair the current checkout/worktree:

```bash
./scripts/worktree-setup.sh
```

Diagnose isolation/config problems:

```bash
./scripts/worktree-doctor.sh
```

Sweep completed worktree Supabase infrastructure:

```bash
./scripts/worktree-sweep.sh
```

Setup generates `.worktree-slot`, `supabase/config.toml`, shared Supabase env symlinks, and `apps/mobile/.maestro/maestro.env.local`.

Rules:

- never create a BOGA worktree under another BOGA checkout;
- run `cd apps/mobile && npm install` in each worktree;
- do not symlink `apps/mobile/node_modules` between worktrees;
- use a unique simulator target per concurrent worktree.

`./supabase/scripts/local-runtime-up.sh` automatically runs a conservative Supabase cleanup sweep for completed worktree slots before starting the current slot. A slot is considered completed only when its registered path is gone/invalid, or when it belongs to this git worktree group and is no longer listed by `git worktree list`.

## Quick start (full local stack)

1. Initialize this checkout/worktree:

```bash
./scripts/worktree-setup.sh
```

2. Start backend runtime:

```bash
./supabase/scripts/local-runtime-up.sh
```

3. Install mobile dependencies:

```bash
cd apps/mobile
npm install
```

4. Start the iOS dev-client manual loop:

```bash
npm run start:ios:dev-client
```

## Mobile app: run on iOS simulator

### Fast JS loop (Expo)

```bash
cd apps/mobile
npx expo start
```

### Dev-client loop (matches Maestro runtime)

```bash
cd apps/mobile
./scripts/maestro-ios-dev-client-build.sh
npm run start:ios:dev-client
```

### Uninstall and reinstall app on simulator

1. Boot/open a simulator.
2. Reinstall the built dev client:

```bash
APP_PATH="$(cd apps/mobile && ./scripts/maestro-ios-dev-client-build.sh --print-app-path)"
BUNDLE_ID="$(plutil -extract CFBundleIdentifier raw -o - "$APP_PATH/Info.plist")"
xcrun simctl uninstall booted "$BUNDLE_ID" || true
xcrun simctl install booted "$APP_PATH"
xcrun simctl launch booted "$BUNDLE_ID"
```

### Automated uninstall/reinstall via smoke lane

The smoke runner uses a full reset path and reinstalls automatically:

```bash
cd apps/mobile
TASK_ID=ad-hoc npm run test:e2e:ios:smoke
```

## Supabase: run locally and reset

### Docker Desktop on WSL preflight

When working from WSL, Docker Desktop must be reachable from this Linux distribution, not just running on Windows.

Check from the repo shell before Supabase local commands:

```bash
docker info --format '{{.ServerVersion}} {{.OperatingSystem}}'
```

If Docker Desktop is running but the command fails with socket or daemon errors:

- confirm Docker Desktop uses the WSL 2 based engine;
- open Docker Desktop **Settings -> Resources -> WSL Integration** and enable integration for this WSL distribution;
- apply the change, then reopen the repo shell and retry the check.

Reference: https://docs.docker.com/desktop/features/wsl/

### Start/stop/reset

Start runtime:

```bash
./supabase/scripts/local-runtime-up.sh
```

Stop runtime:

```bash
./supabase/scripts/local-runtime-down.sh
```

Clean completed/orphaned Supabase infra:

```bash
./scripts/worktree-sweep.sh
```

Clean one completed slot manually:

```bash
./scripts/worktree-clean.sh --slot <n> --supabase --remove-registry
```

Reset DB (migrations + seed):

```bash
./supabase/scripts/reset-local.sh
```

Ensure shared baseline (non-destructive when already up, with fixture enforcement):

```bash
./supabase/scripts/ensure-local-runtime-baseline.sh
```

### Repair hosted Supabase migration drift

Use this only when a hosted schema change was applied manually and the hosted migration history may not match checked-in migrations. The first repair was completed in `docs/tasks/complete/T-20260510-01-supabase-migration-history-repair.md`.

Start with inspection:

```bash
supabase migration list --linked
```

Then inspect hosted schema for the specific migration effects. For the current repair, confirm:

- migration versions `20260505213500` and `20260507120000` are recorded as applied;
- `app_public.session_exercises` no longer has `session_exercises_exercise_definition_owner_fk`;
- `public.app_logs` exists with RLS, authenticated insert-only access, and the expected indexes.

Useful hosted SQL inspection query:

```sql
select
  to_regclass('public.app_logs') as app_logs_table,
  (
    select count(*) = 0
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'app_public'
      and t.relname = 'session_exercises'
      and c.conname = 'session_exercises_exercise_definition_owner_fk'
  ) as session_exercise_definition_fk_absent,
  (
    select relrowsecurity
    from pg_class t
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'app_logs'
  ) as app_logs_rls_enabled,
  (
    select count(*) = 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'app_logs'
      and policyname = 'app_logs_authenticated_insert'
  ) as app_logs_insert_policy_present;
```

Repair rule:

- if migration effects are missing, apply checked-in migrations with `supabase db push --linked --include-all`;
- if migration effects already exist but the version row is missing, use `supabase migration repair --status applied <version>`;
- never mark a hosted migration as applied without first confirming its schema effects.

Do not print hosted keys, connection strings, or database passwords in task notes.

### Switch mobile app between local and hosted Supabase

Point the mobile app at hosted Supabase:

```bash
./supabase/scripts/use-hosted-mobile-env.sh
```

This reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from `supabase/.env.hosted` and updates only the Supabase entries in `apps/mobile/.env.local`.

Point the mobile app back at local Docker Supabase:

```bash
./supabase/scripts/local-runtime-up.sh
```

This starts or reuses the local Docker Supabase stack and rewrites the mobile Supabase entries in `apps/mobile/.env.local` to the local API URL and anon key.

After either switch, restart Expo/Metro so `EXPO_PUBLIC_*` values are rebundled.

### Test accounts (local fixtures)

- `user_a.local@example.test` / `ScaffoldingUserA!234`
- `user_b.local@example.test` / `ScaffoldingUserB!234`

Source: `supabase/scripts/auth-fixture-constants.sh`

## Logs

### App logs

- Expo/dev-client logs: terminal where `npm run start:ios:dev-client` or `npx expo start --dev-client` is running.
- Production diagnostic rows: Supabase Dashboard / SQL Editor query against `public.app_logs`. Mobile clients can insert rows only; use operator credentials for inspection.
- Maestro run artifacts/logs:
  - root: `apps/mobile/artifacts/maestro/<task-id-or-ad-hoc>/<timestamp>/`
  - key files: `runtime.env`, `provision.log`, `launch.log`, `teardown.log`, `expo-start.log`, `simulator-system.log`, `maestro-junit.xml`
- Live simulator process logs (manual):

```bash
APP_PATH="$(cd apps/mobile && ./scripts/maestro-ios-dev-client-build.sh --print-app-path)"
APP_EXECUTABLE="$(plutil -extract CFBundleExecutable raw -o - "$APP_PATH/Info.plist")"
xcrun simctl spawn booted log stream --style compact --level debug --predicate "process == \"$APP_EXECUTABLE\""
```

### Supabase logs

- Health function log file:

```bash
tail -f supabase/.temp/health-functions-serve.log
```

- Runtime status/env:

```bash
source ~/.config/boga/supabase/cli.env
npx -y "supabase@${SUPABASE_CLI_VERSION:-2.76.15}" status -o env
```

- Container logs (if needed):

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}' | rg supabase
docker logs -f <container-name>
```

## Tests

### Frontend (apps/mobile)

```bash
cd apps/mobile
npm run lint
npm run typecheck
npm run test
npm run db:generate:canary
```

### E2E / simulator runtime (apps/mobile)

```bash
cd apps/mobile
TASK_ID=ad-hoc npm run test:e2e:ios:smoke
TASK_ID=ad-hoc npm run test:e2e:ios:data-smoke
TASK_ID=ad-hoc npm run test:e2e:ios:auth-profile
```

### Backend (Supabase)

```bash
./supabase/scripts/test-fast.sh
./supabase/scripts/test-auth-authz.sh
./supabase/scripts/test-sync-api-contract.sh
./supabase/scripts/test-sync-events-ingest-contract.sh
```

### Logger diagnostics smoke (Docker Supabase)

Use the auth/authz contract suite as the canonical Docker-hosted local Supabase check for `public.app_logs`:

```bash
./supabase/scripts/test-auth-authz.sh
```

Notes:

- `./supabase/scripts/ensure-local-runtime-baseline.sh` reuses an already-running local Supabase instance without resetting it.
- The baseline helper still applies pending local migrations with `supabase db push --local --include-all --yes`.
- `./supabase/scripts/local-runtime-up.sh` syncs `apps/mobile/.env.local` with the local Docker Supabase URL and anon key after startup.
- The scripts invoke `npx -y supabase@${SUPABASE_CLI_VERSION}`, so first use may need network access to fetch the pinned Supabase CLI.
- The expected `app_logs` client contract is authenticated insert-only. Anonymous insert must fail, authenticated insert must pass, cross-user `user_id` spoofing must fail, and authenticated select/update/delete must fail.
- A mobile/Supabase JS smoke can validate insert success by checking that the insert returns no error. Reading the row back with an authenticated mobile client should be denied with `403` / `42501`.
- Inspect inserted log rows through operator SQL/service-role access, not from the mobile client.

### Repo-level wrappers

```bash
./scripts/quality-fast.sh
./scripts/quality-fast.sh frontend
./scripts/quality-fast.sh backend
./scripts/quality-slow.sh frontend
./scripts/quality-slow.sh backend
```

### Cross-stack restore-parity lane

```bash
cd apps/mobile
npm run test:sync:reinstall-parity
```
