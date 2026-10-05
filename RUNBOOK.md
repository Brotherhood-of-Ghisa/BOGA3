# RUNBOOK

Human-operator guide for local development: the iOS Simulator loop, development
database accounts, local Supabase, logs, and tests. Run commands from the repo
root unless a section says otherwise. Every `./boga test|db|ios|env` command
needs this worktree's slot lease — `./boga worktree start` first.

Load one of these instead when that is your task:

| If you are… | Load |
| --- | --- |
| running the app on an Android emulator | `docs/runbook-android-emulator.md` |
| running a development build on a physical iPhone (LAN, Tailscale, tunnel) | `docs/runbook-physical-iphone.md` |
| operating a **hosted** Supabase project — reset, function deploys, release cutover | `docs/runbook-hosted-operations.md` |

Machine prerequisites, worktree open/release, and per-worktree dependency
isolation live in `docs/specs/01-worktree-and-environment.md`; `./boga doctor`
checks this machine's capability and a FAIL is a bootstrap gap, not a skip. The
Maestro runtime contract is
`docs/specs/11-maestro-runtime-and-testing-conventions.md`.

## Preflight gotchas

- **macOS Docker context.** Prefer Docker Desktop. With both Docker Desktop and
  Colima installed, the active context decides which daemon the Supabase CLI
  uses — check `docker context ls` and run `docker context use desktop-linux`
  before starting local Supabase. On the Colima context the full stack fails
  when optional services bind-mount the Colima Docker socket
  (`mkdir …/docker.sock: operation not supported`); see
  [Colima fallback](#colima-fallback).
- **CocoaPods** (`pod`) must be installed for iOS builds — `./boga doctor` does
  not check it. `jq` is required by the backend contract test scripts.
- **Maestro cannot find Java** (Homebrew OpenJDK): prefix the command with
  `PATH="/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk"`.
- Use a **unique iOS simulator target per concurrent worktree**.

## Run the app on the iOS Simulator

```bash
cd apps/mobile && npx expo start        # fast JS loop
```

Dev-client loop (what the Maestro lanes run):

```bash
./boga ios build-client   # add --force after a native dependency or config-plugin change
./boga ios start
```

- **App quits instantly on iOS 27** and the crash report names
  `UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`: the installed
  binary predates `ios.enableSceneSupport` in `expo-build-properties`
  (`apps/mobile/app.config.ts`), so it has no scene manifest and iOS stops it
  before JavaScript starts. Rebuild and reinstall the dev client from the
  current checkout — reloading Metro cannot repair that binary.
- **GPS/location flows:** pick a location first — Simulator → Features →
  Location → anything other than None.

### Wipe the app on the Simulator

Wiping clears the device-local SQLite (`Library/LocalDatabase/<db>.db`) and all
app state. **App only** — long-press the icon until it jiggles and tap `×`, or:

```bash
APP_PATH="$(cd apps/mobile && ./scripts/maestro-ios-dev-client-build.sh --print-app-path)"
BUNDLE_ID="$(plutil -extract CFBundleIdentifier raw -o - "$APP_PATH/Info.plist")"
xcrun simctl uninstall booted "$BUNDLE_ID"
# reinstall + relaunch (also the recovery step after a whole-simulator erase)
xcrun simctl install booted "$APP_PATH" && xcrun simctl launch booted "$BUNDLE_ID"
```

**Whole simulator** — the heavy hammer; erases every app, login and saved state,
and the device must be shut down before it can be erased (GUI: Device → Erase
All Content and Settings…):

```bash
UDID="$(xcrun simctl list devices booted | grep -Eo '[0-9A-Fa-f-]{36}' | head -1)"
xcrun simctl shutdown "$UDID" && xcrun simctl erase "$UDID" && xcrun simctl boot "$UDID"
```

`./boga test ios-smoke` uses a full reset path and reinstalls automatically.

**Upgrading an install that ran v1 sync:** wipe once before launching v2. The v2
build assumes a clean local DB and ships no auto-migration; booting against v1
data produces undefined behaviour (rows that never sync, missing pull cursor,
push/pull divergence). Per-platform procedures — Simulator, Android Emulator,
physical devices, and TestFlight testers, who must **delete** the v1 build
rather than update in place — are in `docs/manual-wipe-v1-to-v2.md`.

## Log into a development database

There is no separate database login: point the app at a development Supabase and
sign in on the app's auth screen as a **development account**.

### Account inventory

| Account | Email / password | Use it for | Touched by tests? |
| --- | --- | --- | --- |
| **Dev A** | `a@dev.local` / `dev123` | Manual development — a near-blank account | No |
| **Dev B** | `b@dev.local` / `dev123` | Second human account (cross-user / sharing / sync); member of `Dev crew`, four recent weeks of sessions | No |
| **Rich History** | `history@dev.local` / `dev123` | Manual testing with imported GymBook history, four recent weeks, and the `Dev crew` group it owns | No |
| Fixture `user_a` | `user_a.local@example.test` / `ScaffoldingUserA!234` | Integration-test fixture (primary owner) | **Yes — reset / mutated / wiped every run** |
| Fixture `user_b` | `user_b.local@example.test` / `ScaffoldingUserB!234` | Integration-test fixture (cross-user denial) | **Yes** |
| `service_role_helper` | no login | Service-role setup fixture | Yes |
| `anonymous` | no login | Guest-path placeholder fixture | Yes |

Constants: `supabase/scripts/dev-account-constants.sh` (dev) and
`supabase/scripts/auth-fixture-constants.sh` + `supabase/seed.sql` (fixtures).

**Do manual development as a dev account, never as a fixture.** The backend
contract suites and Maestro lanes create, mutate and wipe `user_a` / `user_b` on
every run, so fixture data can vanish mid-session and your edits can perturb a
test run. The dev accounts are plain auth users, are not registered in
`public.dev_fixture_principals`, and no gate, CI lane or seed touches them.

### Provision the dev accounts

Dev accounts are auth users on whichever Supabase you target, so a fresh stack or
a reset wipes them. Re-provision afterwards (idempotent).

The main checkout has a **dedicated dev stack** (`project_id BOGA-dev`, API port
`65431`) isolated from the slot-0 stack the gates use, so **`boga test *` never
wipes your dev data or session**. The phone launchers and `./boga env dev` run
its baseline on every start.

```bash
./boga db dev        # baseline: up + apply pending migrations in place + seed dev users (no reset)
./boga db dev-up     # start the dev stack only
./boga db dev-down   # stop it (data persists)
./boga db dev-reset  # rebuild it — DROPS ALL DEV DATA
```

The baseline points the group-eval kick at the stack, seeds `a@` (near-blank),
`b@` and `history@` (rich imported history), seeds the `Dev crew` group
(`npm run seed:dev-groups` — `history@` owns, `b@` joins, both backdated), and
activates group competitions once (one-way until `dev-reset`). On real schema
drift it **fails loud** rather than wiping; rebuild explicitly with `dev-reset`.

`BOGA-dev` is main-checkout-only: a linked worktree runs the same baseline
against its own slot stack (contract:
`docs/specs/12-worktree-config-and-isolation.md`, "Dedicated dev stack").
To provision the accounts by themselves against any stack:

```bash
./boga db up                                       # or the stack you are targeting
./supabase/scripts/auth-provision-dev-accounts.sh  # create/refresh dev accounts
```

Against a hosted dev project, source `supabase/.env.hosted` first; hosted
provisioning needs the **legacy JWT `service_role`** key, not a
`sb_publishable_…` / `sb_secret_…` one. The fixture users have their own
provisioner (`./supabase/scripts/auth-provision-local-fixtures.sh`), which the
test baseline runs for you; manual dev never needs it.

### Sign in

Point the app at the database (iOS Simulator → `./boga db up`; physical iPhone →
`docs/runbook-physical-iphone.md`; hosted → `./boga env hosted`), make sure the
dev accounts exist there, then sign in as `a@dev.local` / `dev123` (or
`history@dev.local` for the imported history). A **network** error rather than
invalid-credentials is a connectivity problem, not an account problem.

## Local Supabase

```bash
./boga db up        # start this slot's stack; syncs apps/mobile/.env.local with its URL + anon key
./boga db down      # stop it
./boga db reset     # migrations + seed from scratch
./boga db baseline  # non-destructive: reuse a running stack, apply pending migrations, enforce fixtures
```

`db baseline` applies pending migrations with
`supabase db push --local --include-all --yes` and never resets. Worktree
teardown once the PR merges is `./boga worktree release`
(`docs/specs/01-worktree-and-environment.md`); leftovers from dead sessions are
`docs/procedures/worktree-cleanup.md`. Run `./boga db reset` between an iOS lane
and a backend lane — iOS-lane leftovers make `sync-pull-contract` fail falsely.

**Supabase CLI pin.** The scripts invoke `npx -y supabase@${SUPABASE_CLI_VERSION}`,
so first use may need network access. The repo owns the pin
(`BOGA_SUPABASE_CLI_DEFAULT_VERSION` in `scripts/worktree-lib.sh`); an explicit
`SUPABASE_CLI_VERSION` env value, then `~/.config/boga/supabase/cli.env`,
override it. CLIs below `BOGA_SUPABASE_CLI_MIN_VERSION` (2.108.0) are
**rejected**: their edge-runtime bootstrap imports `deno.land` on every start,
so `supabase start` ends `Waiting for health checks...` → empty
`supabase_edge_runtime_*` logs → `Error status 502` whenever deno.land is
unreachable. `./boga doctor` fails on a stale `SUPABASE_CLI_VERSION` line in
`~/.config/boga/supabase/cli.env`; delete it so the repo pin applies.

Add or reset accounts by hand in **Studio → Authentication → Users**; the Studio
URL is printed by
`bash -lc 'source supabase/scripts/_common.sh && run_supabase status'`.

### Colima fallback

Colima can run the minimal Auth/REST stack but not the full one. If you
intentionally use Colima:

```bash
colima start && docker context use colima
bash -lc 'source supabase/scripts/_common.sh && run_supabase start --exclude realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector'
./supabase/scripts/auth-provision-dev-accounts.sh
```

That is enough for app login and ordinary REST/Auth development. Use Docker
Desktop, not this workaround, for the full local runtime and every test gate.

### Switch the mobile app's backend

```bash
./boga env lan        # physical device → local Supabase over the Mac LAN IP
./boga env dev        # main checkout only → the BOGA-dev stack (127.0.0.1:65431)
./boga env tailscale  # phone off-LAN → local Supabase published over your tailnet
./boga env hosted     # hosted Supabase (SUPABASE_URL / SUPABASE_ANON_KEY from supabase/.env.hosted)
```

Restart Expo/Metro after any switch so `EXPO_PUBLIC_*` values are rebundled.
A linked worktree cannot use `env dev` — boot its own stack with `./boga db up`.

## MCP Virtual Coach (local)

```bash
./boga test mcp-smoke        # full OAuth → training-data proof on this slot's stack
./boga test agent-auth-web   # consent UI tests + production build + prod audit
./boga test mcp-unit         # MCP schemas / translation / auth boundary + prod audit
./boga test agent-api        # real local OAuth/API/RLS/revocation contract
```

`mcp-smoke` starts or reuses the slot stack, migrates, provisions the
deterministic users, inserts a unique training fixture, completes a real
dynamic-registration + authorization-code + PKCE consent flow, builds and starts
`services/boga-mcp`, calls each of the four tools with the OAuth token, verifies
the authorizing fixture IDs, and cleans up grant, audit metadata, process and
fixture rows. To reuse an already-issued token, supply all four values:

```bash
BOGA_MCP_SMOKE_ACCESS_TOKEN='<test-access-token>' \
BOGA_MCP_SMOKE_EXERCISE_ID='<owned-exercise-id>' \
BOGA_MCP_SMOKE_SESSION_ID='<owned-session-id>' \
BOGA_MCP_SMOKE_EXERCISE_QUERY='<owned-exercise-name>' \
./scripts/smoke-boga-mcp.sh
```

This form still starts the MCP process with **local** endpoint defaults, so use
it only with a token issued by this worktree's local Supabase. Never paste a
token into a committed file, shell history, task note or log. Hosted smoke runs
from the hosting platform — `docs/runbook-hosted-operations.md`.

**Connected agents.** In a signed-in build, Settings → Connected agents lists
each active grant with its client name, grant time and most recent
metadata-only access. **Revoke access** confirms, then uses Supabase Auth grant
revocation; subsequent MCP/API calls with the old token must return `401`. If
the list fails, check the build targets the same Supabase project as the grant.
If only **Last access** is missing, grant management still works — inspect the
`public.agent_access_audit` migration and RLS through operator SQL.

## Logs

- **Expo / dev-client:** the terminal running `./boga ios start` or
  `npx expo start --dev-client`.
- **Maestro artifacts:**
  `apps/mobile/artifacts/maestro/<task-id-or-ad-hoc>/<timestamp>/` — `runtime.env`,
  `provision.log`, `launch.log`, `teardown.log`, `expo-start.log`,
  `simulator-system.log`, `maestro-junit.xml`.
- **Live simulator process log:**

  ```bash
  APP_PATH="$(cd apps/mobile && ./scripts/maestro-ios-dev-client-build.sh --print-app-path)"
  APP_EXECUTABLE="$(plutil -extract CFBundleExecutable raw -o - "$APP_PATH/Info.plist")"
  xcrun simctl spawn booted log stream --style compact --level debug --predicate "process == \"$APP_EXECUTABLE\""
  ```

- **Supabase:** `tail -f supabase/.temp/health-functions-serve.log`;
  `bash -lc 'source supabase/scripts/_common.sh && run_supabase status -o env'`;
  `docker ps --format 'table {{.Names}}\t{{.Status}}' | rg supabase` then
  `docker logs -f <container-name>`.

### Diagnostic rows (`public.app_logs`)

Query `public.app_logs` from the Dashboard / SQL Editor with operator
credentials — mobile clients can only insert.

**Group triage** (`source = 'database'`;
`docs/specs/tech/groups-contract.md`). For `group.share_failed` (share trigger)
and `group.event_failed` (stream-item trigger) the session write still
committed; `context` is `{session_id, sqlstate}` and `user_id` is the owner. The
session's next accepted write heals both. For an `event_failed` session that
will not be written again, run `select app_public.group_events_backfill();` —
idempotent, inserts only missing items.

**Group evaluator triage** (`source = 'database'`, `user_id` = the member):

| Event | What it means | Recovery |
| --- | --- | --- |
| `group.eval_enqueue_failed` | an enqueue trigger failed; the sync write committed. `context` = `{table, row_id, sqlstate}` | the member's next accepted write of that session or link re-enqueues it |
| `group.eval_kick_failed` | the `pg_net` kick failed | the `group-eval-sweep` cron job (every 5 min) retries |
| `group.eval_failed` | a job failed and stays queued with backoff. `context` = `{job_id, kind, sqlstate}` | inspect `app_public.group_eval_queue` (`attempts`, `last_sqlstate`) |
| `group.eval_parked` | failed `group_eval_max_attempts()` times (10); stopped retrying (`available_at = 'infinity'`). `context` adds `attempts` | a recurring sqlstate after a deploy usually means the `group-eval` function is older than the migrations — redeploy it, then `select app_public.group_eval_retry_parked();` |

Comparison jobs (`kind = 'exercise'`, `app_public.group_metric_eval_queue`) carry
`group_id` and no `user_id`. To drain now:
`select app_public.group_eval_kick();`. If the queue grows and nothing drains,
check `select app_public.group_eval_config('group_eval_url');` and the
`group-eval` function logs.

**Sync-health triage.** `source = 'sync'`, `event = 'sync.cycle_result'` gives
each cycle's classified outcome (`converged` / `auth_required` /
`retryable_error` / `structural_error`) with an error code and sanitized message
(`apps/mobile/src/sync/cycle.ts`). A run of non-`converged` outcomes means the
scheduler ticks but does not converge — dirty rows are not draining — which is
distinct from the cadence transitions logged as `sync_scheduler_*`. Pull-side
local FK failures also log `source = 'database'`,
`event = 'sync.pull_local_fk_violation'`.

