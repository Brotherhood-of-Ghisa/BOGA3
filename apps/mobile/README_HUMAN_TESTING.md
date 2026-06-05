# Mobile App Development Guide

This file is the human-operator entrypoint for local mobile validation.

For the authoritative Maestro runtime/testing policy, use [`docs/specs/11-maestro-runtime-and-testing-conventions.md`](../../docs/specs/11-maestro-runtime-and-testing-conventions.md). For the operational Maestro command surface, use [`apps/mobile/README-maestro.md`](./README-maestro.md).

## Run location

Run commands from `apps/mobile`.

## Prerequisites

1. Install JavaScript dependencies:

```bash
npm install
```

2. Ensure Xcode/iOS Simulator, CocoaPods, and Maestro are available:

```bash
pod --version
xcrun simctl list devices >/dev/null
maestro --version
```

3. From the repo root, initialize the checkout/worktree:

```bash
cd ../..
./scripts/worktree-setup.sh
cd apps/mobile
```

4. Edit `.maestro/maestro.env.local` before running any Maestro command if you need to override the generated simulator target.
   Prefer setting `IOS_SIM_UDID` for a manually chosen dedicated simulator.

5. Optional but recommended on a shared Mac: create a dedicated simulator for this workspace and use its UDID.

```bash
xcrun simctl create "Boga Human" \
  com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro \
  com.apple.CoreSimulator.SimRuntime.iOS-26-2
```

Notes:

- The local shared simulator dev-client build does not require Expo/EAS login.
- Expo Go is still acceptable for quick managed-only iteration, but it is not evidence for Maestro/runtime-sensitive work and it is not the M10 automation target.
- Maestro/runtime scripts fail fast if `.maestro/maestro.env.local` is missing.

## Workflow A: Normal JS/TS loop

Use this for ordinary JavaScript iteration:

```bash
npx expo start
```

For any native-runtime or Maestro-adjacent change, switch to a development client before treating the result as verified.

## Workflow B: Shared iOS simulator dev client

Use this when you need the simulator runtime that matches the Maestro toolchain.

Build or reuse the shared simulator-compatible development client:

```bash
./scripts/maestro-ios-dev-client-build.sh
```

Useful variants:

```bash
./scripts/maestro-ios-dev-client-build.sh --status
./scripts/maestro-ios-dev-client-build.sh --print-app-path
./scripts/maestro-ios-dev-client-build.sh --force
```

Contract summary:

- Shared build root: `$HOME/.cache/boga/maestro/ios-dev-client`
- Default `.app` path: `$HOME/.cache/boga/maestro/ios-dev-client/mobile-dev-client.app`
- Rebuild inputs: `app.json`, `eas.json`, `package.json`, `package-lock.json`

Manual install into the booted simulator:

```bash
open -a Simulator
xcrun simctl boot "iPhone 17 Pro" || true
xcrun simctl install booted "$(./scripts/maestro-ios-dev-client-build.sh --print-app-path)"
xcrun simctl launch booted com.dinoderek.mobile
```

After install, start Metro for the dev client with the worktree config:

```bash
npm run start:ios:dev-client
```

Normal Maestro validation does not require you to do this manual install step first. The Maestro provision step will boot the configured simulator and install the shared dev client automatically.

## Human vs agent isolation

If you are sharing the Mac with an agent or another worktree, configure this workspace so it never targets the same Metro port or simulator:

1. Pick one dedicated Metro port for this workspace.
2. Pick one dedicated simulator for this workspace.
3. Put both in `.maestro/maestro.env.local`.

Generated config uses the worktree slot for the Expo port. Recommended manual override:

```bash
TASK_ID=human-local
IOS_SIM_UDID="<your-dedicated-simulator-udid>"
```

Get a simulator UDID with:

```bash
xcrun simctl list devices available
```

Notes:

- Prefer `IOS_SIM_UDID` over `IOS_SIM_DEVICE` when sharing a machine.
- If you use `IOS_SIM_DEVICE` instead, make sure the simulator name is unique to this workspace.
- Use `npm run start:ios:dev-client` so your manual loop uses the same `EXPO_DEV_SERVER_PORT` and simulator config as Maestro.
- The sample file is only a template; runtime scripts do not fall back to it when `.maestro/maestro.env.local` is absent.
- By default teardown shuts the configured simulator down after each run. Set `MAESTRO_KEEP_SIMULATOR_BOOTED=1` only if you intentionally want the simulator left open.

## Workflow C: Maestro validation

Use these commands for the real simulator smoke lanes:

```bash
TASK_ID=ad-hoc npm run test:e2e:ios:smoke
TASK_ID=ad-hoc npm run test:e2e:ios:data-smoke
```

What they do:

- use this workspace's configured Metro port and simulator target,
- provision/install the shared dev client,
- launch Metro with `--dev-client`,
- run the Maestro flow,
- write logs and artifacts under `artifacts/maestro/<task-id-or-ad-hoc>/<timestamp>/`.

You do not need to manually start the simulator or install the app before these commands. If the configured simulator exists, the runner handles both.

Reset policy summary:

- smoke: `full reset` + `teleport`
- data-smoke: `data reset` + `teleport`

For task closeout, use the repo wrapper when the task requires the frontend slow gate:

```bash
cd ../..
./scripts/quality-slow.sh frontend
```

## Workflow D: Real iPhone dev build

Use this when you need a development client on a physical device instead of the simulator.

Local build path:

```bash
npx eas-cli login
npx eas-cli build -p ios --profile dev --local
```

Notes:

- `npx eas-cli init` is only needed if the app is not already linked to an EAS project.
- The `dev` profile builds a real-device development client; the local simulator `.app` from Workflow B cannot be installed on a phone.
- Start Metro with `npx expo start --dev-client` before opening the installed build on the phone.
- Full local build, install, LAN Metro, and local Supabase instructions live in `apps/mobile/README-LOCAL-DEV-BUILD.md`.

## Workflow E: Preview publish loop

Use this when you need a stable installable preview build plus remote updates.

One-time setup:

```bash
npx eas-cli login
npx eas-cli init
npx eas-cli update:configure
npx eas-cli channel:create preview --branch preview
```

If the `preview` channel already exists:

```bash
npx eas-cli channel:edit preview --branch preview
```

Build a preview app:

```bash
npx eas-cli build -p ios --profile preview
```

Day-to-day preview update:

```bash
npx eas-cli update --branch preview --message "ui: <short note>"
```

## Local data lane-1 canary

```bash
npm run db:generate:canary
```
