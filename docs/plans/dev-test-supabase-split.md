# Design: separate Supabase for local dev vs. worktree-0 tests

> Status: **approved; spike validated** (2026-06-21) — implementing.
> Owner: Dino. Drives changes to `supabase/scripts/**`, `scripts/dev/**`, `boga`,
> and the worktree-isolation contract (`docs/specs/12`). Working note — promote
> the contract bits into `docs/specs/12` once shipped.

## Spike result (2026-06-21) — both load-bearing assumptions hold

- **`--workdir` runs a second stack concurrently.** `supabase@2.76.15 --workdir
  <dir> start` brought up `project_id = BOGA-dev` on the slot-100 ports
  (API `65431`, DB `65422`, …) *while* the slot-0 `BOGA` stack stayed up; both
  GoTrue endpoints answered independently and `dev_fixture_principals` was present
  on the dev stack (migrations + seed applied). Recipe: a workdir whose
  `supabase/` holds a port/project-rewritten `config.toml` + **symlinks** to the
  repo's `migrations/`, `seed.sql`, `functions/`.
- **The sweep WOULD evict `BOGA-dev`.** `worktree-sweep.sh --report` returned
  `EVICT — orphan, no live worktree maps to this stack`. The sweep exemption
  (§3) is therefore mandatory, not optional.

## Problem

On the main checkout (slot 0), **one** local Supabase stack (`project_id = BOGA`,
ports `5542x`/`55431`) backs *both*:

- your live human dev session (signed in as `a@dev.local`, real logged data), and
- every backend gate (`boga test fast|backend`, sync-infra, Maestro lanes).

The gates legitimately need a clean DB, so they truncate `auth.users` and app
tables (and `backend-fast` does a full `db reset`). That **wipes your dev data and
session out from under you** — exactly what happened this session. Tests must stay
hermetic; the dev DB must persist. They cannot share one stack.

## Goal

Give the **main checkout** a dedicated, persistent **dev** Supabase stack, distinct
from the **test** stack the gates use, so:

1. running any gate never touches dev data, and
2. the dev launchers/`ensure-dev-baseline` never touch the gate stack.

Non-goal (for now): per-linked-worktree dev stacks. Linked worktrees are
short-lived and already slot-isolated; the pain is specifically slot-0 dev↔test.
The design keeps the door open but scopes implementation to the main checkout.

## Constraints (from `docs/specs/12`)

1. **The sweep is aggressive.** `worktree-sweep.sh` runs before *every*
   `local-runtime-up.sh` and evicts, by `project_id`, every Docker Supabase stack
   with no live `git worktree` entry. A new `BOGA-dev` project has no worktree →
   it would be reaped as an orphan on the next gate run. **A sweep exemption is
   mandatory and central to this design.**
2. **Ports are slot-derived and nearly maxed.** `API = 55431 + slot*100`; slots
   0–99 top out ~`65331`. The dev block must sit outside the 0–99 range and stay
   under 65535.
3. **The CLI keys a stack off `supabase/config.toml`.** Running two stacks from
   one repo needs two configs/workdirs; `supabase status` reflects whichever
   config is current.
4. **No nested-worktree violations**, and `node_modules`/sim isolation rules are
   untouched (this is backend-only).

## Proposed design

### 1. A reserved "dev" pseudo-slot (index 100) for the main checkout

Reuse the existing port formula with a **reserved slot index `100`** (outside the
allocatable `0..99` range, so it can never collide with a real worktree) and a
distinct project id:

| Resource | Formula (`slot=100`) | Value | Test stack (slot 0) |
| --- | --- | --- | --- |
| `project_id` | reserved | `BOGA-dev` | `BOGA` |
| API | `55431 + slot*100` | `65431` | `55431` |
| DB | `55422 + slot*100` | `65422` | `55422` |
| Shadow | `55420 + slot*100` | `65420` | `55420` |
| Studio | `55423 + slot*100` | `65423` | `55423` |
| Inbucket | `55424 + slot*100` | `65424` | `55424` |
| Analytics | `55427 + slot*100` | `65427` | `55427` |
| Pooler | `55429 + slot*100` | `65429` | `55429` |

