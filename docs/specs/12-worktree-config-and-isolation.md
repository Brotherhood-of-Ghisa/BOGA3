# Worktree Config and Isolation

> **Owns:** the slot-lease model, port derivation, and the per-worktree isolation contract. **Not here:** the everyday command sequence → `01`; leftover/orphan cleanup → [`docs/procedures/worktree-cleanup.md`](../procedures/worktree-cleanup.md). **Load when:** debugging worktree internals, slot/lease errors or cross-worktree bugs, or changing a lifecycle command. Change a rule here and `01`, `AGENTS.md` rule 5, and the cleanup procedure change in the same PR.

Several agents and humans run on one machine via `git worktree`. Each worktree
holds one slot lease, which gives it its own local Supabase stack and ports,
Expo/Metro port, iOS simulator, and dependency install.

## Design principles

1. **Explicit.** Only `./boga worktree start` allocates a slot. Nothing
   allocates, repairs, or frees one implicitly.
2. **Fail hard.** A command that uses per-slot resources refuses to run without
   a valid lease; it never sets one up on the fly.
3. **Owner-only teardown.** Only the agent that owns a worktree releases it. No
   script inspects another worktree and decides it is finished.
4. **GitHub is the only "done" signal.** `release` asks `gh` for the PR state;
   git ancestry and remote-branch existence are never used, because squash
   merges make them wrong in both directions.
5. **Leftovers are a human-confirmed procedure, not a background reaper.**

## Placement contract

BOGA worktrees must not be nested inside another BOGA checkout: Node, Metro,
Jest, TypeScript, and watchers walk into the parent's `node_modules`/`tsconfig`
or into sibling worktrees, and the failures present as cross-worktree
flakiness, not path errors. Never work around nested placement with watcher,
Jest, Metro, or TypeScript excludes — the layout is the bug.

- `./boga worktree create` places new worktrees under `$BOGA_WORKTREE_ROOT`
  (default `~/Projects/boga-worktrees`).
- `start`, `doctor`, and every runtime entrypoint (Supabase helpers, Maestro
  helpers, `./boga test`) refuse a nested layout, checked before config
  generation or any service start.
- Exempt by design: agent-harness worktrees at
  `<checkout>/.claude/worktrees/<name>/` (gitignored, no root `node_modules` to
  walk into). They still need a lease.
- One-off diagnostics only: `BOGA_ALLOW_NESTED_WORKTREE=1`.

## Configuration tiers

| Tier | Where | Written by |
| --- | --- | --- |
| Machine-global | `~/.config/boga/` (below) | seeded once per machine by `scripts/boga-config-init.sh`, run by `start` |
| Per-worktree, gitignored | `.worktree-slot`, `supabase/config.toml`, `apps/mobile/.maestro/maestro.env.local`, `apps/mobile/.env.local` | `./boga worktree start`, except `.env.local` (runtime) |
| Checked-in | `supabase/config.toml.template`, example env files, lifecycle scripts | committed |

```text
~/.config/boga/
  supabase/env.hosted              # hosted Supabase credentials
  supabase/cli.env                 # optional SUPABASE_CLI_VERSION override (RUNBOOK.md)
  edge-functions/env.shared        # shared local Edge Function identity defaults
  worktrees/slots/<slot>           # the lease: slot, project_id, path, common_git_dir, updated_at
  worktrees/slot-allocation.lock/  # held only while `start` picks a slot
  timings/records/                 # one JSON per ./boga test lane run (scripts/lane-timing.sh)
  sweep/<utc>/                     # ./boga sweep per-lane logs + summary.txt
```

`start` symlinks each machine-global file into the worktree
(`supabase/.env.hosted`, `supabase/.env.local`,
`supabase/functions/.env.local`), so credentials and the CLI pin are
machine-scoped, never per-worktree. `apps/mobile/.env.local` is the exception:
it is generated per worktree from `supabase status -o env` by local runtime
startup, and the Maestro runner pins it per lane and restores it after each run
(`docs/specs/11-maestro-runtime-and-testing-conventions.md`).

## Slot lease model

A **slot** is an integer that selects a block of host ports. Slot `0` is the
main checkout (the non-linked worktree, project id `BOGA`); linked worktrees
get `1..99`; slot `100` is reserved for the dev stack.

A **lease** is two files that must agree: `<worktree>/.worktree-slot` contains
`N`, and `~/.config/boga/worktrees/slots/N` exists with a `path=` equal to this
worktree's absolute path.

