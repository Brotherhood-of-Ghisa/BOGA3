# Maestro Runtime and Testing Conventions (M10 Contract)

## Purpose

This document is the authoritative source of truth for the `apps/mobile` Maestro runtime and testing contract.

It has two jobs:

1. record the verified current implementation as of `2026-03-01`, based on code rather than historical runbooks;
2. lock the exact M10 runtime, config, script, artifact, and terminology contract that follow-up tasks must implement.

## Status / scope

- Scope: iOS Maestro runtime/tooling, flow execution conventions, and the related documentation ownership model for `apps/mobile/**`.
- Current-state status: the implemented runtime uses an Expo development client, shared host-local build reuse, and explicit provision/launch/teardown scripts.
- Target-state status: M10 now has the reset taxonomy and harness-based navigation implemented; broader docs/runbook integration remains in follow-up work.
- Phase-2 runtime-toolkit status (`2026-03-01`): the shared development-client runtime toolkit is implemented and the smoke/data-smoke runners now execute through it on real iOS simulator runs.
- Authority rule:
  - this doc is normative for Maestro runtime/testing conventions;
  - milestone/task docs may scope work, but must not redefine this contract;
  - app runbooks should stay operational and link back here for the full policy.

## Documentation ownership model

- Authoritative contract:
  - `docs/specs/11-maestro-runtime-and-testing-conventions.md`
- Secondary operational entrypoints:
  - `apps/mobile/README-maestro.md`
  - `apps/mobile/README_HUMAN_TESTING.md`
- Supporting but non-authoritative context:
  - `docs/specs/milestones/M10-maestro-parallel-runtime-and-testing-conventions.md`
  - `docs/brainstorms/Maestro-Revamp`
  - historical Maestro task cards

Rules:

1. The full runtime/testing contract lives here.
2. Secondary runbooks should stay operational and link back here instead of duplicating the full contract.
3. The brainstorm and old task docs are context only; they are not source-of-truth once this doc exists.

## Implemented runtime toolkit (`2026-03-01`)

- Checked-in config sample:
  - `apps/mobile/.maestro/maestro.env.sample`
- Canonical untracked local config:
  - `apps/mobile/.maestro/maestro.env.local`
- Shared env helper:
  - `apps/mobile/scripts/maestro-env.sh`
- Shared runtime helper:
  - `apps/mobile/scripts/maestro-ios-runtime.sh`
- Shared build/reuse entrypoint:
  - `apps/mobile/scripts/maestro-ios-dev-client-build.sh`
- Shared lifecycle entrypoints:
  - `apps/mobile/scripts/maestro-ios-provision.sh`
  - `apps/mobile/scripts/maestro-ios-launch.sh`
  - `apps/mobile/scripts/maestro-ios-teardown.sh`
- Shared scenario runner:
  - `apps/mobile/scripts/maestro-ios-run-flow.sh`
- Current implementation note:
  - the shared env/build contract remains in place;
  - the smoke/data-smoke runners are now thin wrappers over the shared lifecycle toolkit;
  - app-side harness-driven data reset and teleport setup are now implemented.

## Verified current-state baseline (`2026-03-01`)

### Current flows

- The two core runtime-smoke flows this toolkit baseline was first verified against are:
  - `apps/mobile/.maestro/flows/smoke-launch.yaml`
  - `apps/mobile/.maestro/flows/data-runtime-smoke.yaml`
- The committed flow set has since grown (login/auth-profile and stats/UX flows that
  reuse the same toolkit and reset taxonomy); the current set lives in `apps/mobile/.maestro/flows/`.
- Both flows now commit against the development-client bundle identifier surface instead of `host.exp.Exponent`.
- The shared scenario runner also rewrites a runtime-local flow copy under the artifact root so the executed `appId` always matches the installed development-client bundle id from the built `.app`.
- Flow setup now uses the M10 taxonomy instead of tapping through setup screens:
  - `smoke-launch.yaml` relies on runner-owned `full reset` plus a harness `teleport` to the recorder.
  - `data-runtime-smoke.yaml` uses a harness `data reset + teleport` to land on the recorder before performing the actual data insert/read assertions.