All within range and clear of slot 99 (`~65331`). No new formula — index 100 is a
named constant (`BOGA_DEV_SLOT`).

### 2. A separate generated config + workdir

- Generate `supabase/config.dev.toml` (gitignored) from
  `supabase/config.toml.template` with `project_id = BOGA-dev` + the dev ports.
- Run the dev stack via the CLI's **`--workdir`** against a gitignored dev workdir
  (e.g. `supabase/.dev/`) that carries the dev `config.toml` plus **symlinks** to
  the shared `migrations/`, `seed.sql`, and `functions/`. This keeps migrations
  single-source while letting the two stacks run concurrently with independent
  `supabase status`.
- **⚠️ Spike first (see Risks):** confirm `supabase@2.76.15 --workdir <dir>
  start|status|db push` runs a second project cleanly. This is the load-bearing
  assumption; validate before building the rest.

### 3. Sweep exemption (mandatory)

Teach `worktree-sweep.sh` to **never evict** a project id matching the dev stack
(exact `BOGA-dev`, or a `-dev` suffix rule). Same spirit as its existing
"never touch a human checkout's stack" rule — the dev stack is human-owned and
backed by the main checkout, just not by its own `git worktree` row. Add a
focused test asserting a `BOGA-dev` stack survives a sweep with no worktree entry.

### 4. Scripts & commands

New (mirror the existing per-slot scripts, `--workdir`-parameterized):

- `supabase/scripts/dev-runtime-up.sh` / `dev-runtime-down.sh` / `dev-reset.sh`
  — operate the `BOGA-dev` stack.
- `ensure-dev-baseline.sh` (already built) gains a `--dev-stack` mode: target the
  dev workdir/ports, still reuse-no-reset + migrate + seed dev users.

Wire-up:

- `boga db dev` → ensure the **dev** stack baseline (not slot-0).
- `boga db dev-up|dev-down|dev-reset` → dev-stack lifecycle.
- `dev-lan.sh` / `dev-remote.sh` → point `.env.local`/serve at the **dev** stack
  (API `65431`), and call the dev baseline. Gates and `boga test *` stay on slot 0.
- `boga db up|down|reset|baseline` and all gates: **unchanged** (slot 0 = test).

### 5. Guardrails

- Dev scripts refuse to run against `project_id = BOGA` (the test stack); gate
  scripts refuse `BOGA-dev`. Fail loud, no silent cross-targeting.
- `worktree-doctor.sh` reports the dev stack's expected vs actual ports.

## Test plan

- Unit/script: sweep exemption keeps `BOGA-dev`; dev/test scripts refuse the wrong
  `project_id`; config generation emits the dev ports.
- Integration: bring up both stacks; confirm distinct project-ids, no port
  collision, `supabase --workdir` status isolation (spec 12 §"Parallel Supabase"
  analog).
- The decisive proof: **run `boga test backend` while the dev stack holds
  `a@dev.local` + logged data, and confirm the dev data survives** (the bug that
  started this).

## Risks / open questions

1. **CLI multi-stack via `--workdir` (highest risk).** If `--workdir` doesn't
   cleanly run a second project on this CLI version, fallbacks: (a) a sibling
   repo-root workdir `.supabase-dev/` with symlinked migrations; (b) config-swap
   with a lock. Resolve via the spike before committing to the rest.
2. **Docker resource cost** — two stacks running. Acceptable on this machine;
   `dev-down` stops the dev stack when not needed.
3. **Migration drift between stacks** — mitigated by symlinking `migrations/`;
   `ensure-dev-baseline` applies pending migrations to the dev stack on each dev
   start (already its behavior).
4. **Generalization to linked worktrees** — deferred; index-100 is main-only.

## Rollout

1. Spike the `--workdir` mechanism (throwaway, ~30 min).
2. Config generation + dev lifecycle scripts.
3. Sweep exemption + guardrails (+ tests).
4. Point dev launchers + `boga db dev` at the dev stack.
5. Docs: fold the contract into `docs/specs/12`; update `RUNBOOK.md`.
6. Verify: gate run leaves dev data intact.
