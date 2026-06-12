# Environment & Worktree Setup (Quickref)

> **Owns:** everyday worktree setup/teardown commands. **Not here:** slot/port/isolation deep contract → `12`; gates → `02`. **Load when:** creating, tearing down, or repairing a worktree environment.

How to take a git worktree from nothing to a working environment, and how to tear
it down. Load on demand (worktree lifecycle/repair). The full isolation contract —
slot model, port formulas, every flag — is the conditional deep companion
`12-worktree-config-and-isolation.md`. Gates are `02-quality-and-test-gates.md`.

This repo runs multiple agents/humans in parallel via `git worktree`; each worktree
is one isolated **slot** with its own Supabase ports + `project_id`, Expo/Metro
port, and iOS simulator. **Worktrees must live outside any other BOGA checkout —
never nested.**

## Set up a new worktree

From the main checkout:

```bash
./scripts/worktree-create.sh <branch>      # creates a non-nested worktree under ~/Projects/boga-worktrees and runs setup inside it
cd <new worktree path>
cd apps/mobile && npm install && cd ../..  # isolated deps — NOT done by setup
./supabase/scripts/local-runtime-up.sh     # boots THIS slot's local Supabase + writes apps/mobile/.env.local  (needs Docker)
./scripts/worktree-doctor.sh               # optional: verify slot / ports / config
```

`worktree-setup.sh` (run automatically by `worktree-create.sh`, idempotent if you
re-run it) assigns the slot, generates `supabase/config.toml` and
`apps/mobile/.maestro/maestro.env.local`, symlinks the shared machine config, and
installs the post-checkout hook. The first time on a machine it also seeds the
shared config tier `~/.config/boga/` via `boga-config-init.sh`; those shared files
only need real credentials for **hosted** Supabase — local dev works without them.

You rarely run any of this by hand: **the quality gates self-bootstrap** deps and
the local Supabase stack (see `02`). For iOS/Maestro, build the shared dev-client
once — `cd apps/mobile && ./scripts/maestro-ios-dev-client-build.sh` (when to
rebuild: `02`).

Machine prerequisites (once): Docker running, Node, Xcode + simulators, Maestro,
`jq`. A "command not found" / "infra unavailable" error is a bootstrap gap —
re-run `./scripts/worktree-setup.sh` and retry; it is not a missing tool.

## Tear down a worktree

```bash
./supabase/scripts/local-runtime-down.sh                              # stop THIS slot's Supabase (containers persist for fast restart)
git worktree remove --force <path>                                    # from the main checkout, once you are done with it
./scripts/worktree-clean.sh --slot <n> --supabase --remove-registry  # remove that slot's Docker stack + registry file
```

Orphans from already-deleted worktrees are reaped by `./scripts/worktree-sweep.sh`
(also run automatically before every `local-runtime-up.sh`; 600 s grace; preview
with `--dry-run`). `worktree-clean.sh` refuses the current slot without `--force`.

Never share `apps/mobile/node_modules` or one iOS simulator across worktrees.

Slot/port formulas, the completion signals the sweep uses, every flag, and the
per-script reference live in `12-worktree-config-and-isolation.md`.