- Both flows include optional dismissals for current development-client onboarding/dev-menu overlays so the scenario assertions target the app rather than the shell chrome.
- Verified against:
  - `apps/mobile/.maestro/flows/smoke-launch.yaml`
  - `apps/mobile/.maestro/flows/data-runtime-smoke.yaml`

### Current runner behavior

- The current entrypoints are `npm run test:e2e:ios:smoke` and `npm run test:e2e:ios:data-smoke`, which call:
  - `apps/mobile/scripts/maestro-ios-smoke.sh`
  - `apps/mobile/scripts/maestro-ios-data-smoke.sh`
- Both runner scripts now:
  - delegate immediately to `apps/mobile/scripts/maestro-ios-run-flow.sh`,
  - set `MAESTRO_RESET_STRATEGY` before entering the shared runner (`full` for smoke, `data` for data-smoke),
  - source the per-worktree config from `.maestro/maestro.env.local`,
  - use the configured `EXPO_DEV_SERVER_PORT`,
  - resolve a simulator from `IOS_SIM_UDID` or fall back to `IOS_SIM_DEVICE`,
  - create artifacts under `apps/mobile/artifacts/maestro/<task-id-or-ad-hoc>/<timestamp>/`,
  - write `runtime.env` before provisioning so downstream lifecycle steps and teardown share one state file,
  - call `maestro-ios-provision.sh` to ensure the shared development-client build exists, boot the simulator, and install the `.app`,
  - let `maestro-ios-provision.sh` convert `MAESTRO_RESET_STRATEGY=full` into a simulator uninstall/reinstall cycle before launch,
  - call `maestro-ios-launch.sh` to start `npx expo start --dev-client --host localhost --scheme <scheme> --port <port>`, wait on Metro `/status`, and open `exp+<scheme>://expo-development-client/?url=http://127.0.0.1:<port>`,
  - create a runtime-local flow copy with the resolved development-client bundle id,
  - execute `maestro test`,
  - call `maestro-ios-teardown.sh` on both success and failure to stop Expo and terminate the app process.
- Verified against:
  - `apps/mobile/package.json:17-18`
  - `apps/mobile/scripts/maestro-ios-smoke.sh`
  - `apps/mobile/scripts/maestro-ios-data-smoke.sh`
  - `apps/mobile/scripts/maestro-ios-run-flow.sh`
  - `apps/mobile/scripts/maestro-ios-provision.sh`
  - `apps/mobile/scripts/maestro-ios-launch.sh`
  - `apps/mobile/scripts/maestro-ios-teardown.sh`

### Current simulator helper behavior

- `apps/mobile/scripts/ios-sim-boot.sh` resolves a simulator by `IOS_SIM_UDID` or `IOS_SIM_DEVICE`, boots it, waits for boot readiness, and echoes the resolved UDID.
- When `IOS_SIM_AUTO_CREATE=1` and no simulator matching `IOS_SIM_DEVICE` exists, it creates a dedicated simulator using the newest available iOS runtime and a preferred iPhone simulator type, logging a loud `[maestro] sim "<name>" not found — creating (deviceType=…, runtime=…)` line before it does so.
- `IOS_SIM_AUTO_CREATE` now defaults to `1` everywhere — both the `maestro-env.sh` fallback and `.maestro/maestro.env.sample`. The sample is sourced before `maestro.env.local`, so a `0` in the sample would have pinned the variable and silently suppressed a worktree's intended `1`; keeping both at `1` makes the smoke gate self-heal a missing slot-named simulator with no manual step.
- App installation and runtime-state emission now live in `maestro-ios-provision.sh`, which wraps the helper instead of expanding `ios-sim-boot.sh` itself.
- Verified against:
  - `apps/mobile/scripts/ios-sim-boot.sh`
  - `apps/mobile/scripts/maestro-ios-provision.sh`

