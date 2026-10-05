# Maestro Runtime and Testing Conventions

> **Owns:** the Maestro iOS runtime/testing contract — reset taxonomy, artifacts, config files, isolation. **Not here:** lane membership → `02`/`scripts/lanes.tsv`; when lanes are required → `06`. **Load when:** Maestro/iOS e2e flow or harness work.

Everything below is normative. The implementation is the toolkit under
`apps/mobile/scripts/` (`maestro-*`), the per-lane runner
`apps/mobile/scripts/maestro-run-lane.sh`, and the flows in
`apps/mobile/.maestro/flows/`. For what each script does, read
`apps/mobile/scripts/README.md`; for lane membership and commands,
`scripts/lanes.tsv` / `./boga test --list`.

Operational entrypoints — `apps/mobile/README-maestro.md` (command quickstart)
and `apps/mobile/README_HUMAN_TESTING.md` — stay operational and link back here
instead of restating this contract.

## 1. Runtime model

1. The iOS automation runtime is Maestro + iOS Simulator + Expo development
   client. Expo Go is not a supported automation runtime.
2. The user-facing runners (`npm run test:e2e:ios:*`) are thin wrappers over the
   shared toolkit; they must not duplicate runtime orchestration logic.

## 2. Config files

| File | Role |
| --- | --- |
| `apps/mobile/.maestro/maestro.env.sample` | The only checked-in template. A template, never a runnable fallback. |
| `apps/mobile/.maestro/maestro.env.local` | The canonical local config, untracked, one per worktree. |

`apps/mobile/scripts/maestro-env.sh` owns the contract: it fails fast when the
local file is missing, then sources the sample first and the local file second.
Because the sample is sourced *first*, a value set there pins the variable and
shadows the worktree's intent — so it must leave the per-worktree and derived
values unset. Direct environment overrides still work, but the documented
baseline is `maestro.env.local`.

Variable names are defined in the sample file and in `maestro-env.sh`; the
runtime-state keys in `apps/mobile/scripts/maestro-ios-runtime.sh`
(`maestro_runtime_keys`). Two names carry contract meaning beyond their value:

- `MAESTRO_IOS_SHARED_BUILD_ROOT` — the canonical shared host-local root for
  reusable development-client artifacts.
- `MAESTRO_IOS_DEV_CLIENT_APP_PATH` — the resolved absolute `.app` path
  simulator provisioning consumes. Always *derived* from the root above, never
  set independently, so the build-write and cache-lookup paths cannot diverge.

## 3. Shared dev-client artifact

1. The artifact is host-local and reused across checkouts: one canonical root,
   `$HOME/.cache/boga/maestro/ios-dev-client` (`mobile-dev-client.app`, plus
   `dev-client-build.env` metadata and `build.log`). It is **never** keyed by
   worktree slot, so a freshly set-up worktree reuses an already-built client.
   `./boga worktree start` therefore writes no build root into the generated
   env, and `maestro-env.sh` collapses a legacy `.../ios-dev-client/wt<slot>`
   root back onto the shared one so older worktrees converge without
   regeneration.
2. `apps/mobile/scripts/maestro-ios-dev-client-build.sh` owns creating and
   refreshing it; smoke/data-smoke runners never build native binaries.
3. It builds in a temp workspace under the shared root
   (`npx expo prebuild --platform ios --clean --npm`, then `xcodebuild` with
   `ARCHS=<host-arch> ONLY_ACTIVE_ARCH=YES` — only the host simulator slice,
   because the cache is host-local and the second slice roughly doubles compile
   time), then atomically renames the staged `.app` from a PID-scoped temp dir
   into place. Concurrent builds in different worktrees therefore never let a
   reader observe a partial copy — which is what makes one shared root safe.
4. Rebuild happens only when the `.app` is missing, when `dev-client-build.env`
   is missing, or when `--force` is passed.
5. Host tools required: `node`/`npm`/`npx`, `xcrun`, `xcodebuild`, `pod`,
   `rsync`, `ditto`, `shasum`. No Expo/EAS login is needed;
   `apps/mobile/eas.json` keeps the development-client profiles (including
   `development-simulator`) for optional manual or EAS-based workflows.

### Native-dependency rebuilds are the author's responsibility

The cache is deliberately **not** auto-invalidated by JS, config, or dependency
changes. A native rebuild is expensive, and nearly every change — JS, pure-JS
dependencies, config that does not touch the native project — loads from the
Metro bundle at runtime. Auto-fingerprinting every native input was evaluated
and rejected because it forces full rebuilds on changes that do not need one.

So: when you add, remove, or upgrade a **native** dependency — any package that
ships an iOS pod or native Expo module (e.g. `expo-task-manager`,
`expo-background-task`, `expo-network`, anything from `npx expo install` with
native code) — or change a config plugin or a native iOS field in
`app.config.ts` (Android-only fields such as `android.package` are exempt), you
MUST force a rebuild before running the iOS Maestro gates:

```bash
./scripts/maestro-ios-dev-client-build.sh --force
```

