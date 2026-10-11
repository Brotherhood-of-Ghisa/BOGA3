# Mobile Scripts

This directory contains two kinds of files:

- direct entrypoints that humans or `package.json` scripts run
- internal helpers/config used by those entrypoints

## Current inventory

### Direct entrypoints

- `check-ui-guardrails.js`
  - purpose: scans `app/**/*.tsx` and `components/**/*.tsx` for design-token
    violations — raw color literals (zero tolerance) plus budgeted raw
    `fontSize` / spacing / `borderRadius` counts that may only fall. Budgets and
    allowlists live in `ui-guardrails.config.js`; `--update-budgets` lowers them,
    `--verbose` lists violations, `--include-allowlisted` audits the colour rule.
  - used by: `npm run lint:ui-guardrails` in `apps/mobile/package.json`, which is
    the `ui-guardrails` lane of `boga test fast` and a CI step.
  - status: used and needed.
- `generate-router-types.js`
  - purpose: writes `.expo/types/router.d.ts` so headless `typecheck` works without starting Expo.
  - used by: `npm run router:types`, which is part of `npm run typecheck`.
  - status: used and needed.
- `maestro-ios-dev-client-build.sh`
  - purpose: builds or reuses the configured iOS simulator development-client `.app`.
  - used by: humans directly, `README` instructions, and `maestro-ios-provision.sh`.
  - status: used and needed.
- `ios-dev-client-start.sh`
  - purpose: starts the manual iOS dev-client loop using the worktree's configured simulator and Expo port.
  - used by: `npm run start:ios:dev-client`.
  - status: used and needed.
- `maestro-run-lane.sh`
  - purpose: the single parameterized per-lane Maestro runner (`smoke` / `data-smoke` / `exercise-page` / `session-view` / `auth-profile` / `sync-e2e` / `groups-e2e` on iOS, `android-smoke` / `android-data-smoke` on Android). Holds each lane's data — flows, reset strategy, Supabase configuration, fixture user — and delegates to `maestro-<platform>-run-flow.sh` (one flow, own device + Metro) or `maestro-<platform>-run-flows.sh` (several flows sharing one). Canonical lane names: `scripts/lanes.tsv` (run via `./boga test ios-smoke` / `./boga test android-smoke` etc.).
  - used by: all `npm run test:e2e:{ios,android}:*` scripts except `gates`.
  - status: used and needed. Replaced the one-wrapper-per-lane scripts (`maestro-ios-smoke.sh`, `-data-smoke.sh`, `-auth-profile.sh`, `-sync-e2e.sh`).
- `maestro-android-dev-client-build.sh`
  - purpose: builds or reuses the shared Android debug dev-client APK for the android-* lanes (`expo prebuild --platform android` + Gradle `assembleDebug`), cached at `$HOME/.cache/boga/maestro/android-dev-client/mobile-dev-client.apk`; rebuild with `--force` after a native change.
  - used by: humans directly, `README-maestro.md`, and `maestro-android-provision.sh`.
  - status: used and needed.
- `maestro-ios-gates.sh`
  - purpose: the smoke + data-runtime-smoke flow list and a `full` reset, handed to `maestro-ios-run-flows.sh` so both run against ONE provisioned simulator and ONE Metro instance.
  - used by: `npm run test:e2e:ios:gates`.
  - status: used and needed. Additive convenience path; the standalone `maestro-run-lane.sh smoke` / `data-smoke` lanes are unchanged. Provision runs a `full` reset (the smoke precondition); the data-runtime-smoke flow self-resets data in-flow via its `?reset=data` harness deep links, so both flows are safe to run back-to-back in one session. The shared-session execution model itself now lives in `maestro-ios-run-flows.sh`, shared with the `ios-data-smoke` lane.

### Internal Maestro helpers