### Current worktree-isolation behavior

- Runtime isolation now comes from explicit per-worktree config instead of a shared host lock.
- Each workspace sets its own `EXPO_DEV_SERVER_PORT` and simulator target in `apps/mobile/.maestro/maestro.env.local`.
- Worktree setup generates `EXPO_DEV_SERVER_PORT` from the BOGA worktree slot and defaults `IOS_SIM_DEVICE` to a slot-named simulator with `IOS_SIM_AUTO_CREATE=1`.
- `IOS_SIM_UDID` is preferred for shared-host use because simulator names can collide across cloned devices.
- If two worktrees are configured with the same simulator or Metro port, they can still interfere with each other; the scripts no longer arbitrate that automatically.

### Current app/build assumptions

- `apps/mobile/app.config.ts` defines `scheme: "boga3"`, which gives M10 a usable app/deep-link scheme baseline.
- `apps/mobile/eas.json` already defines a `development` build profile with `developmentClient: true`.
- `apps/mobile/app/maestro-harness.tsx` is the hidden route used for app-owned data reset and screen teleportation.
- `apps/mobile/src/maestro/harness.ts` owns the guard, param parsing, and route resolution logic for that hidden route.
- Verified against:
  - `apps/mobile/app.config.ts`
  - `apps/mobile/eas.json`
  - `apps/mobile/app/maestro-harness.tsx`
  - `apps/mobile/src/maestro/harness.ts`

### Current artifact/log shape

- Current smoke/data-smoke runners now create:
  - `apps/mobile/artifacts/maestro/<task-id-or-ad-hoc>/<timestamp>/`
  - `runtime.env`
  - `provision.log`
  - `launch.log`
  - `teardown.log`
  - `maestro-output/`
  - `maestro-debug/`
  - `expo-start.log`
  - `simulator-system.log`
  - `maestro-junit.xml`
- Verified against:
  - `apps/mobile/scripts/maestro-ios-run-flow.sh`
  - successful runtime artifacts under `apps/mobile/artifacts/maestro/ad-hoc/20260301-191439-59787/`
  - successful runtime artifacts under `apps/mobile/artifacts/maestro/ad-hoc/20260301-191537-60914/`

### Current documentation status

- `apps/mobile/README-maestro.md` and `apps/mobile/README_HUMAN_TESTING.md` are operational runbooks and no longer hardcode stale workspace paths.
- The full Maestro runtime/testing contract remains authoritative in this document; secondary runbooks should continue linking here instead of duplicating the full policy.
- Cross-component local operator instructions live in the repo-root `RUNBOOK.md`.
- Verified against:
  - `apps/mobile/README-maestro.md`
  - `apps/mobile/README_HUMAN_TESTING.md`
  - `RUNBOOK.md`

## Locked M10 target contract

Everything in this section is normative for follow-up M10 tasks.

### 1. Runtime model

1. The primary iOS automation runtime is `Maestro + iOS Simulator + Expo development client`.
2. `Expo Go` is a verified current-state baseline only; it is not the target M10 automation runtime.
3. The user-facing runner commands remain:
   - `npm run test:e2e:ios:smoke`
   - `npm run test:e2e:ios:data-smoke`
4. Those runner commands must become thin wrappers over a shared toolkit rather than duplicating runtime orchestration logic.

### 2. Canonical config files

The per-worktree Maestro config contract is:

- checked-in sample file:
  - `apps/mobile/.maestro/maestro.env.sample`
- untracked local file:
  - `apps/mobile/.maestro/maestro.env.local`

Rules:

1. Future runtime scripts must treat `apps/mobile/.maestro/maestro.env.local` as the canonical local config file.
2. The sample file is the only checked-in example/config template.
3. Runtime scripts must fail fast when `apps/mobile/.maestro/maestro.env.local` is missing.
4. The sample file is a template, not a runnable fallback.
5. Scripts may still accept direct environment overrides, but the documented baseline is to source `maestro.env.local`.
6. The shared helper for this contract is `apps/mobile/scripts/maestro-env.sh`, which validates the local file exists and then sources the sample file first and `maestro.env.local` second.

