# RUNBOOK

## Purpose

Human-operator guide for local development, runtime operations, logs, and tests across the mobile frontend, Maestro E2E runtime, and Supabase backend.

## Scope and conventions

- Run commands from repo root unless a section says otherwise.
- This runbook is for local development/runtime only.
- Authoritative Maestro runtime contract still lives in `docs/specs/11-maestro-runtime-and-testing-conventions.md`.

## Table of contents

- [Prerequisites](#prerequisites)
- [Worktree setup and isolation](#worktree-setup-and-isolation)
- [Quick start (full local stack)](#quick-start-full-local-stack)
- [Run the app on the iOS Simulator](#run-the-app-on-the-ios-simulator)
  - [Fast JS loop (Expo)](#fast-js-loop-expo)
  - [Dev-client loop (matches Maestro runtime)](#dev-client-loop-matches-maestro-runtime)
  - [Wipe the app completely on the Simulator](#wipe-the-app-completely-on-the-simulator)
  - [Automated uninstall/reinstall via smoke lane](#automated-uninstallreinstall-via-smoke-lane)
- [Run a development build on a physical iPhone](#run-a-development-build-on-a-physical-iphone)
  - [One-stop: dev-lan.sh](#one-stop-dev-lansh)
  - [Outside the LAN (Tailscale): dev-remote.sh](#outside-the-lan-tailscale-dev-remotesh)
  - [Make local Supabase reachable from the phone](#make-local-supabase-reachable-from-the-phone)
  - [Manual steps (env + Metro)](#manual-steps-env--metro)
  - [Point the app at hosted Supabase instead](#point-the-app-at-hosted-supabase-instead)
- [Troubleshooting: running on a physical phone](#troubleshooting-running-on-a-physical-phone)
  - [Phone cannot reach Expo or Metro (use --tunnel)](#phone-cannot-reach-expo-or-metro-use---tunnel)
  - [Phone cannot reach Supabase](#phone-cannot-reach-supabase)
- [Log into a development database](#log-into-a-development-database)
  - [Account inventory](#account-inventory)
  - [Provision the dev accounts](#provision-the-dev-accounts)
  - [Sign in](#sign-in)
- [Supabase: run locally and reset](#supabase-run-locally-and-reset)
- [Upgrading from v1 sync (one-time wipe)](#upgrading-from-v1-sync-one-time-wipe)
- [Logs](#logs)
- [Tests](#tests)

## Prerequisites

- Node.js + npm
- Xcode + iOS Simulator (`xcrun simctl`)
- CocoaPods (`pod`)
- Maestro CLI (`maestro`) plus a Java runtime
- Docker (for local Supabase stack)
- `jq` (required by backend contract test scripts)

On macOS, prefer **Docker Desktop** for this repo when it is installed. If both
Docker Desktop and Colima are present, check the active context before starting
local Supabase:

```bash
docker context ls
docker context use desktop-linux   # preferred for BOGA local Supabase
```

Using the Colima context can make Supabase CLI fail while starting optional
service containers that mount the host Docker socket. See
[Colima on macOS preflight](#colima-on-macos-preflight) for the symptom and
workaround.

If Java is installed through Homebrew OpenJDK and Maestro cannot locate it, run Maestro/E2E commands with:

```bash
PATH="/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk" <command>
```

## Worktree setup and isolation

Worktree setup, the environment sequence, and teardown are in
`docs/specs/01-worktree-and-environment.md` (always-load quickref). The full
isolation contract — slot/port model, every script, and the cleanup completion
signals — is in `docs/specs/12-worktree-config-and-isolation.md`.

Operator rules:

- never create a BOGA worktree under another BOGA checkout (it must live outside it);
- run `cd apps/mobile && npm install` in each worktree;
- do not symlink `apps/mobile/node_modules` between worktrees;
- use a unique iOS simulator target per concurrent worktree.

## Quick start (full local stack)

New-worktree setup (create → install deps → boot local Supabase) is the
ordered sequence in `docs/specs/01-worktree-and-environment.md`. To run the app on
a simulator afterward, see **Run the app on the iOS Simulator** below; to run on a
physical iPhone, see **Run a development build on a physical iPhone**.

## Run the app on the iOS Simulator

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

### Wipe the app completely on the Simulator

Wiping clears the device-local SQLite (at `Library/LocalDatabase/<db>.db`) and all
app state. This is also the required step when **upgrading from v1 sync** — see
[Upgrading from v1 sync (one-time wipe)](#upgrading-from-v1-sync-one-time-wipe).
Pick the scope you need.

**App only** — drops just the BOGA3 sandbox (local DB + state), leaves everything else:

- GUI: long-press the BOGA3 icon on the home screen until icons jiggle, then
  tap the `×` (or `Remove App` → `Delete App`).
- CLI:

  ```bash
  APP_PATH="$(cd apps/mobile && ./scripts/maestro-ios-dev-client-build.sh --print-app-path)"
  BUNDLE_ID="$(plutil -extract CFBundleIdentifier raw -o - "$APP_PATH/Info.plist")"
  xcrun simctl uninstall booted "$BUNDLE_ID"
  ```

**Whole simulator** — the heavy hammer; erases every app, login, photo, and saved state:

- GUI: in the Simulator menu, `Device` → `Erase All Content and Settings…` against
  the booted simulator, then confirm.
- CLI (the device must be shut down before it can be erased):

  ```bash
  UDID="$(xcrun simctl list devices booted | grep -Eo '[0-9A-Fa-f-]{36}' | head -1)"
  xcrun simctl shutdown "$UDID"
  xcrun simctl erase "$UDID"
  xcrun simctl boot "$UDID"
  ```

After either wipe, reinstall the built dev client and launch it:

```bash
APP_PATH="$(cd apps/mobile && ./scripts/maestro-ios-dev-client-build.sh --print-app-path)"
BUNDLE_ID="$(plutil -extract CFBundleIdentifier raw -o - "$APP_PATH/Info.plist")"
xcrun simctl install booted "$APP_PATH"
xcrun simctl launch booted "$BUNDLE_ID"
```

The full per-platform wipe procedure (Simulator, Android Emulator, physical
devices, TestFlight) lives in `docs/manual-wipe-v1-to-v2.md`.

### Automated uninstall/reinstall via smoke lane

The smoke runner uses a full reset path and reinstalls automatically:

```bash
cd apps/mobile
TASK_ID=ad-hoc npm run test:e2e:ios:smoke
```

## Run a development build on a physical iPhone

Running on a real iPhone needs two things on the phone: (1) an installed
development-client build of BOGA3, and (2) a reachable Metro bundler — plus a
reachable Supabase if you want auth/sync. Building, signing, and installing the
dev client on the device (local `eas build --profile dev --local`, ad hoc install
via `xcrun devicectl`, device registration) is documented end-to-end in
`apps/mobile/README-LOCAL-DEV-BUILD.md`. This section covers the day-to-day
run loop once that build is on the phone.

> Prerequisite: Mac and iPhone must be on the **same Wi-Fi/LAN**, and Docker
> Desktop or Colima must be running for local Supabase. If you cannot share a LAN,
> see [Troubleshooting](#troubleshooting-running-on-a-physical-phone) for the
> `--tunnel` + hosted-Supabase fallback.

### One-stop: dev-lan.sh

The single command that chains everything — boots this slot's local Supabase,
points `apps/mobile/.env.local` at the Mac's LAN IP, and starts Expo/Metro over
the LAN in `--dev-client` mode:

```bash
./scripts/dev/dev-lan.sh
```

Notes:

- Phone and Mac must be on the same network. Open the dev client on the phone
  (scan the QR code Expo prints, or open the dev-client URL).
- Extra args are forwarded to `expo start`, e.g. `./scripts/dev/dev-lan.sh --clear`.
- Supabase containers persist after you Ctrl+C Expo. Stop them with
  `./supabase/scripts/local-runtime-down.sh`.

### Outside the LAN (Tailscale): dev-remote.sh

When the phone is **not** on the same Wi-Fi (cellular, a different building, guest
Wi-Fi with client isolation), route the whole session over your tailnet instead.
This keeps the **local** Supabase + Metro — no hosted backend, no dev-client
rebuild — by publishing both over `tailscale serve` as real HTTPS:

```bash
./scripts/dev/dev-remote.sh
```

It boots this slot's Supabase, publishes it at `https://<magicdns-name>`, rewrites
`apps/mobile/.env.local` to that URL, publishes Metro at
`https://<magicdns-name>:8443`, and starts Expo. On the phone's dev client, load
`https://<magicdns-name>:8443` (the script prints the exact URL).

Why HTTPS and not the LAN flow's plain HTTP: a strict-ATS dev build (the
`com.phano.boga3.dev` TestFlight build) rejects plain HTTP to a `100.x` Tailscale
address. The trusted `*.ts.net` cert from `tailscale serve` sidesteps App
Transport Security entirely, so the existing build works unchanged.

Prerequisites (one-time):

- Tailscale installed and signed into the **same tailnet** on both this Mac and
  the phone.
- HTTPS certificates enabled for the tailnet:
  [admin → DNS](https://login.tailscale.com/admin/dns) → MagicDNS on, then
  **Enable HTTPS**. `dev-remote.sh` fails fast with this instruction if it is off.

Notes:

- The env-only half (boot Supabase + publish it + rewrite `.env.local`) is
  `./scripts/dev/use-local-mobile-tailscale-env.sh` — also `./boga env tailscale`.
- Run **one worktree at a time**: the `443`/`8443` serve mappings are per-machine.
- Override MagicDNS detection with `BOGA_MOBILE_TS_HOST=...`; the Metro port with
  `EXPO_PORT=...`. Extra args forward to `expo start` (e.g. `--clear`).
- Tear down when done:
  `./supabase/scripts/local-runtime-down.sh` and
  `tailscale serve --https=443 off && tailscale serve --https=8443 off`.

### Make local Supabase reachable from the phone

On a physical phone, `localhost`/`127.0.0.1` resolves to the **phone itself**, so
the app must reach Supabase over the Mac's LAN IP. The env half of `dev-lan.sh`:

```bash
./scripts/dev/use-local-mobile-lan-env.sh    # also: ./boga env lan
```

This starts (or reuses) local Supabase and rewrites `apps/mobile/.env.local` to
`EXPO_PUBLIC_SUPABASE_URL=http://<mac-lan-ip>:<slot-api-port>` (keeping the
client-safe anon key). If auto-detection picks the wrong interface, override it:

```bash
BOGA_MOBILE_LAN_HOST=<mac-lan-ip> ./scripts/dev/use-local-mobile-lan-env.sh
```

Restart Metro after any env switch so `EXPO_PUBLIC_*` values are rebundled.

### Manual steps (env + Metro)

If you prefer to run the pieces yourself instead of `dev-lan.sh`:

```bash
# 1. Point the mobile env at local Supabase over the LAN (see above).
./scripts/dev/use-local-mobile-lan-env.sh

# 2. Start Metro over the LAN on this worktree's dev-server port.
cd apps/mobile
set -a; source .maestro/maestro.env.local; set +a
npx expo start --dev-client --host lan --scheme boga3 --port "$EXPO_DEV_SERVER_PORT"
```

### Point the app at hosted Supabase instead

To run the phone build against hosted Supabase rather than your local stack:

```bash
./scripts/dev/use-hosted-mobile-env.sh    # also: ./boga env hosted
```

`use-hosted-mobile-env.sh` reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from
`supabase/.env.hosted`. Restart Metro afterward. See
[Switch mobile app between local and hosted Supabase](#switch-mobile-app-between-local-and-hosted-supabase)
for the full matrix and [Log into a development database](#log-into-a-development-database) for accounts and sign-in.

## Troubleshooting: running on a physical phone

### Phone cannot reach Expo or Metro (use --tunnel)

Symptoms: the dev client hangs on "Downloading JavaScript bundle", shows "Could
not connect to the development server", or the LAN URL / QR code times out.

Check first:

- Mac and phone are on the **same Wi-Fi**, and you answered any macOS firewall
  prompt to allow `node`/incoming connections.
- Metro is started with `--host lan` (this is what `dev-lan.sh` does).

If the LAN itself is the problem — guest/corporate Wi-Fi with client isolation, a
VPN, or Mac and phone on different subnets — route the bundler over an Expo
**tunnel** instead of the LAN:

```bash
cd apps/mobile
set -a; source .maestro/maestro.env.local; set +a
npx expo start --dev-client --tunnel --scheme boga3 --port "$EXPO_DEV_SERVER_PORT"
```

- The first `--tunnel` run prompts to install `@expo/ngrok` — accept it.
- Scan the QR code (or open the dev-client URL) Expo prints over the tunnel.

> **Important:** a tunnel fixes *Metro* reachability only. It does **not** make
> local Supabase reachable — local Supabase is served on the Mac's LAN IP, so a
> phone that cannot reach the LAN still cannot reach it over the tunnel. For a
> fully off-LAN setup, also point the app at hosted Supabase
> (`./scripts/dev/use-hosted-mobile-env.sh`) and restart Metro.

### Phone cannot reach Supabase

Symptoms: the app loads, but login/sync fail with network errors to
`http://<ip>:<port>`, or auth/sync appears disabled.

- **Stack not up:** start local Supabase (`./supabase/scripts/local-runtime-up.sh`)
  and confirm the Docker daemon is reachable (`docker info`). On macOS with Colima,
  `colima start` first.
- **Wrong host in env:** confirm `apps/mobile/.env.local` points at the Mac's LAN
  IP, not `127.0.0.1`/`localhost` (on the phone, localhost = the phone). Re-run
  `./scripts/dev/use-local-mobile-lan-env.sh` (or `./scripts/dev/dev-lan.sh`), then
  **restart Metro** so `EXPO_PUBLIC_*` rebundle.
- **Wrong interface detected:** find the Mac IP with `ipconfig getifaddr en0`
  (or `en1`) and pin it: `BOGA_MOBILE_LAN_HOST=<mac-lan-ip> ./scripts/dev/use-local-mobile-lan-env.sh`.
- **Reachability test:** from another device on the same Wi-Fi (or the phone's
  browser), open `http://<mac-lan-ip>:<slot-api-port>` (the URL written into
  `apps/mobile/.env.local`). A timeout means a network/firewall issue — same
  Wi-Fi? client isolation enabled? macOS firewall allowing the Docker/Supabase
  ports?
- **Can't share a LAN at all:** switch to hosted Supabase
  (`./scripts/dev/use-hosted-mobile-env.sh`) and restart Metro. A Metro tunnel
  alone will not carry traffic to a LAN-only Supabase.
- Still stuck? Check the [Supabase logs](#supabase-logs) and the `app_logs` sync
  rows described under [App logs](#app-logs).

## Log into a development database

"Logging into a development database" means running the app pointed at a
development Supabase — local Docker on the Simulator, local-over-LAN on a
physical phone, or a hosted dev project (see the run sections above) — and then
signing in through the app's auth screen with a **development account**. There is
no separate database login for normal use; the app authenticates against Supabase
Auth on whichever stack it targets.

### Account inventory

| Account | Email | Password | Use it for | Touched by tests? |
| --- | --- | --- | --- | --- |
| **Dev A** | `a@dev.local` | `dev123` | **Manual development** — sign in and click around | No |
| **Dev B** | `b@dev.local` | `dev123` | Second human account (cross-user / sharing / sync) | No |
| Fixture `user_a` | `user_a.local@example.test` | `ScaffoldingUserA!234` | Integration-test fixture (primary owner) | **Yes — reset / mutated / wiped every run** |
| Fixture `user_b` | `user_b.local@example.test` | `ScaffoldingUserB!234` | Integration-test fixture (cross-user denial) | **Yes** |
| `service_role_helper` | — (no login) | — | Service-role setup fixture | Yes |
| `anonymous` | — (no login) | — | Guest-path placeholder fixture | Yes |

Sources: dev accounts — `supabase/scripts/dev-account-constants.sh`; fixtures —
`supabase/scripts/auth-fixture-constants.sh` + `supabase/seed.sql`.

**Use the dev accounts (`a@dev.local` / `b@dev.local`) for manual development — not the
fixtures.** The backend contract suites and Maestro lanes create, mutate, and
wipe `user_a` / `user_b` on every run, so anything you do as a fixture user can
vanish mid-session and your edits can perturb a test run. The dev accounts exist
precisely so manual dev never collides with integration testing: they are plain
auth users, are not registered in `public.dev_fixture_principals`, and no gate,
CI lane, or seed touches them.

### Provision the dev accounts

The dev accounts are auth users on whichever Supabase you target. A fresh local
stack and `supabase db reset` both wipe `auth.users`, so re-run this after a
reset — it is idempotent (creates the accounts if missing, resets their passwords
if present).

**Automatic (the usual path):** the phone launchers `scripts/dev/dev-lan.sh` and
`scripts/dev/dev-remote.sh` now run the **dev DB baseline** on every start, which
seeds these accounts for you. The baseline reuses a running stack **without
resetting it** (your logged data survives), applies any pending migrations in
place, and seeds `a@dev.local` / `b@dev.local`. Run it standalone any time with:

```bash
boga db dev      # ./supabase/scripts/ensure-dev-baseline.sh
```

On real schema drift it **fails loud** rather than wiping — it tells you to run
`boga db reset` (which DROPS ALL LOCAL DATA) explicitly. Use that only when you
actually want a clean rebuild.

Local Docker/Colima Supabase, provisioning the accounts by themselves:

```bash
./supabase/scripts/local-runtime-up.sh             # ensure this worktree's stack is up
./supabase/scripts/auth-provision-dev-accounts.sh  # create/refresh a@dev.local + b@dev.local
```

Hosted dev Supabase project:

```bash
set -a; source supabase/.env.hosted; set +a        # SUPABASE_URL + legacy JWT service_role key
./supabase/scripts/auth-provision-dev-accounts.sh
```

Hosted provisioning needs the **legacy JWT `service_role`** key (not a
`sb_publishable_...` / `sb_secret_...` key) — same requirement as the other auth
scripts. The fixture users have their own provisioner
(`./supabase/scripts/auth-provision-local-fixtures.sh`), which the test baseline
runs automatically; you do not need it for manual dev.

### Sign in

1. Point the app at the development database you want:
   - **iOS Simulator** → local Docker/Colima Supabase (`./supabase/scripts/local-runtime-up.sh`).
   - **Physical iPhone** → local Supabase over the Mac LAN (`./scripts/dev/dev-lan.sh`), or hosted (`./scripts/dev/use-hosted-mobile-env.sh`). See [Switch mobile app between local and hosted Supabase](#switch-mobile-app-between-local-and-hosted-supabase).
2. Make sure the dev accounts exist on that database (provision step above).
3. Launch the app and sign in on the auth screen as `a@dev.local` / `dev123` (or `b@dev.local`).

If sign-in fails with a **network** error rather than invalid-credentials, that is
a connectivity problem, not an account problem — see
[Troubleshooting](#troubleshooting-running-on-a-physical-phone).

### Inspect or manage accounts (operator)

Open this worktree's local **Supabase Studio** → **Authentication → Users** to
see, add, or reset accounts by hand. The Studio URL is printed by:

```bash
source ~/.config/boga/supabase/cli.env
npx -y "supabase@${SUPABASE_CLI_VERSION:-2.76.15}" status   # see "Studio URL"
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

On macOS, prefer Docker Desktop for BOGA local Supabase when it is available. If
Docker Desktop and Colima are both installed, the active Docker context decides
which daemon Supabase CLI uses.

Check the active Docker context:

```bash
docker context ls
```

Recommended context for this repo:

```bash
docker context use desktop-linux
docker info --format '{{.ServerVersion}} {{.OperatingSystem}}'
./supabase/scripts/local-runtime-up.sh
```

Colima can run the minimal Auth/REST stack, but the full Supabase local stack may
fail when optional services try to bind-mount the Colima Docker socket:

```text
failed to start docker container: Error response from daemon:
error while creating mount source path '/Users/<you>/.colima/default/docker.sock':
mkdir /Users/<you>/.colima/default/docker.sock: operation not supported
```

If you intentionally use Colima, first make sure it is running:

```bash
colima start
docker context use colima
docker info --format '{{.ServerVersion}} {{.OperatingSystem}}'
```

For normal simulator login while on Colima, start the minimal local Supabase
stack and provision the human dev accounts:

```bash
bash -lc 'source supabase/scripts/_common.sh && run_supabase start --exclude realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector'
./supabase/scripts/auth-provision-dev-accounts.sh
```

That workaround is enough for app login (`a@dev.local` / `dev123`) and ordinary
REST/Auth development. Use Docker Desktop, not this Colima workaround, for the
full local runtime and test gates that expect the complete Supabase stack.

### Start/stop/reset

Start runtime:

```bash
./supabase/scripts/local-runtime-up.sh
```

Stop runtime:

```bash
./supabase/scripts/local-runtime-down.sh
```

Worktree teardown — stopping, sweeping orphans, and cleaning a completed slot
(`worktree-sweep` / `worktree-clean`): `docs/specs/01-worktree-and-environment.md`.

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
# iOS Simulator -> local Docker Desktop Supabase
./supabase/scripts/local-runtime-up.sh

# Physical device -> local Docker Desktop Supabase over the Mac LAN IP
./scripts/dev/use-local-mobile-lan-env.sh

# Physical device -> hosted Supabase
./scripts/dev/use-hosted-mobile-env.sh
```

`use-local-mobile-lan-env.sh` auto-detects the Mac LAN IP; override with `BOGA_MOBILE_LAN_HOST=<ip>` if needed.
`use-hosted-mobile-env.sh` reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from `supabase/.env.hosted`.

After either switch, restart Expo/Metro so `EXPO_PUBLIC_*` values are rebundled.

For a real iPhone development-client build that installs on a physical device,
use `apps/mobile/README-LOCAL-DEV-BUILD.md`. It covers the local `eas build
--profile dev --local` path, ad hoc install, Metro over LAN, and local Supabase
LAN env setup. The day-to-day run loop is summarized in
[Run a development build on a physical iPhone](#run-a-development-build-on-a-physical-iphone).

### Accounts and sign-in

Development sign-in accounts (`a@dev.local` / `b@dev.local`) and the integration-test
fixtures (`user_a` / `user_b`) — what each is for, how to provision them, and how
to sign in — are inventoried in
[Log into a development database](#log-into-a-development-database). Use the dev
accounts for manual work; the fixtures are mutated and wiped by the test suites.

## Upgrading from v1 sync (one-time wipe)

If you are picking up a v2 sync build against an installation that
ran the v1 sync stack, you must wipe the local SQLite once before
launching v2. The v2 build assumes a clean local DB and ships no
auto-migration; booting against v1 data produces undefined behaviour
(rows that never sync, missing pull cursor, push/pull divergence).
The wipe procedure for iOS Simulator, Android Emulator, physical
devices, and TestFlight testers lives in
`docs/manual-wipe-v1-to-v2.md` (Simulator wipe is also summarized under
[Wipe the app completely on the Simulator](#wipe-the-app-completely-on-the-simulator)).
TestFlight testers in particular must **delete the v1 build before installing v2** — do
NOT update in place.

## Logs

### App logs

- Expo/dev-client logs: terminal where `npm run start:ios:dev-client` or `npx expo start --dev-client` is running.
- Production diagnostic rows: Supabase Dashboard / SQL Editor query against `public.app_logs`. Mobile clients can insert rows only; use operator credentials for inspection.
  - Sync-health triage: filter `source = 'sync'`, `event = 'sync.cycle_result'` to see each cycle's classified outcome (`converged` / `auth_required` / `retryable_error` / `structural_error`) with its error code and a sanitized message — a run of non-`converged` outcomes means the scheduler is ticking but not converging (dirty rows are not draining), distinct from the scheduler cadence transitions logged under `sync_scheduler_*`. Pull-side local FK failures additionally log `source = 'database'`, `event = 'sync.pull_local_fk_violation'`. Push-side FK closure preflight now **quarantines** a local orphan dirty row (one that would fail `sync_push`) instead of wedging the whole push: it logs `source = 'sync'`, `event = 'sync.row_quarantined'` (level `warn`) with the orphan's entity type/id, parent type, the missing FK column, and the unresolved parent id, and `event = 'sync.push_continued_after_quarantine'` (level `info`) with the pushed/quarantined row counts confirming the valid rows still drained. The quarantined row is recorded in the device-local `sync_quarantine` table (not in `app_logs`) and is skipped by every subsequent push until repaired (parent restored or child removed); `getSyncStatus().blockedRowCount` reports how many rows are currently quarantined. A recurring `sync.row_quarantined` for the same id means an unrepaired structural orphan — repair the row's FK parent locally to release it; there is no user-facing repair UI yet, and the app performs no automatic destructive local graph repair.
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
./boga test backend-fast
./boga test auth-authz
# sync v2 contract suites (or run all backend slow suites via: ./boga test backend)
./boga test sync-v2-schema
./boga test sync-push-contract
./boga test sync-pull-contract
./boga test sync-v2-e2e
# every lane: ./boga test --list
```

### Logger diagnostics smoke (Docker Supabase)

Use the auth/authz contract suite as the canonical Docker-hosted local Supabase check for `public.app_logs`:

```bash
./boga test auth-authz
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

Reinstall/restore parity is proven by the sync-v2 `cycle-round-trip` assertion
inside `test:sync:infra`, plus the backend sync-v2 contract suites:

```bash
cd apps/mobile
npm run test:sync:infra            # includes the wiped-client restore assertion
# backend parity: ./scripts/quality-slow.sh backend (from repo root)
```

See `docs/specs/02-quality-and-test-gates.md` for how to provision the local
endpoint these read.