1. Only `./boga worktree start` creates a lease, taking the lowest `N` with no
   registry file, under `slot-allocation.lock`.
2. Only `./boga worktree release` deletes one. Nothing else deletes, rewrites,
   or "repairs" another worktree's registry file.
3. Every lease-requiring command calls `boga_require_slot_lease`
   (`scripts/worktree-lib.sh`) first and exits non-zero when the lease is
   missing or names another path, printing the fix.

Lease-requiring: `./boga test` (every gate and lane, `fast` included),
`./boga db *`, `./boga ios *`, `./boga env *`, every `supabase/scripts/*`
helper (via `_common.sh`), every Maestro script (via `maestro-env.sh`), and
`scripts/dev/dev-lan.sh` / `dev-remote.sh`. Exempt (read-only or lifecycle):
`./boga test --list`, `./boga test for`, `./boga pr *`, `./boga docs *`,
`./boga timings`, `./boga doctor`, `./boga worktree *`. CI calls the lane
scripts directly, never through `./boga`, so it needs no lease.

### Ports and project id

`boga_port_for_slot` (`scripts/worktree-lib.sh`) derives every port from the
slot:

```text
api 55431   db 55422    shadow 55420   studio 55423
inbucket 55424   analytics 55427   pooler 55429      + (slot * 100)
inspector 8183 + (slot * 10)        expo 8082 + slot
```

The project id (Docker label `com.supabase.cli.project`, container and volume
names) is `BOGA` for slot 0 and `BOGA-<worktree-directory-name>-wt<N>`
otherwise, the directory name sanitized to letters, numbers, and hyphens. The
`-wt<N>` suffix keeps labels unique when two worktree directories share a name.

The Supabase CLI caps `project_id` at 40 characters and **silently truncates** a
longer one — dropping the `-wt<N>` suffix, so two worktrees collapse into one
Docker project. `boga_project_id_for_name` therefore shortens an over-long id
in the middle, never at the tail:

```text
slot N, long name: BOGA-<name cut to fit>-<crc32 of full name, 8 hex>-wt<N>
e.g. slot 3, exercise-session-redesign-f34616 -> BOGA-exercise-session-redes-cfeeb0d1-wt3
```

It is deterministic (POSIX `cksum`, so macOS and CI Linux agree) and leaves an
id that already fits unchanged. A `config.toml` written before the cap still
holds an over-long id: `doctor` fails on it, `start` rewrites it and names the
old Docker label, and that old stack is then an unleased stack for the
[cleanup procedure](../procedures/worktree-cleanup.md).
`resolve_worktree_container` (`supabase/scripts/_containers.sh`) accepts the
CLI-truncated form of such an id only when it publishes this slot's port.

### Isolation outcomes

| Resource | Isolation mechanism |
| --- | --- |
| Supabase containers and data | per-`project_id` containers and Docker volumes |
| Supabase ports | slot-derived ports in the generated `supabase/config.toml` |
| Edge Function serve state | worktree-local `supabase/.temp` plus slot-derived API/inspector ports |
| Metro/Expo | `EXPO_DEV_SERVER_PORT` in the worktree-local Maestro env |
| iOS simulator | slot-named simulator (`BOGA wt<slot>`) or an explicit `IOS_SIM_UDID` |
| Mobile dependencies | worktree-local `apps/mobile/node_modules`; a symlinked one is refused by runtime guards |
| iOS dev-client build cache | intentionally **shared**: one host-local cache at `~/.cache/boga/maestro/ios-dev-client`; rebuild with `--force` after a native change |

### Generated Supabase config

The CLI needs concrete ports, so `supabase/config.toml.template` is checked in
and `supabase/config.toml` is generated and gitignored. Only
`./boga worktree start` writes it (re-running regenerates it), and
`supabase/scripts/_common.sh` refuses to run when it is missing or older than
the template, naming `./boga worktree start` as the fix.

## Dedicated dev stack (BOGA-dev)

The main checkout's slot-0 stack backs the **gates**, which truncate/reset it on
every run. A human dev session must not share it, or a gate wipes the
developer's data mid-session. The dev stack is a second, isolated local
Supabase for that session:

