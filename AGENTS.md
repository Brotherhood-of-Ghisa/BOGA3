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
- **Added a NATIVE dependency? Force-rebuild the iOS dev client before the gates.** There is ONE shared Maestro dev-client `.app`, cached at a single host-local location (`$HOME/.cache/boga/maestro/ios-dev-client`, NOT keyed by worktree slot) and reused by EVERY worktree on the machine — so a freshly set-up worktree boots the already-built client instead of rebuilding from scratch. The cache is **trusted on existence**; it is NOT auto-invalidated when dependencies change (auto-fingerprinting was evaluated and rejected — see `docs/specs/11-maestro-runtime-and-testing-conventions.md`). So if your task adds, removes, or upgrades a **native** dependency (anything that ships an iOS pod / native Expo module — e.g. `expo-task-manager`, `expo-background-task`, `expo-network`, or anything from `npx expo install` with native code), or changes a config plugin / native field in `apps/mobile/app.config.ts`, you MUST rebuild it first: `cd apps/mobile && ./scripts/maestro-ios-dev-client-build.sh --force`. Skip this and every worktree's gate reuses the stale binary, which lacks the new native module, and every flow fails at boot with `Cannot find native module '<X>'`. Pure-JS / config-only changes need no rebuild (Metro bundles them at runtime). See `apps/mobile/README-maestro.md`.

## Testing is not optional — never ship or accept an untested excuse

- **You have ALL of this repo's local infrastructure: the database (Supabase, via `npx`), the e2e/UI runner (Maestro), and the iOS simulators.** Every test and gate your change touches is runnable in your worktree.
- **Run them to GREEN before declaring a PR done** — the quality gate, the unit/integration suites, AND the local e2e/UI lanes your change exercises. For a signed-in UI change that means `npm run test:e2e:ios:gates` AND the auth-profile lane (`npm run test:e2e:ios:auth-profile`), not just the infra-free smoke/data-smoke.
- **A test that "won't run" is a bootstrap gap, not an unavailable tool.** Run `npm install` + `./scripts/worktree-setup.sh` and retry. "command not found" / "infra unavailable" is never, by itself, a reason to skip a runnable test.
- **NEVER ship — and reviewers must NEVER approve — a PR that skips a locally-runnable test with an excuse.** Put the evidenced green run (output/log) in the PR.
- **`test:sync:infra` is LOCAL and MANDATORY — it is NOT a deferrable "remote-only" lane.** The lane reads `SUPABASE_BRANCH_URL` / `SUPABASE_BRANCH_ANON_KEY`, but those merely name *an* endpoint carrying the sync schema + the `user_a` fixture — and **this worktree's own slot-isolated local Supabase is exactly such an endpoint.** Each worktree gets a *dedicated* local stack (per-slot ports + a unique `project_id`, generated by `./scripts/worktree-setup.sh` — see `docs/specs/12`), so agents NEVER share a stack and never need to serialize for data-isolation reasons. To run it: `./supabase/scripts/ensure-local-runtime-baseline.sh` (boots + migrates this worktree's stack and provisions `user_a`), then `eval "$(cd supabase && <pinned supabase> status -o env)"` and `export SUPABASE_BRANCH_URL="$API_URL" SUPABASE_BRANCH_ANON_KEY="$ANON_KEY"`, then `cd apps/mobile && npm run test:sync:infra`. It is far lighter than the iOS lanes (no simulator / Metro). There is **no** acceptable local deferral. (The former `test:sync:reinstall-parity` lane was retired — its v1 target suite was deleted in the sync v1 retirement; reinstall restore-parity is now covered by the v2 `test:sync:infra` cycle round-trip plus the backend `sync-v2-*` contract suites.)
- **Host-capacity caveat for parallel agents.** Worktree *stacks* are isolated, but the *host* is not infinite: running several iOS-Maestro + Supabase slow-gate runs at once (multiple booted simulators + multiple Docker Supabase stacks) overloads one machine and produces XCTest-driver flakes and port collisions — and an orphaned Supabase stack from a deleted worktree can squat a slot's Docker ports until reaped (`./scripts/worktree-sweep.sh` / `./supabase/scripts/local-runtime-down.sh`). Run the heavy slow gates **serially** (one full slow-gate run at a time), and reap orphaned stacks before a run, so green evidence is real and not a load artifact.
  - Two known concurrency hazards to fix/avoid: (1) some backend contract scripts (e.g. `supabase/tests/sync-pull-contract.sh`) pick the Postgres container with an UNSCOPED `docker ps | grep '^supabase_db_' | head -n1`, so with several stacks up they target the WRONG worktree's DB and fail spuriously — they must scope by this worktree's `project_id`; until that lands, run backend lanes serially. (2) `git stash` operates on the shared `.git` across all worktrees — a `stash pop` in one worktree can grab another's stash. Do NOT use `git stash` in a worktree while other agents run; commit to your branch instead.

## Multi-agent orchestration: slow-gate checkpoint tasks (this repo)

CI runs only the FAST gate (lint + typecheck + jest). The SLOW gates — the iOS
Maestro lanes (`test:e2e:ios:gates` = smoke + data-smoke, and
`test:e2e:ios:auth-profile` = signed-in) and the infra lanes (`test:sync:infra`)
— are NOT in CI, so breakage accumulates on the integration branch invisibly: a
PR passes its fast gate against its own base, yet the *merged* `main` is red on a
slow lane that nobody ran. ("data-only / no UI files changed" does NOT mean "no
e2e impact" — any boot / sync / auth behaviour change is exercised by the e2e
lanes.) **Every multi-agent plan for this repo MUST therefore include slow-gate
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