Push-side FK preflight **quarantines** a local orphan dirty row instead of
wedging the whole push: `sync.row_quarantined` (warn) names the orphan's
entity type/id, parent type, missing FK column and unresolved parent id, and
`sync.push_continued_after_quarantine` (info) reports pushed/quarantined counts.
The row is recorded in the device-local `sync_quarantine` table (not
`app_logs`) and skipped by every later push until repaired — parent restored or
child removed; `getSyncStatus().blockedRowCount`
(`apps/mobile/src/sync/sync-status.ts`) counts them. A recurring
`sync.row_quarantined` for the same id is an unrepaired structural orphan:
repair the row's FK parent locally. There is no user-facing repair UI, and the
app never performs automatic destructive local graph repair.

## Tests

`./boga test --list` is the lane registry (`scripts/lanes.tsv`): every lane name,
its gate, infra, and the command it runs. `./boga test <lane|gate>` runs one and
`./boga timings` reports measured durations — never estimate one. Which lanes a
change needs: `./boga test for` and
`docs/specs/02-quality-and-test-gates.md`. `./scripts/quality-fast.sh` and
`./scripts/quality-slow.sh` are legacy entrypoints that forward to `./boga`.

Operator extras that are not lanes:

```bash
cd apps/mobile
npm run db:generate:canary               # drizzle schema/migration drift canary
npm run test:handles -- sync-cycle       # one area; whole suite: ./boga test handles
TASK_ID=ad-hoc ./scripts/maestro-ios-run-flow.sh \
  --flow .maestro/flows/<flow>.yaml --scenario <scenario-name>   # one flow, ad hoc
```

- `./boga test handles` reports lingering resources with their stacks when Jest
  warns on shutdown or hangs. A diagnostic, not a PR requirement.
- `./boga test ios-gates` runs the smoke and data-runtime-smoke flows against
  one provisioned simulator and one Metro instead of paying the cold-boot
  overhead twice.
- Reinstall/restore parity is proven by the `cycle-round-trip` wiped-client
  assertion inside `./boga test sync-infra`, plus the backend sync contract
  lanes.
- `./boga test auth-authz` is the canonical local check for the
  `public.app_logs` client contract: **authenticated insert only** — anonymous
  insert must fail, authenticated insert must pass, cross-user `user_id`
  spoofing must fail, and authenticated select/update/delete must all fail
  (`403` / `42501`). Inspect inserted rows with operator/service-role SQL, never
  from the mobile client.
