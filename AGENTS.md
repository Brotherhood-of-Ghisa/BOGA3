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

## Brainstorms Folder Rule

- `docs/brainstorms/` contains brainstorming documents only.
- These files are non-authoritative working notes, not source-of-truth product or technical specs.
- Ignore `docs/brainstorms/**` unless the user explicitly references a brainstorm file or asks for brainstorming/ideation work in that folder.