### 3. Canonical environment terminology

Existing environment names that are already implemented remain canonical:

- `TASK_ID`
- `EXPO_DEV_SERVER_PORT`
- `MAESTRO_RESET_STRATEGY`
- `IOS_SIM_DEVICE`
- `IOS_SIM_UDID`
- `IOS_SIM_AUTO_CREATE`
- `EXPO_START_WAIT_SECONDS`

New M10-required environment names are locked as:

- `MAESTRO_IOS_SHARED_BUILD_ROOT`
  - canonical shared host-local directory for reusable development-client artifacts.
- `MAESTRO_IOS_DEV_CLIENT_APP_PATH`
  - resolved absolute path to the installed `.app` artifact used by simulator provisioning.

### 4. Shared dev-build artifact concept

The shared development-client artifact contract is:

1. The artifact is host-local and reusable across repository checkouts when explicitly configured that way.
2. The canonical shared-build root is:
   - `$HOME/.cache/boga/maestro/ios-dev-client`
3. The exact `.app` path consumed by runtime scripts is passed through `MAESTRO_IOS_DEV_CLIENT_APP_PATH`.
4. A dedicated build/reuse script owns creating or refreshing that artifact; smoke/data-smoke runners do not build native binaries directly.
5. The current default resolved `.app` path is:
   - `$HOME/.cache/boga/maestro/ios-dev-client/mobile-dev-client.app`
6. The current build metadata file is:
   - `$HOME/.cache/boga/maestro/ios-dev-client/dev-client-build.env`
7. The current build log file is:
   - `$HOME/.cache/boga/maestro/ios-dev-client/build.log`

Current implemented build method:

- `apps/mobile/scripts/maestro-ios-dev-client-build.sh` builds in a temp workspace under the shared build root.
- It runs:
  - `npx expo prebuild --platform ios --clean --npm`
  - `xcodebuild ... -destination 'generic/platform=iOS Simulator' ARCHS=<host-arch> ONLY_ACTIVE_ARCH=YES ... build` — only the host simulator slice (e.g. `arm64` on Apple Silicon) is built, not the default fat `arm64+x86_64`; the cache is host-local so the second slice is unnecessary and roughly doubles compile time.
- It then stages the resulting simulator `.app` in a PID-scoped temp dir and atomically renames it into `MAESTRO_IOS_DEV_CLIENT_APP_PATH`, so a concurrent worktree reading the shared cache never observes a partial copy.

Current rebuild invalidation rules:

- rebuild when the `.app` artifact is missing;
- rebuild when `dev-client-build.env` is missing;
- rebuild when `--force` is passed.

The cache is intentionally **not** auto-invalidated by JS, config, or dependency
changes. A native rebuild (`expo prebuild` + `pod install` + `xcodebuild`) is
expensive, and the overwhelming majority of changes — JS, pure-JS dependencies,
and config that does not alter the native project — load from the Metro bundle at
runtime and do not need one. Auto-fingerprinting every native input was evaluated
and rejected because it forces a full native rebuild on changes that don't need
it. Instead, native-cache freshness is the author's responsibility:

- **When you add, remove, or upgrade a NATIVE dependency** — any package that
  ships an iOS pod / native Expo module (for example `expo-task-manager`,
  `expo-background-task`, `expo-network`, or anything added via `npx expo install`
  that has native code), or you change a config plugin / native field in
  `app.config.ts` — you MUST force a rebuild of the shared dev client before
  running the iOS Maestro gates:

  ```bash
  ./scripts/maestro-ios-dev-client-build.sh --force
  ```

  Otherwise the gate silently reuses the previously-built `.app`, which does not
  contain the new native module, and every flow fails at boot with
  `Cannot find native module '<X>'` (a hard-to-diagnose failure that cost a full
  debug cycle on PR #101).

- Pure-JS or config-only changes need no rebuild; the cached `.app` picks them up
  from the Metro bundle.

Worktree setup note:

- The shared dev-client `.app` is host-local and byte-identical across worktrees
  with the same native inputs, so the build cache is intentionally **shared**: a
  single canonical root (`$HOME/.cache/boga/maestro/ios-dev-client`), never keyed
  by worktree slot. A freshly set-up worktree therefore reuses an already-built
  client instead of rebuilding from scratch.
- `./scripts/worktree-setup.sh` no longer writes a per-slot build root into
  `apps/mobile/.maestro/maestro.env.local`. The canonical shared root is owned by
  `apps/mobile/scripts/maestro-env.sh`, and the `.app` path is derived from it, so
  the build-write path and the cache-lookup path can never diverge. Only the
  genuinely per-worktree values — the slot-named simulator (`BOGA wt<slot>`) and
  `EXPO_DEV_SERVER_PORT` — remain in the generated env. `maestro-env.sh` also
  collapses any legacy `.../ios-dev-client/wt<slot>` root left in an older
  generated env back onto the shared root, so pre-existing worktrees converge
  without regeneration.
- Concurrent builds targeting the shared root are isolated by a PID-scoped temp
  workspace and an atomic rename of the finished `.app` into place, so a build in
  one worktree never corrupts the artifact another worktree is reading. The
  earlier per-slot default addressed the same concern at the cost of zero
  cross-worktree reuse; this replaces it without that cost.

Current host-tool prerequisites for the local shared build:

- `node`, `npm`, `npx`
- `xcrun`, `xcodebuild`
- `pod` (`CocoaPods`)
- `rsync`, `ditto`, `shasum`

Auth/log-in note:

- the implemented local shared-build path does not require Expo/EAS login;
- `eas.json` still keeps the development-client profiles explicit, including `development-simulator`, for optional manual or future EAS-based workflows.

### 5. Canonical toolkit script surface

Implemented script surface:

- `apps/mobile/scripts/maestro-ios-dev-client-build.sh`
- `apps/mobile/scripts/maestro-ios-provision.sh`
- `apps/mobile/scripts/maestro-ios-launch.sh`
- `apps/mobile/scripts/maestro-ios-teardown.sh`
- `apps/mobile/scripts/maestro-ios-smoke.sh`
- `apps/mobile/scripts/maestro-ios-data-smoke.sh`
- `apps/mobile/scripts/maestro-ios-gates.sh`
- `apps/mobile/scripts/maestro-ios-run-flow.sh`

Responsibility split:

- `maestro-ios-dev-client-build.sh`
  - builds or refreshes the shared dev-client artifact when native inputs require it.
- `maestro-ios-provision.sh`
  - resolves or creates the simulator, boots it, installs the dev client, and writes runtime state.
- `maestro-ios-launch.sh`
  - pins the lane's Supabase config into `.env.local` (see "App Supabase config isolation across lanes"), starts Expo on the configured port, deep-links the dev client, and updates runtime state.
- `maestro-ios-teardown.sh`
  - performs cleanup using the emitted runtime state, including Expo process shutdown, app termination, simulator shutdown by default, and restoring the developer's `.env.local`.
- `maestro-ios-smoke.sh` / `maestro-ios-data-smoke.sh`
  - remain the high-level scenario entrypoints and call the shared toolkit.
- `maestro-ios-gates.sh`
  - additive combined entrypoint (`npm run test:e2e:ios:gates`) that provisions/launches/warms once and runs the smoke and data-runtime-smoke flows back-to-back against that single sim + Metro, then tears down once. It composes the same provision/launch/warm/teardown helpers; it does not duplicate runtime orchestration and does not replace the standalone gates. Reset semantics are preserved: provision performs the `full` reset for smoke, and data-runtime-smoke self-resets data in-flow via its `?reset=data` harness deep links.

### 6. Runtime state and log expectations

The canonical artifact root remains:

- `apps/mobile/artifacts/maestro/<task-id-or-ad-hoc>/<timestamp>/`

M10 runtime scripts must emit:

- `runtime.env`
- `provision.log`
- `launch.log`
- `teardown.log`
- `expo-start.log`
- `simulator-system.log`
- `maestro-junit.xml`
- `maestro-output/`
- `maestro-debug/`

Minimum `runtime.env` fields:

- `TASK_ID`
- `MAESTRO_ARTIFACT_ROOT`
- `MAESTRO_RUNTIME_ENV_FILE`
- `MAESTRO_RESET_STRATEGY`
- `IOS_SIM_UDID`
- `IOS_SIM_DEVICE`
- `IOS_SIM_AUTO_CREATE`
- `EXPO_DEV_SERVER_PORT`
- `MAESTRO_IOS_DEV_CLIENT_APP_PATH`
- `MAESTRO_IOS_DEV_CLIENT_BUNDLE_ID`
- `MAESTRO_IOS_DEV_CLIENT_URL`
- `MAESTRO_FLOW_FILE`
- `MAESTRO_RUNNER_PID`
- `EXPO_PID`

Implementation note:

- the current toolkit also emits `expo-start.log` as the raw Expo process log;
- the current toolkit also emits `simulator-system.log` via `simctl log show` for post-failure native/runtime diagnostics;
- the lifecycle contract is now implemented rather than merely planned.

### 7. Parallel isolation contract

1. Cross-worktree parallel safety remains mandatory.
2. The completed implementation uses explicit per-worktree config instead of host-level arbitration.
3. Each worktree must deterministically own:
   - one Expo port,
   - one simulator selection,
   - one local config file,
   - one slot-scoped default iOS dev-client build cache,
   - one runtime state file per run.
4. If a later task reintroduces automatic arbitration, it must preserve the same cross-worktree isolation guarantees without weakening the per-worktree config contract.

### 8. Reset taxonomy

M10 locks these exact terms:

1. `full reset`
   - cold-start/install-level reset;
   - may reinstall the dev client or use `launchApp`/`clearState` when permission/onboarding/install behavior is under test;
   - current implementation: the smoke runner sets `MAESTRO_RESET_STRATEGY=full`, and `maestro-ios-provision.sh` uninstalls the dev client before reinstalling it on the simulator;
   - not the default for ordinary smoke setup.
2. `data reset`
   - clears app-owned persisted data while keeping the installed binary/runtime in place;
   - current implementation: the hidden harness route calls `resetLocalAppData()` to close the SQLite handle, delete the local database, and re-bootstrap migrations/seeds;
   - preferred when a clean app data state is needed without re-testing install semantics.
3. `teleport`
   - uses deep links or a hidden harness route to land directly in the target screen/state;
   - current implementation: flows open `boga3://maestro-harness?...` and the harness route `replace`s into the requested screen after reset work completes;
   - default setup method for routine flow positioning because it minimizes slow UI tapping.

Priority rule:

- prefer `teleport`;
- use `data reset` when state cleanup is required;
- use `full reset` only when install/permission/true cold-start behavior is part of the test objective.

### 9. Harness and deep-link contract

1. The app-level setup/navigation layer must use the existing app scheme baseline (`boga3`) rather than `Expo Go`-specific URLs.
2. The canonical hidden route is `boga3://maestro-harness`.
3. Supported harness query parameters are:
   - `reset=data` to perform app-owned persisted-data reset;
   - `fixture=exercise-block-history` to seed deterministic local SQLite history for Issue 70 recorder block-history visual QA;
   - `teleport=session-list|session-recorder|exercise-catalog|completed-session` to land on the target screen;
   - optional `mode`, `intent`, and `sessionId` when the target route needs them.
4. The route is guarded by `isDevMode() && Constants.executionEnvironment !== storeClient` (see `apps/mobile/src/utils/isDevMode.ts` — `isDevMode()` is `true` for Metro dev bundles **and** for the `com.phano.boga3.dev` build, i.e. TestFlight dev); blocked contexts render an error state instead of executing reset/setup behavior. Never reach for `__DEV__` directly — it is `false` on TestFlight, and the lint rule will reject it.
5. Harness-driven setup is preferred to visible UI tapping whenever the flow is not explicitly testing that setup UI.

## App Supabase config isolation across lanes

Every lane runs the same dev-client build; whether it behaves as a local-only
(infra-free) app or a Supabase-configured one is decided entirely by the
`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` that Metro inlines
from `apps/mobile/.env.local` at bundle time. (Which lanes take which shape, and
why, is testing policy — see `docs/specs/06-testing-strategy.md`.)

`apps/mobile/.env.local` is one per-worktree file that local-Supabase startup
(`supabase/scripts/local-runtime-up.sh`) writes, that Expo's dev server reads
**authoritatively** in dev (it overrides `process.env` and is compiled into the
served bundle), and that persists across runs — so left unmanaged, whichever lane
ran last configures the next, and a leftover auth `.env.local` silently turns a
later infra-free gate into a configured build. The launcher therefore pins each
lane's config:

1. Before `expo start`, `maestro_write_managed_env_local` (in
   `maestro-ios-runtime.sh`) sets aside any existing `.env.local`, then writes the
   lane's intended config from the `EXPO_PUBLIC_SUPABASE_*` the lane exported.
   `maestro-ios-auth-profile.sh` resolves these from `supabase status` in a
   subshell (so sourcing the backend `_common.sh` cannot clobber its
   `SCRIPT_DIR`); every infra-free lane exports none, yielding empty values.
2. `maestro-ios-teardown.sh` restores the developer's file
   (`maestro_restore_managed_env_local`) on success or failure.
3. `expo start` is passed `--clear` only when the lane's config differs from what
   Metro's transform cache was last built with, tracked per worktree in
   `apps/mobile/.maestro/.metro-supabase-signature`. Metro keys a module's
   transform on its source + babel config, not on the inlined `EXPO_PUBLIC_*`
   values, so a prior lane's `supabase.ts` transform would otherwise survive the
   `.env.local` change; clearing only on a config switch keeps the warm bundle for
   repeated same-lane runs.

Notes:

- Runtime-state keys `MAESTRO_ENV_LOCAL_PATH` and `MAESTRO_ENV_LOCAL_BACKUP` carry
  the managed paths from launch to teardown.
- The per-run backup (`.env.local.maestro-backup.*`) and the signature marker are
  gitignored; the manual dev launcher (`ios-dev-client-start.sh`) is untouched, so
  `.env.local` stays usable for `npx expo start` by hand.
- `EXPO_NO_DOTENV` / exporting empty `EXPO_PUBLIC_*` do **not** work here: in dev
  Expo loads `.env.local` over the process env, so the file is the only reliable
  lever — hence materializing the file rather than injecting env.

## Brainstorm adoption summary

Adopted from `docs/brainstorms/Maestro-Revamp`:

- shared host-local development-client artifact
- provision / launch / teardown toolkit split
- runtime state file for downstream scripts
- synthetic authoritative documentation
- `full reset` / `data reset` / `teleport` style setup taxonomy

Adjusted to fit the current codebase:

- rely on explicit per-worktree simulator/port config instead of host-level arbitration
- keep `apps/mobile/artifacts/maestro/...` as the canonical artifact root
- preserve existing runner command names and make them thin wrappers instead of replacing them
- keep currently implemented env names where they already exist rather than renaming the whole surface

Deferred to later M10 tasks:

- exact dev-client build invalidation logic
- exact simulator creation naming convention

## M10 closeout note

When M10 closes, move implementation history and milestone-specific cleanup notes out of this document and into milestone closure notes or another non-authoritative historical record. This document should remain the stable runtime/testing contract after the migration is complete.
