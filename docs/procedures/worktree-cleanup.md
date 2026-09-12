# Worktree cleanup procedure

A procedure any agent (Claude, Codex, or another harness) follows to clear
worktrees, slot leases, and Supabase stacks whose owner never ran
`./boga worktree release`. Nothing in this repo cleans these up automatically; this
procedure is the backstop. The lifecycle it backs up is in
[`docs/specs/12-worktree-config-and-isolation.md`](../specs/12-worktree-config-and-isolation.md).

## When to run it

- The user asks you to clean up worktrees, stacks, or Docker.
- `./boga worktree start` reports a slot conflict, or a stack start fails with
  "port is already allocated".
- Docker is slow or heavy and `./boga worktree ls` shows stacks for merged or
  closed PRs.

## Rules

1. **Look first, then ask.** Steps 1–3 are read-only. Remove nothing until the
   human confirms the plan in step 3.
2. **Never touch work in progress without an explicit yes.** An OPEN PR, no PR,
   or a detached HEAD means someone may still be working there.
3. **Never touch the dev stack** (`BOGA-dev`) or the main checkout's slot 0.
4. **Run from the main checkout**, not from a worktree you are about to remove.
5. **Report exactly what you removed**, with the before/after `ls`.

## Steps

### 1. Inventory

```bash
./boga worktree ls
```

It prints three sections: leases (slot, project id, path, branch, stack state,
PR state), Supabase stacks in Docker with no lease, and prunable git worktrees.

### 2. Classify every row

| What `ls` shows | Proposed action |
| --- | --- |
| Lease, PR **MERGED** or **CLOSED** | `./boga worktree release --slot <N>` |
| Lease, worktree path missing | `./boga worktree release --slot <N> --force` |
| Lease, PR **OPEN**, no PR, or detached HEAD | **Keep.** List it and ask the human about each one |
| Supabase stack with no lease (not `BOGA-dev`) | `./boga worktree release --project-id <id> --force` |
| Prunable git worktree | `git worktree prune` |
| Docker resources of other projects (not `BOGA*`) | Report only; they are not this repo's |

### 3. Present the plan and wait

Show the human a table: row, evidence (PR number and state, path exists or not,
container count), and the exact command you will run. Wait for a clear yes.
Treat anything not explicitly approved as "keep".

### 4. Execute and verify

Run the approved commands one at a time and stop at the first failure. If Docker
is unavailable, `release` fails and keeps the lease; fix Docker (see
[`12`](../specs/12-worktree-config-and-isolation.md) failure hypothesis 8) and
retry. Do not delete lease files by hand. Finish with `./boga worktree ls` and
report the before/after counts of leases, stacks, and containers.