Otherwise the gate silently reuses the old `.app`, which lacks the new native
module, and every flow fails at boot with `Cannot find native module '<X>'`.
Pure-JS or config-only changes need no rebuild.

## 4. Toolkit contracts

`apps/mobile/scripts/README.md` is the script inventory and
responsibility split (build → provision → launch → run → teardown, plus
`maestro-run-lane.sh` as the per-lane entrypoint holding each lane's flows,
reset strategy, Supabase config and fixture users, and `maestro-ios-gates.sh`
as the additive combined entrypoint). The contracts that are not visible from
the scripts' names:

1. **Flow copies.** `maestro-ios-run-flow.sh` and `maestro-ios-run-flows.sh`
   run each flow from a per-run copy under `MAESTRO_ARTIFACT_ROOT` (rewritten
   with the dev client's `appId`) and copy `apps/mobile/.maestro/scripts/`
   beside it, so a flow's `runScript` paths (`../scripts/*.js`) resolve
   identically from the source and the copy.
2. **Flow-variable allowlist.** `maestro-ios-run-flow.sh` forwards only an
   explicit allowlist of variables to `maestro test -e`. A lane that adds a
   flow variable must add it to that list, or the flow silently sees nothing.
3. **Shared-session runs.** `maestro-ios-run-flows.sh` runs several flows
   against ONE provisioned sim + Metro, paying the ~55-60s
   provision/launch/teardown overhead once instead of per flow. Every flow runs
   even after one fails, and any failure fails the run. Use it only for flows
   that reset what they need in-flow (`?reset=data`); a flow whose objective
   includes cold-install, permission or onboarding behaviour needs its own
   `full`-reset run through the singular runner. The caller owns
   `MAESTRO_RESET_STRATEGY`.

## 5. Runtime state and logs

The canonical artifact root is
`apps/mobile/artifacts/maestro/<task-id-or-ad-hoc>/<timestamp>/`. The
shared-session runner namespaces each flow's JUnit/output/debug under a per-flow
subdirectory of it.

Every run must emit, into that root: `runtime.env`, `provision.log`,
`launch.log`, `teardown.log`, `expo-start.log` (raw Expo process log),
`simulator-system.log` (`simctl log show`, for post-failure native diagnostics),
`maestro-junit.xml`, `maestro-output/` and `maestro-debug/`.

`runtime.env` carries the run's state from provision through teardown; its key
set is `maestro_runtime_keys` in `apps/mobile/scripts/maestro-ios-runtime.sh`.
When a run fails, start with `runtime.env`, `launch.log` and `expo-start.log`.

## 6. Parallel isolation

Cross-worktree parallel safety is mandatory, and is achieved with explicit
per-worktree config rather than host-level arbitration: each worktree
deterministically owns one Expo port, one simulator selection, one
`maestro.env.local`, and one runtime-state file per run (the dev-client build
cache is the deliberate exception — shared, see section 3). The port/simulator
derivation itself is owned by `docs/specs/12-worktree-config-and-isolation.md`.
Reintroducing automatic arbitration must preserve these guarantees without
weakening the per-worktree config contract.

## 7. Reset taxonomy

These exact terms are locked. **Prefer `teleport`**; use `data reset` when state
cleanup is required; use `full reset` only when install, permission or true
cold-start behaviour is part of the test objective.

| Term | Meaning | Implementation |
| --- | --- | --- |
| `teleport` | Land directly in the target screen/state via deep link or the hidden harness route. The default for routine positioning, because it avoids slow UI tapping. | Flows open `boga3://maestro-harness?…`; the harness route `replace`s into the requested screen after its reset work. |
| `data reset` | Clear app-owned persisted data, keeping the installed binary and runtime in place. Preferred when a clean data state is needed without re-testing install semantics. | The harness route calls `resetLocalAppData()`: close the SQLite handle, delete the local database, re-bootstrap migrations/seeds. |
| `full reset` | Cold-start/install-level reset. Not the default for ordinary setup. | `MAESTRO_RESET_STRATEGY=full`; `maestro-ios-provision.sh` uninstalls the dev client before reinstalling it. |

## 8. Harness and deep-link contract

1. Setup and navigation use the app scheme baseline (`boga3`), never Expo
   Go-specific URLs. The canonical hidden route is `boga3://maestro-harness`
   (`apps/mobile/app/maestro-harness.tsx`).
2. The supported query parameters — reset mode, fixture names, teleport targets,
   bootstrap/gate actions, and the dev-only failure injectors that make the next
   share, catalog or history read fail or stall so a flow can assert a retryable
   error surface — are the union types and resolvers in
   `apps/mobile/src/maestro/harness.ts`. Add a parameter there, not here. Some
   dev-only state injectors live on the target route instead of the harness
   (e.g. the insight loading/error states on the completed-session route,
   reached by a direct deep link after seeding); each is gated on `isDevMode()`.
3. The route is guarded by
   `isDevMode() && Constants.executionEnvironment !== storeClient`; blocked
   contexts render an error state instead of running reset/setup behaviour.
   `isDevMode()` (`apps/mobile/src/utils/isDevMode.ts`) is true for Metro dev
   bundles **and** for the `com.phano.boga3.dev` build, i.e. TestFlight dev.
   Never reach for `__DEV__` directly — it is `false` on TestFlight, and the
   lint rule rejects it.
4. Fixtures seed their sessions relative to *now* (`daysAgo`), so a flow built
   on one must never assert a literal calendar date — see the date rule in
   `docs/specs/06-testing-strategy.md`.
5. Harness-driven setup is preferred to visible UI tapping whenever the flow is
   not explicitly testing that setup UI.

## 9. App Supabase config isolation across lanes

Every lane runs the same dev-client build; whether it behaves as a local-only
(infra-free) app or a Supabase-configured one is decided entirely by the
`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` that Metro inlines
from `apps/mobile/.env.local` at bundle time. The `auth-profile`, `sync-e2e` and
`groups-e2e` lanes are the Supabase-backed iOS lanes — they provision a local
Supabase baseline and export those vars; every other iOS lane is deliberately
infra-free and exports none, so the inlined values are empty. (Which lanes take
which shape, and why, is testing policy — `docs/specs/06-testing-strategy.md`.)

`apps/mobile/.env.local` is a durable per-worktree file that local-Supabase
startup writes and that Expo's dev server reads **authoritatively** in dev (it
overrides `process.env` and is compiled into the served bundle). Left unmanaged,
whichever lane ran last configures the next, and a leftover auth `.env.local`
silently turns a later infra-free gate into a configured build. So the launcher
pins each lane's config:

