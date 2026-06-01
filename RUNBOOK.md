# RUNBOOK

## Purpose

Human-operator guide for local development, runtime operations, logs, and tests across the mobile frontend, Maestro E2E runtime, and Supabase backend.

## Scope and conventions

- Run commands from repo root unless a section says otherwise.
- This runbook is for local development/runtime only.
- Authoritative Maestro runtime contract still lives in `docs/specs/11-maestro-runtime-and-testing-conventions.md`.

## Upgrading from v1 sync (one-time wipe)

If you are picking up a v2 sync build against an installation that
ran the v1 sync stack, you must wipe the local SQLite once before
launching v2. The v2 build assumes a clean local DB and ships no
auto-migration; booting against v1 data produces undefined behaviour
(rows that never sync, missing pull cursor, push/pull divergence).
The wipe procedure for iOS Simulator, Android Emulator, physical
devices, and TestFlight testers lives in
`docs/manual-wipe-v1-to-v2.md`. TestFlight testers in
particular must **delete the v1 build before installing v2** — do
NOT update in place.

## Prerequisites

- Node.js + npm
- Xcode + iOS Simulator (`xcrun simctl`)
- CocoaPods (`pod`)
- Maestro CLI (`maestro`) plus a Java runtime
- Docker (for local Supabase stack)
- `jq` (required by backend contract test scripts)

If Java is installed through Homebrew OpenJDK and Maestro cannot locate it, run Maestro/E2E commands with:

```bash
PATH="/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk" <command>
```

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

`./supabase/scripts/local-runtime-up.sh` automatically runs a Supabase cleanup sweep for completed worktree slots before starting the current slot. A slot is considered completed when, after the grace period, ANY of: its registered path is gone/invalid; it belongs to this git worktree group and is no longer listed by `git worktree list`; its branch HEAD is reachable from the configured remote main (default `origin/main`); or its branch has been deleted on the configured remote. Merge detection performs a single `git fetch --prune` at start-up (10 s timeout); disable with `--no-merge-detection` or skip the fetch with `--no-fetch`. Full contract: `docs/specs/12-worktree-config-and-isolation.md`.

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

After native dependency or config-plugin changes, rebuild the dev client before retesting on simulator/device:

```bash
cd apps/mobile
./scripts/maestro-ios-dev-client-build.sh
```

For GPS/location flows on iOS Simulator, choose a simulated location before testing:
Simulator -> Features -> Location -> any option other than None.

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

### Colima on macOS preflight

On macOS, Colima can provide the Docker-compatible daemon for local Supabase.

Check the active Docker context:

```bash
docker context ls
```

If the active context is `colima` but Docker cannot connect, start Colima:

```bash
colima start
```

Then start or reuse local Supabase:

```bash
./supabase/scripts/local-runtime-up.sh
```

Maestro flows that require local Supabase depend on the same daemon.

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

### Reset hosted Supabase (clean slate)

Canonical path for resetting the hosted database to match checked-in migrations. Use when the hosted schema is known-bad or has drifted, and there is no production data worth preserving.

**Destructive: drops the hosted database. Back up anything worth keeping first.**

Prerequisites: `supabase login` has been run and the project is linked (`supabase link --project-ref <ref>`).

Steps:

1. **Reset and reapply migrations (CLI, canonical path):**
   ```bash
   supabase db reset --linked --yes
   ```
   Drops the hosted database and reapplies every `supabase/migrations/*.sql` in order on a fresh DB.

2. **Re-expose `app_public` on the Data API.** Easy to miss — the schema exists post-reset but PostgREST will not serve it until you toggle it back on:
   - Supabase Dashboard → Project Settings → API → **Exposed schemas**
   - Add `app_public` to the comma-separated list (alongside `public`, `graphql_public`).
   - Save.

3. **Verify migrations applied:**
   ```bash
   supabase migration list --linked
   ```
   All checked-in migration versions should be listed as applied with no extras.

4. **Smoke check from the mobile app or `curl`:** confirm that an authenticated request to `app_public.<table>` returns rows / RLS-blocked rows (not a "schema not exposed" 404).

Do not print hosted keys, connection strings, or database passwords in task notes.

### Switch mobile app between local and hosted Supabase

Use the mode that matches where the app is running:

```bash
# iOS Simulator -> local Docker/Colima Supabase
./supabase/scripts/local-runtime-up.sh

# Physical device -> local Docker/Colima Supabase over the Mac LAN IP
./supabase/scripts/use-local-mobile-lan-env.sh

# Physical device -> hosted Supabase
./supabase/scripts/use-hosted-mobile-env.sh
```

`use-local-mobile-lan-env.sh` auto-detects the Mac LAN IP; override with `BOGA_MOBILE_LAN_HOST=<ip>` if needed.
`use-hosted-mobile-env.sh` reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from `supabase/.env.hosted`.

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
npm run test:handles   # serial --detectOpenHandles guard; fails (with a stack) on any leaked handle
npm run db:generate:canary
```

### E2E / simulator runtime (apps/mobile)

```bash
cd apps/mobile
TASK_ID=ad-hoc npm run test:e2e:ios:smoke
TASK_ID=ad-hoc npm run test:e2e:ios:data-smoke
TASK_ID=ad-hoc npm run test:e2e:ios:gates        # smoke + data-smoke sharing one sim + Metro (~28% faster than running both separately)
TASK_ID=ad-hoc npm run test:e2e:ios:auth-profile
TASK_ID=ad-hoc ./scripts/maestro-ios-run-flow.sh --flow .maestro/flows/exercise-block-history-fixture.yaml --scenario exercise-block-history-fixture
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
