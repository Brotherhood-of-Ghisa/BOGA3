# AGENTS.md

## Purpose

This file is the session entrypoint.
It defines what to load first and where detailed rules live.

## Always Load (All Session Types)

- `docs/specs/README.md`
- `docs/specs/00-product.md`
- `docs/specs/03-technical-architecture.md`
- `docs/specs/05-data-model.md`
- `docs/specs/04-ai-development-playbook.md`
- `docs/specs/06-testing-strategy.md`
- `docs/specs/09-project-structure.md`
- `docs/specs/12-worktree-config-and-isolation.md` (required for local worktree/runtime setup and cross-worktree issue diagnosis)
- `docs/specs/08-ux-delivery-standard.md` (required for UI tasks)
- `docs/specs/ui/README.md` (required for UI tasks; load relevant bundle docs from there)

Note: product/domain details are maintained in specs. Do not duplicate them here.

## Agent environment: all tools are available — bootstrap first

- **You (and the coordinator) have access to ALL tools this repo uses.** There is no per-agent allowlist hiding `supabase`, `maestro`, `xcrun`, `tsx`, `drizzle-kit`, etc.
- **A "command not found" / "tool missing" error almost always means the worktree is not bootstrapped — not that the tool is unavailable.** Before concluding a tool is missing, run the bootstrap: `npm install` at the repo root and/or in `apps/mobile/`, then `./scripts/worktree-setup.sh` from the repo root.
- Most CLIs (`supabase`, `drizzle-kit`, `tsx`, `maestro`, …) are local dev-dependencies, not global installs. Invoke them the way the repo's `package.json` scripts do — `npm run …`, `npx …`, or `./node_modules/.bin/…` — rather than expecting a bare global binary.
- **iOS smoke gates self-heal a missing simulator.** `npm run test:e2e:ios:smoke` and `test:e2e:ios:data-smoke` default to `IOS_SIM_AUTO_CREATE=1`: if the worktree's slot-named simulator (e.g. `BOGA wt<slot>`) does not exist yet, the gate auto-creates and boots it (newest installed iOS runtime + a preferred iPhone device type) and proceeds — you do not need to manually provision a sim. If it still fails, run `./scripts/worktree-setup.sh` and retry. To run both gates in a single sim + Metro session (≈28% faster than running them separately), use `npm run test:e2e:ios:gates`.
- **The auth + sync E2E lanes self-bootstrap a LOCAL Supabase — a missing `supabase` global is EXPECTED, not a blocker.** `npm run test:e2e:ios:auth-profile` (and the sync infra scripts) call `supabase/scripts/ensure-local-runtime-baseline.sh`, which runs the CLI via `npx -y supabase@<version>` and **reuses any already-running local stack**. So `which supabase` returning nothing is normal and is NOT a reason to skip the auth-profile / signed-in lanes — run them. (Docker must be running for the local stack; the baseline serialises concurrent runs on a lock.)
- **Added a NATIVE dependency? Force-rebuild the iOS dev client before the gates.** The shared Maestro dev-client `.app` is cached on existence only — it is NOT auto-invalidated when dependencies change. If your task adds, removes, or upgrades a **native** dependency (anything that ships an iOS pod / native Expo module — e.g. `expo-task-manager`, `expo-background-task`, `expo-network`, or anything from `npx expo install` with native code), or changes a config plugin / native field in `apps/mobile/app.config.ts`, you MUST rebuild it first: `cd apps/mobile && ./scripts/maestro-ios-dev-client-build.sh --force`. Skip this and the gate reuses the stale binary, which lacks the new native module, and every flow fails at boot with `Cannot find native module '<X>'`. Pure-JS / config-only changes need no rebuild (Metro bundles them at runtime). See `apps/mobile/README-maestro.md`.

## Testing — the rules live in `docs/specs/06-testing-strategy.md` (read it when you change code)

**If you are changing code, you MUST read `docs/specs/06-testing-strategy.md` and follow it.** It is the single source of truth for testing — the no-untested-excuses rule, the per-change slow-gate triggers, and the lane model — and is deliberately NOT restated here (so it cannot drift). The non-negotiable essence: run every locally-runnable test/gate to green (a tool that "won't run" means *bootstrap*, not *unavailable*), and **match the gate to the change** — any UX or device/runtime-behaviour change MUST run the slow FRONTEND (Maestro) gates; any backend/infra change MUST run the slow BACKEND (Supabase) gates; the fast lane alone never suffices for a behaviour or contract change. See the spec for the full rules and the cloud-lane deferral exception.

## Multi-agent orchestration: slow-gate checkpoint tasks (this repo)

CI runs only the FAST gate (lint + typecheck + jest). The SLOW gates — the iOS
Maestro lanes (`test:e2e:ios:gates` = smoke + data-smoke, and
`test:e2e:ios:auth-profile` = signed-in) and the infra lanes (`test:sync:infra`)
— are NOT in CI, so breakage accumulates on the integration branch invisibly: a
PR passes its fast gate against its own base, yet the *merged* `main` is red on a
slow lane that nobody ran. ("data-only / no UI files changed" does NOT mean "no
e2e impact" — any boot / sync / auth behaviour change is exercised by the e2e
lanes; see the per-change slow-gate triggers in `docs/specs/06-testing-strategy.md`.)
**Every multi-agent plan for this repo MUST therefore include slow-gate
checkpoint tasks:**

- **Cadence.** Insert a checkpoint after each wave/batch of merges (rule of
  thumb: at least every ~3–4 build merges), after ANY behaviour-changing merge
  that skipped the slow lanes, and a MANDATORY one immediately before the final
  test card (`tFINAL`). The planner adds these to the DAG; the coordinator may
  insert ad-hoc ones when behaviour-changing PRs land.
- **What it does.** Runs the slow gates (`test:e2e:ios:gates` +
  `test:e2e:ios:auth-profile`, plus `test:sync:infra` where relevant) against the
  CURRENT integration branch (`origin/main` — the merged result, NOT a feature
  branch). If red, it FIXES the breakage and opens a PR; if the breakage is a
  half-landed feature that needs another planned task to land, it SURFACES that to
  the coordinator rather than patching around it.
- **Who runs it.** A dedicated checkpoint task. These lanes are long-running and
  in-turn background sub-agents get killed at turn boundaries, so run them as a
  **spawned task / dedicated session** (or have the human run them) — NOT an
  in-turn background sub-agent. Give each Maestro flow a hard per-flow timeout so
  a hang fails fast and legibly (a "timeout", not an ambiguous "slow run").
- **Blocking.** A checkpoint is a DAG barrier: no further feature merges land
  while the integration branch's slow gates are red — don't pile changes onto a
  red `main`.
- **Avoid the half-feature trap.** Order interdependent PRs so the integration
  branch is never left in a user-broken intermediate state — land a gate/UI
  together with the backend behaviour it guards, or feature-flag the incomplete
  behaviour behind `isDevMode()` / a flag so `main` stays runnable mid-plan.

## Brainstorms Folder Rule

- `docs/brainstorms/` contains brainstorming documents only.
- These files are non-authoritative working notes, not source-of-truth product or technical specs.
- Ignore `docs/brainstorms/**` unless the user explicitly references a brainstorm file or asks for brainstorming/ideation work in that folder.