1. Before `expo start`, `maestro_write_managed_env_local`
   (`apps/mobile/scripts/maestro-ios-runtime.sh`) sets aside any existing
   `.env.local` and writes the lane's intended config from the
   `EXPO_PUBLIC_SUPABASE_*` the lane exported. `maestro-run-lane.sh` resolves
   these from `supabase status` in a subshell, so sourcing the backend
   `_common.sh` cannot clobber its `SCRIPT_DIR`.
2. `maestro-ios-teardown.sh` restores the developer's file on success and on
   failure (runtime-state keys `MAESTRO_ENV_LOCAL_PATH` /
   `MAESTRO_ENV_LOCAL_BACKUP` carry the paths from launch to teardown; the
   per-run backup is gitignored). The manual dev launcher
   `apps/mobile/scripts/ios-dev-client-start.sh` is untouched, so `.env.local`
   stays usable for `npx expo start` by hand.
3. `expo start` gets `--clear` only when the lane's config differs from what
   Metro's transform cache was last built with, tracked per worktree in
   `apps/mobile/.maestro/.metro-supabase-signature`. Metro keys a module's
   transform on its source plus babel config, not on the inlined
   `EXPO_PUBLIC_*` values, so a prior lane's `supabase.ts` transform would
   otherwise survive the `.env.local` change; clearing only on a config switch
   keeps the warm bundle for repeated same-lane runs.

`EXPO_NO_DOTENV` and exporting empty `EXPO_PUBLIC_*` do **not** work here: in
dev Expo loads `.env.local` over the process env, so materializing the file is
the only reliable lever.

## 10. Fixture users: one per Supabase-backed flow

Every Maestro flow that signs in owns a **dedicated** auth fixture user; no two
flows share one. The pool lives in
`supabase/scripts/auth-fixture-constants.sh` and is bound to a flow by
`apps/mobile/scripts/maestro-run-lane.sh`. This is load-bearing: the lanes reuse
one local Supabase **without reset between runs**, so a shared user would let
one flow's residual server state (a partial catalog, a logged workout) leak into
another flow's pull and flake it. Self-signup is disabled, so the pool is fixed
— **adding a sign-in flow means adding a fixture user**, provisioning it with
the baseline, and wiring the mapping in the runner. Enforced by
`scripts/tests/maestro-fixture-users.test.sh` (the `meta-tests` lane, which runs
on any `.maestro/**` or `maestro*` change): it fails if two sign-in flows
resolve to the same fixture.

A flow whose claims depend on its user's server state resets that user with the
service role before the run, so repeated runs in one slot start alike —
`supabase/scripts/sync-e2e-fixture-reset.sh` (which also checks every pull layer
is empty, so the first sign-in always takes the bootstrapper's seed branch) and
`supabase/scripts/groups-fixture-reset.sh`.

**Scripted counterparties.** A flow needing a second user drives it over HTTP
from `runScript` (`apps/mobile/.maestro/scripts/`) instead of a second device.
Rules:

1. The counterparty is a dedicated fixture, bound by the runner through a
   `MAESTRO_<LANE>_COUNTERPARTY_EMAIL` variable the flow references in its
   `runScript` `env:`. The meta-test claims it like a device user: it may not be
   shared with another flow, nor be the flow's own device user.
2. Values reach the script only through that `env:` block (the variables are on
   the `maestro-ios-run-flow.sh` allowlist). The script keeps cross-step state
   in Maestro's `output` and throws on any unexpected response, failing the step.
3. The lane resets both users' server state with the service role before the
   run, so the flow is hermetic without a Supabase reset.