| | Dev stack | Slot-0 (gate) stack |
| --- | --- | --- |
| `project_id`, ports | `BOGA-dev`, reserved **slot 100** (API `65431`, DB `65422`, …) | `BOGA`, slot 0 (`55431`, …) |
| Config, workdir | `.supabase-dev/supabase/config.toml` (gitignored), migrations/seed/functions **symlinked** to `supabase/`; run as `supabase --workdir .supabase-dev …`, concurrent with slot 0 | `supabase/config.toml`, default workdir |
| Lifecycle | `boga db dev` (baseline: up, migrate, eval kick, seed, activate groups; no reset), `boga db dev-up\|dev-down\|dev-reset` | `boga db up\|down\|reset\|baseline` |
| Used by | main-checkout `dev-lan.sh` / `dev-remote.sh` (`BOGA_MOBILE_DEV_DB=1`) | the gates and `boga test *` |

Slot 100 is outside the leasable `0..99` range, so its ports never collide with
a worktree. The Supabase helpers follow `BOGA_SUPABASE_WORKDIR`: setting it (via
`engage_dev_stack` in `supabase/scripts/dev-stack-lib.sh`) re-points
`run_supabase`, `load_supabase_status_env`, and auth provisioning at the dev
stack. Dev scripts refuse to run unless the active `project_id` is `BOGA-dev`
(`dev_stack_assert_engaged`), and the gates never set the var — so neither side
can target the other's stack.

The dev stack has no lease. `./boga worktree ls` lists it as the dev stack, and
nothing removes it except `boga db dev-reset`. It is **main-checkout-only**: its
starter owns the Edge runtime's `functions/` mount, so `engage_dev_stack`
refuses in a linked worktree; launchers there use the slot stack
(`ensure-dev-baseline.sh --slot-stack`).

## Lifecycle mechanism

The owner is the agent (or human) working in the worktree. The step sequence is
`AGENTS.md` rule 5 and `01`; every flag is in `./boga worktree <sub> --help`.
What each command does to the lease and the stack:

**`start`** checks placement, then:

- **New lease** (no `.worktree-slot`): in a linked worktree, fetches
  `origin/main` and fails unless `HEAD` contains it
  (`git merge-base --is-ancestor`), printing `git rebase origin/main` as the
  fix; `--base <ref>` checks against `<ref>` instead. Then takes the lowest free
  slot in `1..99`. The main checkout always takes slot `0`, with no base check.
- **Re-run** (`.worktree-slot` present): keeps that slot, re-creates the
  registry file if absent, fails if another path holds the slot, and does
  **not** repeat the base check — re-running `start` never re-bases a mid-task
  worktree.
- Seeds `~/.config/boga/` on a machine's first run, writes the generated config,
  the Maestro env, and the shared-config symlinks, and prints slot, project id,
  and ports.

**`db down`** stops this slot's containers and keeps the volumes. A stopped
stack is not restarted when Docker/OrbStack restarts.

**`pr wait`** polls `gh` for the current branch's PR every 60 s
(`--interval <s>`), prints nothing until it exits, and costs no tokens while
waiting: `0` MERGED, `3` CLOSED unmerged, `2` no PR for this branch, `1` `gh`
error.

**`release`** asks `gh` for the branch's PR state and refuses unless MERGED or
CLOSED (`--force` overrides), then removes every Docker container, volume, and
network labelled with the lease's exact `project_id`, deletes the registry file,
and runs `git worktree remove --force`. If Docker is unavailable it fails and
**keeps the lease**, so the stack stays findable. It refuses slot 0. For the
cleanup procedure it also takes `--slot <N>` (a lease whose owner is gone) and
`--project-id <id>` (a Docker stack with no lease).

No automatic cleanup exists, by design, and sessions do die before `release` —
archived, stopped, or the app quits. `./boga worktree ls` prints every lease,
every Supabase stack in Docker, and every prunable git worktree with its PR
state; the [cleanup procedure](../procedures/worktree-cleanup.md) is how any
agent clears them, with the human's confirmation.

Scripts: `scripts/worktree-{create,start,ls,release,doctor}.sh`,
`scripts/pr-wait.sh`, and the shared library `scripts/worktree-lib.sh` (slot,
port, and project-id derivation, placement and lease guards; sourced, never
run). Supabase runtime helpers, all lease-checked:
`supabase/scripts/local-runtime-up.sh` (start stack, serve functions, sync
`apps/mobile/.env.local`), `ensure-local-runtime-baseline.sh` (idempotent up +
migrate + seed + auth fixtures, lock-serialized), `reset-local.sh`,
`local-runtime-down.sh`.

### The edge function server has no PID

