# Environment & Worktree Setup (Quickref)

> **Owns:** the everyday worktree lifecycle commands. **Not here:** slot-lease/port/isolation contract → `12`; leftover cleanup → [`docs/procedures/worktree-cleanup.md`](../procedures/worktree-cleanup.md); gates → `02`. **Load when:** opening, finishing, or repairing a worktree.

This repo runs several agents and humans in parallel via `git worktree`. Each
worktree holds one **slot lease**: its own Supabase ports and `project_id`,
Expo/Metro port, and iOS simulator. The agent that opens a worktree owns it until
its PR merges. **Worktrees must live outside any other BOGA checkout — never
nested.**

## Lifecycle (every worktree, every agent)

```bash
# 1. Open: a new worktree branched from the latest origin/main
./boga worktree create <branch>
#    …or, inside a worktree your harness already created
./boga worktree start

# 2. Work: every ./boga test|db|ios command fails hard without the lease
./boga test fast

# 3. PR opened: stop the stack, then wait for the PR in the background
./boga db down
./boga pr wait                # exits 0 merged, 3 closed, 2 no PR

# 4. Merged or closed: delete stack + lease + worktree
./boga worktree release
```

- `start` fails unless the worktree contains the latest `origin/main`; the fix it
  prints is `git rebase origin/main`. Pass `--base <ref>` (or `create --from <ref>`)
  only when told to branch from something else. Re-running `start` keeps the slot
  and regenerates config.
- Review feedback after step 3: work again (any gate restarts the stack), push,
  `./boga db down`, restart `./boga pr wait`.
- `release` refuses an open PR unless `--force`; `--keep-worktree` keeps the
  checkout.
- A session that died before step 4 leaves leftovers. `./boga worktree ls` shows
  them; clear them with [`docs/procedures/worktree-cleanup.md`](../procedures/worktree-cleanup.md).

## Machine prerequisites (once)

Docker running, Node, Xcode + simulators, Maestro, `jq`, and an authenticated
`gh`. `./boga doctor` checks them; a FAIL is a bootstrap gap to fix, not a skip.
The repo pins the Supabase CLI (`BOGA_SUPABASE_CLI_DEFAULT_VERSION` in
`scripts/worktree-lib.sh`); do not pin an older `SUPABASE_CLI_VERSION` in
`~/.config/boga/supabase/cli.env`. CLIs below `BOGA_SUPABASE_CLI_MIN_VERSION`
need `deno.land` at every edge-runtime start and fail `supabase start` with
`Error status 502` when it is unreachable (details: `RUNBOOK.md`).

The shared config tier `~/.config/boga/` is seeded by the first `start` on a
machine; its files need real credentials only for **hosted** Supabase.

## Dependencies and the iOS dev client

Gates install `apps/mobile` dependencies when they are missing (isolated per
worktree — never symlink or share `node_modules`). For iOS/Maestro, build the
shared dev client once: `./boga ios build-client` (when to rebuild: `02`).

Slot and port formulas, lease rules, every flag, and the removed mechanisms live
in `12-worktree-config-and-isolation.md`.
