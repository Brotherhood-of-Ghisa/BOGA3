# Worktree Config and Isolation

> **Owns:** the slot-lease model, port derivation, isolation contract, and the agent-owned worktree lifecycle. **Not here:** the everyday command sequence → `01`; leftover/orphan cleanup → [`docs/procedures/worktree-cleanup.md`](../procedures/worktree-cleanup.md). **Load when:** worktree internals, slot/lease errors, cross-worktree bugs, or changing lifecycle commands.

## Purpose

Define how several agents (and humans) run on one machine via `git worktree`, each
with its own local Supabase stack, ports, Expo/Metro port, iOS simulator, and
dependency install — and who creates and destroys each of those, and when.

## Status

- Date: `2026-09-12`
- Status: agent-owned lifecycle. Replaces the automatic sweep, the post-checkout
  hook, and implicit setup (see [Removed mechanisms](#removed-mechanisms-do-not-reintroduce)).

## Design principles

1. **Explicit.** A worktree gets a slot only from `./boga worktree start`. Nothing
   allocates, repairs, or frees a slot implicitly.
2. **Fail hard.** Every command that uses per-slot resources refuses to run
   without a valid lease. It never sets one up on the fly.
3. **Owner-only teardown.** Only the agent that owns a worktree releases it. No
   script inspects another worktree and decides it is finished.
4. **GitHub is the only "done" signal.** `release` asks `gh` for the PR state.
   Git ancestry and remote-branch existence are never used — squash merges make
   them wrong in both directions.
5. **Leftovers are a human-confirmed procedure, not a background reaper.**

## Placement contract

BOGA worktrees must not be nested inside another BOGA checkout. Nested checkouts
let Node, Metro, Jest, TypeScript, and watchers walk into a parent's
`node_modules`/`tsconfig` or into sibling worktrees; the failures present as
cross-worktree flakiness, not path errors.

- `./boga worktree create` places new worktrees under `$BOGA_WORKTREE_ROOT`
  (default `~/Projects/boga-worktrees`).
- `./boga worktree start`, `./boga worktree doctor`, and every runtime entrypoint
  (Supabase helpers, Maestro helpers, `./boga test`) refuse a nested layout.
- Exempt by design: agent-harness worktrees at `<checkout>/.claude/worktrees/<name>/`
  (gitignored, no root `node_modules` to walk into). They still need a slot lease.
- One-off diagnostics only: `BOGA_ALLOW_NESTED_WORKTREE=1`.

Never work around nested placement with watcher, Jest, Metro, or TypeScript
excludes — the layout is the bug.

## Configuration tiers

| Tier | Location | Lifecycle | Contents |
| --- | --- | --- | --- |
| Machine-global | `~/.config/boga/` | Seeded once per machine by `scripts/boga-config-init.sh` (run by `start`) | Hosted Supabase credentials, optional Supabase CLI version override, shared Edge Function identity defaults, slot registry |
| Per-worktree | Gitignored files inside each worktree | Written by `./boga worktree start` | `.worktree-slot`, `supabase/config.toml`, `apps/mobile/.env.local`, `apps/mobile/.maestro/maestro.env.local` |
| Checked-in | Tracked in git | Committed | `supabase/config.toml.template`, example env files, lifecycle scripts |

```text
~/.config/boga/
  supabase/
    env.hosted
    cli.env
  edge-functions/
    env.shared
  worktrees/
    slots/
      <slot>                 # the lease: slot, project_id, path, common_git_dir, updated_at
    slot-allocation.lock/    # held only while `start` picks a slot
```

| Worktree path | Backing target | Notes |
| --- | --- | --- |
| `supabase/.env.hosted` | `~/.config/boga/supabase/env.hosted` | Hosted credentials are machine-scoped |
| `supabase/.env.local` | `~/.config/boga/supabase/cli.env` | Optional `SUPABASE_CLI_VERSION` override; the repo pin is `BOGA_SUPABASE_CLI_DEFAULT_VERSION` in `scripts/worktree-lib.sh` and versions below `BOGA_SUPABASE_CLI_MIN_VERSION` are rejected (see `RUNBOOK.md`) |
| `supabase/functions/.env.local` | `~/.config/boga/edge-functions/env.shared` | Shared local Edge Function identity defaults |
| `apps/mobile/.env.local` | Worktree-local generated file | The mobile app's Supabase config (`EXPO_PUBLIC_SUPABASE_*`), synced from `supabase status -o env` by local runtime startup. The Maestro runner pins it per lane and restores it after each run — see `docs/specs/11-maestro-runtime-and-testing-conventions.md`. |
| `apps/mobile/.maestro/maestro.env.local` | Worktree-local generated file | Expo port and slot-named simulator |

## Slot lease model

A **slot** is an integer that selects a block of host ports. Slot `0` belongs to
the main checkout (the non-linked worktree) and uses project id `BOGA`; linked
worktrees get `1..99`. Slot `100` is reserved for the dedicated dev stack.

A **lease** is two files that must agree:

- `<worktree>/.worktree-slot` contains `N`;
- `~/.config/boga/worktrees/slots/N` exists and its `path=` is this worktree's
  absolute path.

```text
slot=7
project_id=BOGA-m22-t02-wt7
path=/Users/<you>/Projects/boga-worktrees/m22-t02
common_git_dir=/Users/<you>/Projects/BOGA3/.git
updated_at=2026-09-12T10:00:00Z
```

Rules:

1. Only `./boga worktree start` creates a lease. It takes the lowest `N` whose
   registry file does not exist, under `slot-allocation.lock`.
2. Only `./boga worktree release` deletes a lease. Nothing else deletes, rewrites,
   or "repairs" another worktree's registry file.
3. Every lease-requiring command calls `boga_require_slot_lease`
   (`scripts/worktree-lib.sh`) first and exits non-zero when the lease is missing
   or names another path, printing the fix (`./boga worktree start`, or the
   cleanup procedure for a conflict).

Lease-requiring commands: `./boga test` (every gate and lane, `fast` included),
`./boga db *`, `./boga ios *`, `./boga env *`, every `supabase/scripts/*` helper
(via `_common.sh`), every Maestro script (via `maestro-env.sh`), and
`scripts/dev/dev-lan.sh` / `dev-remote.sh`. Exempt (read-only or
lifecycle): `./boga test --list`, `./boga test for`, `./boga pr *`,
`./boga docs *`, `./boga timings`, `./boga doctor`, `./boga worktree *`. CI calls
the lane scripts directly, never through `./boga`, so it needs no lease.

Port formulas:

```text
API_PORT       = 55431 + (slot * 100)
DB_PORT        = 55422 + (slot * 100)
SHADOW_PORT    = 55420 + (slot * 100)
STUDIO_PORT    = 55423 + (slot * 100)
INBUCKET_PORT  = 55424 + (slot * 100)
ANALYTICS_PORT = 55427 + (slot * 100)
POOLER_PORT    = 55429 + (slot * 100)
INSPECTOR_PORT = 8183  + (slot * 10)
EXPO_DEV_PORT  = 8082  + slot
```

Project id (Docker label `com.supabase.cli.project`, container and volume names):

```text
slot 0: BOGA
slot N: BOGA-<worktree-directory-name>-wt<N>
```

The directory name is sanitized to letters, numbers, and hyphens. The slot suffix
keeps labels unique even when two worktree directories share a name.

Isolation outcomes:

| Resource | Isolation mechanism |
| --- | --- |
| Supabase containers | Slot/worktree-specific `project_id` |
| Supabase ports | Slot-derived ports in generated `supabase/config.toml` |
| Supabase data | Separate Docker volumes per `project_id` |
| Edge Function serve state | Worktree-local `supabase/.temp` plus slot-derived API/inspector ports |
| Metro/Expo | `EXPO_DEV_SERVER_PORT` in worktree-local Maestro env |
| iOS simulator | Slot-named simulator (`BOGA wt<slot>`) or a dedicated `IOS_SIM_UDID` from worktree-local Maestro env |
| Mobile dependencies | Worktree-local `apps/mobile/node_modules`; a symlinked `node_modules` is refused by runtime guards |
| iOS dev-client build cache | Intentionally **shared**: one host-local cache at `~/.cache/boga/maestro/ios-dev-client`; rebuild with `--force` after a native change |

## Supabase config generation

The Supabase CLI needs concrete ports, so the checked-in file is
`supabase/config.toml.template` and the generated file is `supabase/config.toml`.

1. `supabase/config.toml` is gitignored.
2. Only `./boga worktree start` writes it (re-running `start` regenerates it).
3. `supabase/scripts/_common.sh` refuses to run when it is missing or older than
   the template, and tells you to re-run `./boga worktree start`.
4. Placement is checked before generation or Supabase startup.

## Dedicated dev stack (BOGA-dev)

The main checkout's slot-0 stack (`project_id BOGA`) backs the **gates**, which
truncate/reset it on every run. A human dev session must not share it, or a gate
wipes the developer's data mid-session. The **dev stack** is a second, isolated
local Supabase for that session:

| | Dev stack | Slot-0 (gate) stack |
| --- | --- | --- |
| `project_id` | `BOGA-dev` | `BOGA` |
| Ports | reserved **slot 100** via the port formula (API `65431`, DB `65422`, …) | slot 0 (`55431`, …) |
| Config + workdir | `.supabase-dev/supabase/config.toml` (gitignored), migrations/seed/functions **symlinked** to `supabase/` | `supabase/config.toml` |
| Run mechanism | `supabase --workdir .supabase-dev …` (concurrent with slot 0) | default workdir |
| Lifecycle | `boga db dev` (baseline: up + migrate + seed dev users, no reset), `boga db dev-up\|dev-down\|dev-reset` | `boga db up\|down\|reset\|baseline` |
| Used by | `dev-lan.sh` / `dev-remote.sh` (they `export BOGA_MOBILE_DEV_DB=1`) | the gates and `boga test *` |

Slot 100 is outside the leasable `0..99` range, so its ports never collide with a
worktree. The Supabase helpers in `supabase/scripts/_common.sh` follow
`BOGA_SUPABASE_WORKDIR`: setting it (via `engage_dev_stack` in
`dev-stack-lib.sh`) re-points `run_supabase`, `load_supabase_status_env`, and auth
provisioning at the dev stack. Dev scripts refuse to run unless the active
`project_id` is `BOGA-dev` (`dev_stack_assert_engaged`), and the gates never set
the var — so neither side can target the other's stack.

The dev stack has no lease. `./boga worktree ls` lists it as the dev stack, and
nothing removes it except `boga db dev-reset`. The dev scripts still require the
main checkout's slot-0 lease, like every other runtime command. This is
main-checkout-only; linked worktrees use their own slot stack for everything.

## Worktree lifecycle (agent-owned)

The owner is the agent (or human) working in the worktree. Each step is one
command, run by the owner, at a defined moment.

### 1. Open

- New worktree: `./boga worktree create <branch> [--name <dir>] [--from <ref>]`.
  It runs `git fetch origin main`, adds the worktree under the worktree root on a
  new branch from `origin/main` (or from `--from <ref>`, the explicit override),
  then runs `start` inside it.
- A worktree your harness already made (Claude desktop, Codex,
  `.claude/worktrees/`): run `./boga worktree start` inside it.

`./boga worktree start [--base <ref>]`:

1. Checks placement.
2. **No `.worktree-slot` yet (a new lease):** in a linked worktree, runs
   `git fetch origin main` and fails unless `HEAD` contains `origin/main`
   (`git merge-base --is-ancestor origin/main HEAD`), printing
   `git rebase origin/main` as the fix. `--base <ref>` checks against `<ref>`
   instead — use it only when told to branch from something else. Then takes the
   lowest free slot in `1..99`. The main checkout always takes slot `0`, with no
   base check.
3. **`.worktree-slot` already present (re-running):** keeps that slot. It
   re-creates the registry file if it is absent, and fails if another path
   holds slot `N`. It does not repeat the base check — a mid-task worktree is
   not re-based by re-running `start`.
4. Seeds `~/.config/boga/` (first run on a machine), writes
   `supabase/config.toml`, `apps/mobile/.maestro/maestro.env.local`, and the
   shared-config symlinks, then prints the slot, project id, and ports.

Gates still install `apps/mobile` dependencies when they are missing; that is
per-worktree and needs no lease logic.

### 2. Work

Gates, `boga db`, `boga ios`, Supabase scripts, and Maestro all require the
lease. The stack starts on first use (`./boga db up` or a gate that needs it).

### 3. PR opened

1. `./boga db down` — stops this slot's containers and keeps the volumes. A
   stopped stack is not restarted when Docker/OrbStack restarts.
2. `./boga pr wait` — run it in the background with your harness's facility. It
   polls the PR for the current branch via `gh` every 60 s (`--interval <s>`),
   printing nothing until it exits: `0` MERGED, `3` CLOSED without merge, `2` no
   PR for this branch, `1` `gh` error. It costs no tokens while waiting.
3. Review feedback: resume work (`./boga db up` or any gate restarts the stack),
   push, `./boga db down` again, and restart `./boga pr wait`.

### 4. Merged or closed

`./boga worktree release [--force] [--keep-worktree]`, run by the owner:

1. Asks `gh` for the PR state of the worktree's branch and refuses unless it is
   MERGED or CLOSED (`--force` overrides: no PR, open PR, or detached HEAD).
2. Removes every Docker container, volume, and network labelled
   `com.supabase.cli.project=<project_id>` (exact label from the lease). If
   Docker is unavailable it fails and keeps the lease, so the stack stays
   findable.
3. Deletes the registry file (the lease).
4. Runs `git worktree remove --force <path>` unless `--keep-worktree`. The branch
   is not deleted.

`release` refuses slot 0. For the cleanup procedure it also accepts a target:
`--slot <N>` (a lease whose owner is gone) and `--project-id <id>` (a Docker
stack with no lease).

### 5. Leftovers

Sessions die before step 4: they get archived, stopped, or the app quits. No
automatic cleanup exists, by design. `./boga worktree ls` prints every lease,
every Supabase stack in Docker, and every prunable git worktree, with each PR's
state. [`docs/procedures/worktree-cleanup.md`](../procedures/worktree-cleanup.md)
is the procedure any agent follows to clear them with the human's confirmation.

## Commands

| Command | Does | Lease needed |
| --- | --- | --- |
| `./boga worktree create <branch>` | New worktree from `origin/main` (`--from` to override), then `start` in it | — |
| `./boga worktree start` | Base check (new lease only), reserve slot, generate config | — |
| `./boga worktree ls` | Read-only: leases, Docker stacks, prunable worktrees, PR states | — |
| `./boga worktree release` | PR must be merged/closed; delete stack, lease, worktree | — |
| `./boga worktree doctor` | Read-only diagnostics: placement, lease, ports, config, symlinks, deps | — |
| `./boga db down` | Stop this slot's stack (volumes kept) | ✅ |
| `./boga pr wait` | Block until this branch's PR merges or closes | — |

Scripts behind them: `scripts/worktree-{create,start,ls,release,doctor}.sh`,
`scripts/pr-wait.sh`, and the shared library `scripts/worktree-lib.sh` (slot and
port formulas, project id, placement and lease guards; sourced, never run).

Supabase runtime helpers (unchanged, lease-checked): `supabase/scripts/local-runtime-up.sh`
(start stack, serve functions, sync `apps/mobile/.env.local`),
`ensure-local-runtime-baseline.sh` (idempotent up + migrate + seed + auth
fixtures, lock-serialized), `reset-local.sh`, `local-runtime-down.sh`.

## Removed mechanisms (do not reintroduce)

Each of these guessed, or acted on another worktree's resources, and each
misfired. The table records why, so they are not re-added.

| Removed | Why |
| --- | --- |
| `hooks/post-checkout` (auto-setup on `git worktree add`) | Allocated slots for every harness worktree, wanted or not, and hid which step created a lease |
| Implicit setup in `_common.sh`, `./boga` (`ensure_mobile_deps`), `worktree-create.sh` (main checkout), `dev-lan.sh`, `dev-remote.sh` | A missing lease was silently papered over instead of failing |
| `worktree-setup.sh` deleting registry files it judged stale | Freed live slots for reuse, so a second worktree could take a slot already in use |
| `worktree-sweep.sh`: automatic run before every stack start, merge/branch-deleted signals, grace period, dead-agent-PID reaping, orphan pass, `BOGA-dev` exemption | Squash merges never matched "HEAD in main", so merged stacks leaked. Fresh and unpushed worktrees did match "merged" or "branch deleted", so live stacks and leases were destroyed by another worktree's gate run (2026-09-10/11) |
| `worktree-clean.sh` and its per-slot runtime lock | Replaced by the owner's `release` |
| Slot exemption for `.claude/worktrees/` | One rule for every worktree; agent worktrees run the same gates |

## Harness rules

These apply equally to humans, Codex, Claude Code, and any other harness.

1. Open with `./boga worktree create`, or run `./boga worktree start` first
   thing in a harness-made worktree.
2. If placement is refused, remove that worktree and recreate it under
   `$BOGA_WORKTREE_ROOT` (or `~/Projects/boga-worktrees`).
3. Never share `apps/mobile/node_modules` or one `IOS_SIM_UDID` across worktrees.
4. Never run destructive Supabase commands (`reset-local`, stack restart) on a
   slot another suite is using.
5. Never release, stop, or delete another worktree's stack or lease, except
   through the cleanup procedure with the human's confirmation.

## Failure hypotheses for agents

1. **"No slot lease"**: run `./boga worktree start`. **"Slot N is leased to
   <other path>"**: your `.worktree-slot` is stale. Run `./boga worktree ls`; if
   the other path is a leftover, clear it with the cleanup procedure, otherwise
   delete your `.worktree-slot` and run `./boga worktree start --base HEAD` for a
   new slot (a mid-task worktree keeps its current base).
2. **Nested placement**: `./boga worktree doctor`; recreate outside the checkout.
3. **Stale Supabase config**: re-run `./boga worktree start`.
4. **Wrong Supabase runtime**: from the worktree,
   `bash -lc 'source supabase/scripts/_common.sh && run_supabase status -o env'`;
   compare ports with `./boga worktree doctor`.
5. **Port already allocated at stack start**: `./boga worktree ls` shows which
   stack holds that slot's ports; clear leftovers via the cleanup procedure.
6. **Duplicate Metro port or simulator**: check `apps/mobile/.maestro/maestro.env.local`
   (`EXPO_DEV_SERVER_PORT = 8082 + slot`, one simulator per worktree).
7. **Shared dependencies**: `apps/mobile/node_modules` must be a real directory.
8. **Docker commands hang while `orb status` says Running**: check
   `pmset -g log | grep -E "Clamshell|FullWake"`. OrbStack pauses its VM while
   the Mac sleeps (lid closed), and background agents still run in brief dark
   wakes. Keep the Mac awake for unattended runs; do not restart OrbStack.

## Verification contract

1. Main checkout: `./boga worktree start` → slot `0`, original ports, valid config.
2. Linked worktree: `./boga worktree create <branch>` → non-nested path, lowest
   free slot, lease file with this path, generated config.
3. Base check: in a worktree whose `HEAD` lacks the latest `origin/main`,
   `start` without `.worktree-slot` fails; `--base <ref>` passes.
4. Fail-hard: remove the registry file, then `./boga test fast` and
   `./supabase/scripts/local-runtime-up.sh` both exit non-zero naming the fix.
5. Parallel Supabase: two worktrees start stacks with distinct project ids and no
   port collision.
6. Release: an open-PR worktree refuses without `--force`; a merged one removes
   its containers, volumes, networks, lease, and worktree, and nothing else.
7. Placement: a nested checkout is refused before any service starts.

## Docs maintenance

Update this file, `01`, the cleanup procedure, and `AGENTS.md` rule 5 in the same
change when any of these change: slot range or port formulas, placement rules,
generated config paths, lifecycle command surfaces, lease rules, or Supabase,
Expo, Maestro, simulator, or dependency isolation behavior.