- `ios-sim-boot.sh`
  - purpose: resolves a simulator by `IOS_SIM_UDID` or `IOS_SIM_DEVICE`; when `IOS_SIM_AUTO_CREATE=1` (the default) and the named device is missing, it creates a slot-named simulator on the pinned iOS runtime + a preferred iPhone device type, boots it, and waits for boot readiness. Existing/booted simulators are reused, never duplicated — except a slot-named lane sim on another runtime, which it shuts down, deletes and recreates on the pin (one log line; the pin and the override are in `docs/specs/11-maestro-runtime-and-testing-conventions.md`). An explicit `IOS_SIM_UDID` is used as found, and a missing pinned runtime fails with the install command rather than falling back. The boot + wait run under a hard deadline (`IOS_SIM_BOOT_TIMEOUT_SECONDS`, default 120); on timeout it kills the blocked `simctl` and fails with the device state, whether Simulator.app is running, SpringBoard's status and crash reports for that device, and the remediation. Regression test: `scripts/tests/ios-sim-boot.test.sh` (`meta-tests`).
  - used by: `maestro-ios-provision.sh`, `ios-dev-client-start.sh`.
  - status: used and needed.
- `maestro-env.sh`
  - purpose: validates `apps/mobile/.maestro/maestro.env.local`, then loads shared/local Maestro environment variables.
  - used by: all current Maestro runtime scripts.
  - status: used and needed.
- `maestro-ios-runtime.sh`
  - purpose: iOS-only runtime helpers (simulator control, native permission/scheme pre-authorization, dev-menu seeding, simulator/crash log capture). Sources the shared `maestro-runtime.sh` and defines the iOS runtime-state key set.
  - used by: `maestro-ios-run-flow.sh`, `maestro-ios-run-flows.sh`, `maestro-ios-provision.sh`, `maestro-ios-launch.sh`, and `maestro-ios-teardown.sh`.
  - status: used and needed.
- `maestro-runtime.sh`
  - purpose: platform-neutral Maestro helpers shared by both toolkits — artifact paths, runtime-state persistence, Metro probing/waits, process waits, flow-copy rewriting, the dev-client URL, and the managed `.env.local` pin/restore.
  - used by: `maestro-ios-runtime.sh` and `maestro-android-runtime.sh` (every runtime entrypoint transitively).
  - status: used and needed.
- `maestro-android-runtime.sh`
  - purpose: Android-only runtime helpers — SDK/adb checks, AVD discovery/creation (cloned from a template AVD; no `avdmanager` needed), boot-complete wait, app-id resolution, logcat capture, force-stop. Sources `maestro-runtime.sh` and defines the Android runtime-state key set.
  - used by: `maestro-android-run-flow.sh`, `maestro-android-run-flows.sh`, `maestro-android-provision.sh`, `maestro-android-launch.sh`, and `maestro-android-teardown.sh`.
  - status: used and needed.
- `maestro-android-run-flow.sh`
  - purpose: the Android counterpart of `maestro-ios-run-flow.sh` — provision (boot emulator + install APK), launch (Metro + dev client), run one flow via `maestro test --device`, emit artifacts, tear down.
  - used by: `maestro-run-lane.sh` android arms.
  - status: used and needed.
- `maestro-android-run-flows.sh`
  - purpose: the Android counterpart of `maestro-ios-run-flows.sh` — several flows against ONE provisioned emulator + Metro.
  - used by: `maestro-run-lane.sh android-data-smoke`.
  - status: used and needed.
- `maestro-android-provision.sh`
  - purpose: ensures the shared APK exists, boots the lane AVD (or uses `ANDROID_SERIAL`), installs the app, and records runtime state.
  - used by: the Android run-flow/run-flows runners.
  - status: used and needed.
- `maestro-android-launch.sh`
  - purpose: `adb reverse`s Metro and the local Supabase API, starts Metro, opens the installed dev client against it, and blocks until Metro serves the app-entry bundle.
  - used by: the Android run-flow/run-flows runners.
  - status: used and needed.
- `maestro-android-teardown.sh`
  - purpose: stops Metro, restores the developer's `.env.local`, force-stops the app, and shuts down a lane emulator this run started.
  - used by: the Android run-flow/run-flows runners via the `cleanup()` `EXIT` trap.
  - status: used and needed.