`npx supabase functions serve` is a process tree — npm wrapper → node shim →
CLI → `docker logs -f` — and no PID is recorded for it.
`boga_functions_serve_stop` (`scripts/worktree-lib.sh`) finds every process
whose argv is `functions serve` or the edge-runtime `docker logs` tail **and**
whose cwd is the worktree root, plus all their descendants; it sends SIGTERM,
then SIGKILL, and fails if anything survives. `local-runtime-up.sh` (before it
starts the server), `local-runtime-down.sh`, and `worktree release` all use it,
so orphans of an earlier run are removed too. Checked by
`scripts/tests/functions-serve-stop.test.sh`.

## Removed mechanisms (do not reintroduce)

Each of these guessed, or acted on another worktree's resources, and misfired.

| Removed | Why |
| --- | --- |
| `hooks/post-checkout` auto-setup on `git worktree add` | allocated a slot for every harness worktree, wanted or not, and hid which step created a lease |
| Implicit slot setup in `_common.sh`, `./boga`, `worktree-create.sh` (main checkout), `dev-lan.sh`, `dev-remote.sh` | a missing lease was silently papered over instead of failing |
| `worktree-setup.sh` deleting registry files it judged stale | freed live slots for reuse, so a second worktree could take a slot already in use |
| `worktree-sweep.sh` — automatic run before every stack start, merge/branch-deleted signals, grace period, dead-agent-PID reaping, orphan pass, `BOGA-dev` exemption | squash merges never matched "HEAD in main", so merged stacks leaked; fresh and unpushed worktrees *did* match "merged" or "branch deleted", so another worktree's gate run destroyed live stacks and leases |
| `worktree-clean.sh` and its per-slot runtime lock | replaced by the owner's `release` |
| Slot exemption for `.claude/worktrees/` | one rule for every worktree; agent worktrees run the same gates |

## Harness rules

Beyond `AGENTS.md` rule 5 (open with `create` or `start`, never share
`apps/mobile/node_modules` or one `IOS_SIM_UDID` across worktrees, release in
the same session), equally for humans, Codex, Claude Code, and any other
harness:

1. If placement is refused, remove that worktree and recreate it under
   `$BOGA_WORKTREE_ROOT`.
2. Never run a destructive Supabase command (`reset-local`, stack restart) on a
   slot another suite is using.
3. Never release, stop, or delete another worktree's stack or lease, except
   through the cleanup procedure with the human's confirmation.

## Failure hypotheses for agents

1. **"No slot lease"**: run `./boga worktree start`. **"Slot N is leased to
   <other path>"**: your `.worktree-slot` is stale. Run `./boga worktree ls`; if
   the other path is a leftover, clear it with the cleanup procedure, otherwise
   delete your `.worktree-slot` and run `./boga worktree start --base HEAD` for
   a new slot (a mid-task worktree keeps its current base).
2. **Nested placement**: `./boga worktree doctor`; recreate outside the checkout.
3. **Stale Supabase config**: re-run `./boga worktree start`.
4. **Wrong Supabase runtime**: from the worktree,
   `bash -lc 'source supabase/scripts/_common.sh && run_supabase status -o env'`;
   compare ports with `./boga worktree doctor`.
5. **Port already allocated at stack start**: `./boga worktree ls` shows which
   stack holds that slot's ports; clear leftovers via the cleanup procedure.
6. **Duplicate Metro port or simulator**: check
   `apps/mobile/.maestro/maestro.env.local` — one Expo port
   (`8082 + slot`) and one simulator per worktree.
7. **Shared dependencies**: `apps/mobile/node_modules` must be a real directory.
8. **Docker commands hang while `orb status` says Running**: check
   `pmset -g log | grep -E "Clamshell|FullWake"`. OrbStack pauses its VM while
   the Mac sleeps (lid closed), and background agents still run in brief dark
   wakes. Keep the Mac awake for unattended runs; do not restart OrbStack.

## Verification

`scripts/tests/worktree-lifecycle.test.sh` (hermetic, in the meta-tests lane and
CI) covers `start` / `create` / `release` / `ls` / `pr wait`, slot allocation,
the base check, the project-id cap, and the fail-hard lease guard;
`scripts/tests/dev-stack-main-checkout.test.sh` covers the dev stack's
main-checkout-only rule. Change a rule above and add the case there. Two checks
need real infra and stay manual: two worktrees starting stacks with distinct
project ids and no port collision, and a nested checkout being refused before
any service starts.
