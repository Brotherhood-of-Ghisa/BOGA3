# Mobile Scripts

This directory contains two kinds of files:

- direct entrypoints that humans or `package.json` scripts run
- internal helpers/config used by those entrypoints

## Current inventory

### Direct entrypoints

- `check-ui-guardrails.js`
  - purpose: scans `app/**/*.tsx` and `components/**/*.tsx` for raw color literals.
  - used by: `npm run lint:ui-guardrails` in `apps/mobile/package.json`.
  - status: used and needed.
- `generate-router-types.js`
  - purpose: writes `.expo/types/router.d.ts` so headless `typecheck` works without starting Expo.
  - used by: `npm run router:types`, which is part of `npm run typecheck`.
  - status: used and needed.
- `import/gymbook-digester.ts`
  - purpose: parses a GymBook XML export into the source-neutral BOGA session import JSON contract and review report.
  - used by: `npm run digest:gymbook` in `apps/mobile/package.json`.
  - status: used and needed. This script only digests/reports data; it does not write imported rows into BOGA SQLite.
- `maestro-ios-dev-client-build.sh`
  - purpose: builds or reuses the configured iOS simulator development-client `.app`.
  - used by: humans directly, `README` instructions, and `maestro-ios-provision.sh`.
  - status: used and needed.
- `ios-dev-client-start.sh`
  - purpose: starts the manual iOS dev-client loop using the worktree's configured simulator and Expo port.
  - used by: `npm run start:ios:dev-client`.
  - status: used and needed.
- `maestro-ios-smoke.sh`
  - purpose: scenario wrapper for the iOS smoke flow.
  - used by: `npm run test:e2e:ios:smoke`.
  - status: used and needed.
- `maestro-ios-data-smoke.sh`
  - purpose: scenario wrapper for the iOS data-runtime smoke flow.
  - used by: `npm run test:e2e:ios:data-smoke`.
  - status: used and needed.
- `maestro-ios-gates.sh`
  - purpose: combined runner that executes the smoke + data-runtime-smoke flows against ONE provisioned simulator and ONE Metro instance, paying the ~55-60s fixed overhead (sim boot + dev-client warm-up + Metro start + teardown) once instead of once per gate.
  - used by: `npm run test:e2e:ios:gates`.
  - status: used and needed. Additive convenience path; the standalone `maestro-ios-smoke.sh` / `maestro-ios-data-smoke.sh` gates are unchanged. Provision runs a `full` reset (the smoke precondition); the data-runtime-smoke flow self-resets data in-flow via its `?reset=data` harness deep links, so both flows are safe to run back-to-back in one session.

### Internal Maestro helpers

- `ios-sim-boot.sh`
  - purpose: resolves a simulator by `IOS_SIM_UDID` or `IOS_SIM_DEVICE`; when `IOS_SIM_AUTO_CREATE=1` (the default) and the named device is missing, it creates a slot-named simulator from the newest installed iOS runtime + a preferred iPhone device type, boots it, and waits for boot readiness. Existing/booted simulators are reused, never duplicated.
  - used by: `maestro-ios-provision.sh`.
  - status: used and needed.
- `maestro-env.sh`
  - purpose: validates `apps/mobile/.maestro/maestro.env.local`, then loads shared/local Maestro environment variables.
  - used by: all current Maestro runtime scripts.
  - status: used and needed.
- `maestro-ios-runtime.sh`
  - purpose: shared runtime helpers for artifact paths, runtime env persistence, bundle ID lookup, Metro waits, and flow rewriting.
  - used by: `maestro-ios-run-flow.sh`, `maestro-ios-provision.sh`, `maestro-ios-launch.sh`, and `maestro-ios-teardown.sh`.
  - status: used and needed.
- `maestro-ios-run-flow.sh`
  - purpose: common scenario runner that orchestrates provision, launch, Maestro execution, artifact emission, and cleanup.
  - used by: `maestro-ios-smoke.sh` and `maestro-ios-data-smoke.sh`.
  - status: used and needed.
- `maestro-ios-provision.sh`
  - purpose: ensures the shared dev client exists, boots the configured simulator, and installs the app.
  - used by: `maestro-ios-run-flow.sh`.
  - status: used and needed.
- `maestro-ios-launch.sh`
  - purpose: starts Metro on the configured port and opens the installed dev client against that Metro instance.
  - used by: `maestro-ios-run-flow.sh`.
  - status: used and needed.
- `maestro-ios-teardown.sh`
  - purpose: stops Metro, terminates the app, and shuts the configured simulator down after each run.
  - used by: `maestro-ios-run-flow.sh` via the `cleanup()` `EXIT` trap.
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

## Maestro flow ownership map

- `maestro-ios-smoke.sh` / `maestro-ios-data-smoke.sh`
  - thin scenario entrypoints
- `maestro-ios-gates.sh`
  - combined entrypoint: one provision/launch/warm/teardown shared across both flows
- `maestro-ios-run-flow.sh`
  - shared orchestration entrypoint
- `maestro-ios-provision.sh`
  - boot/install phase
- `maestro-ios-launch.sh`
  - Metro/deep-link phase
- `maestro-ios-teardown.sh`
  - cleanup phase

If you change one of these scripts, update `apps/mobile/README-maestro.md` and `docs/specs/11-maestro-runtime-and-testing-conventions.md` in the same task when the command surface or runtime contract changes.