- `maestro-ios-run-flow.sh`
  - purpose: common scenario runner that orchestrates provision, launch, Maestro execution, artifact emission, and cleanup for ONE flow.
  - used by: `maestro-run-lane.sh`.
  - status: used and needed.
- `maestro-ios-run-flows.sh`
  - purpose: the same lifecycle for SEVERAL flows sharing one provisioned simulator + Metro, so the ~55-60s provision/launch/teardown overhead is paid once instead of per flow. Per-flow JUnit/output/debug are namespaced; every flow runs even after one fails, and any failure fails the run. The caller owns `MAESTRO_RESET_STRATEGY`.
  - used by: `maestro-ios-gates.sh`, and `maestro-run-lane.sh data-smoke`.
  - status: used and needed. Only for flows that reset their own state in-flow (`?reset=data`); a flow testing cold install / permissions wants its own `full`-reset run through the singular runner.
- `maestro-ios-provision.sh`
  - purpose: ensures the shared dev client exists, boots the configured simulator, and installs the app.
  - used by: `maestro-ios-run-flow.sh` and `maestro-ios-run-flows.sh`.
  - status: used and needed.
- `maestro-ios-launch.sh`
  - purpose: starts Metro on the configured port and opens the installed dev client against that Metro instance.
  - used by: `maestro-ios-run-flow.sh` and `maestro-ios-run-flows.sh`.
  - status: used and needed.
- `maestro-ios-teardown.sh`
  - purpose: stops Metro, terminates the app, and shuts the configured simulator down after each run.
  - used by: `maestro-ios-run-flow.sh` and `maestro-ios-run-flows.sh` via the `cleanup()` `EXIT` trap.
  - status: used and needed.
  - note: this is not a top-level `package.json` command; it is invoked indirectly on both success and failure paths.

### Companion config

- `ui-guardrails.config.js`
  - purpose: allowlist/config for `check-ui-guardrails.js`.
  - used by: `check-ui-guardrails.js`.
  - status: used and needed.

## Keep/remove verdict

Current verdict after repository call-graph review:

- keep all files in this directory.
- no remaining script here appears unused.
- the previously removed `maestro-ios-slot-lock.sh` was obsolete after the move to explicit per-worktree config and has already been deleted.
- the per-lane wrappers (`maestro-ios-smoke.sh`, `-data-smoke.sh`, `-auth-profile.sh`, `-sync-e2e.sh`) were collapsed into `maestro-run-lane.sh`; the human release-tagging scripts (`tag-dev-ios.sh`, `tag-preview-ios.sh`) moved to `scripts/dev/` at the repo root.

## Maestro flow ownership map

- `maestro-run-lane.sh`
  - per-lane scenario entrypoint (lane data lives here)
- `maestro-ios-gates.sh`
  - combined entrypoint: the smoke + data-smoke flow list for the shared-session runner
- `maestro-ios-run-flows.sh`
  - shared-session orchestration entrypoint: one provision/launch/warm/teardown across N flows
- `maestro-ios-run-flow.sh`
  - shared orchestration entrypoint
- `maestro-ios-provision.sh`
  - boot/install phase
- `maestro-ios-launch.sh`
  - Metro/deep-link phase
- `maestro-ios-teardown.sh`
  - cleanup phase
- `maestro-android-run-flows.sh` / `maestro-android-run-flow.sh`
  - Android shared-session / single-flow orchestration entrypoints
- `maestro-android-provision.sh`
  - Android boot/install phase (AVD boot, APK install)
- `maestro-android-launch.sh`
  - Android Metro/`adb reverse`/deep-link phase
- `maestro-android-teardown.sh`
  - Android cleanup phase

This file owns the script inventory. If you change the command surface, update `apps/mobile/README-maestro.md` in the same task; update `docs/specs/11-maestro-runtime-and-testing-conventions.md` only when the runtime *contract* changes.
