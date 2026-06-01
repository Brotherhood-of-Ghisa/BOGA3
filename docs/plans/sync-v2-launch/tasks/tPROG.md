# tPROG: sync/bootstrap progress-reporting contract

**Type:** design

**Problem:** The wait-for-sync screen (the sync-gate full-screen block, t2)
currently shows only "Setting up your data…" plus a Retry-on-error button. A
user staring at a stalled gate cannot tell whether anything is happening, which
phase it is in, or whether the device is simply offline. Three tasks would
otherwise each invent an incompatible progress API: t2 renders the progress,
t3's bootstrapper produces it, and t9's scheduler state accessor surfaces it. A
single cross-cutting contract is needed before those three fan out so they
compose instead of colliding.

**Question (ONE — this design produces ONE decision):**
> What is the contract by which the sync/bootstrap layer reports progress to the
> UI — the **phase** representation, the **intra-phase progress / liveness**
> representation, and the **network-unreachable** signal — and **where is each
> sourced**?

**Downstream tasks blocked by this design:** t2 (renders the contract on the
gate), t3 (the bootstrapper produces phase + intra-phase progress), t9 (the
scheduler state accessor surfaces the same shape to both the gate and Settings).

**Constraints (already decided — not up for grabs):**
- Compose with the as-built facts in this plan's `## Carry-over from plan 2`
  sections (items 3 & 4): the merged scheduler is a four-state machine emitting
  structured log events (`sync_scheduler_transition`,
  `sync_scheduler_cycle_error`, `sync_scheduler_ignored_event`,
  `sync_scheduler_foreground_sync_requested`, `sync_scheduler_start_failed` via
  `apps/mobile/src/logging/logEvent.ts`) and tracks a NetInfo
  `isInternetReachable` projection. The network-unreachable signal almost
  certainly derives from that projection — do not introduce a parallel network
  source.
- The disconnect signal must compose with item 4: a scheduler wiring failure at
  boot CRASHES (re-throw) rather than landing in an offline state; the
  network-unreachable signal is the healthy-build offline case, not the crash
  case.
- ONE shared scheduler state accessor (t9) is the single read path the gate and
  Settings both consume — the contract must NOT require a second parallel
  accessor.
- Exact-percentage progress may be infeasible: total row/layer counts are not
  known up front (the pull drains each layer to `has_more = false`). If so, say
  so and pick the honest representation.
- Durable-code rule: the chosen contract's symbol/type names must be
  self-contained — no plan/card/design ids or `docs/plans/...` paths in the code
  the downstream builders write.
- Design writing rules apply (design-protocol): ≥ 2 options with rationale incl.
  why the alternatives lose; no code beyond ≤ 5-line contract sketches; succinct;
  simplest solution that satisfies all three requirements; < 200 lines; deep
  dives in linked notes.

**Pointers to relevant existing code / docs (read these; cite them):**
- Authoritative bootstrapper design:
  `docs/plans/sync-v2/designs/t3.md` §1 (`runFirstFullPull()` drains all four
  topological layers → `runSeeder()` when `rowsPulled == 0` → set
  `bootstrap_completed_at` LAST). The **seed phase** and per-layer pull progress
  live here; this is where intra-phase pull progress is naturally observable.
- The merged cycle: `apps/mobile/src/sync/cycle.ts` — `runSyncCycle`, the
  per-layer pull leg (pull walks the 4-layer partition per Carry-over from plan
  1 item 2; push flushes dirty rows). The design must decide WHERE intra-phase
  pull/push progress is sourced — derived from existing log events /
  `sync_runtime_state` / local row counts, vs. new progress callbacks threaded
  through the cycle + bootstrapper — and WHICH downstream card owns any cycle
  instrumentation it requires.
- The scheduler: `apps/mobile/src/sync/scheduler.ts` (four-state machine, the
  `isInternetReachable` projection, the structured log events; only
  `__getSchedulerStateForTests` exists today — t9 adds the production accessor).
- Runtime state: `apps/mobile/src/data/schema/sync-runtime-state.ts`
  (`pull_cursor` json keyed `"0".."3"`, `bootstrap_completed_at`,
  `applied_seed_migration_app_version`), singleton id `'primary'`
  (`apps/mobile/src/data/clock.ts`).
- The deferred sync-status surface design: `docs/plans/sync-v2/designs/t4.md`
  §5.2 (the scheduler "already exposes enough internal signal — current state,
  timer deadline, last cycle duration, last cycle error"). The progress contract
  should reuse this signal rather than duplicate it.

**The decision must, at minimum, specify:**
1. **Phase representation** — the set of phases the bootstrap/first-sync genuinely
   has (pull, push, seed, and any other phase the bootstrapper/cycle actually
   has — derive from the code, do not invent phases that do not exist) and how a
   phase is named/typed in the contract.
2. **Intra-phase progress / liveness representation** — weigh percentage vs.
   item/row count vs. page/cycle counter vs. a generic "phase + heartbeat"
   liveness signal, and pick ONE that honestly reflects what is knowable (see the
   exact-percentage constraint above). The exact representation was explicitly
   left open by the owner ("something that shows activity is happening").
3. **Network-unreachable signal** — how offline is represented in the contract
   and that it derives from the scheduler's `isInternetReachable` projection.
4. **Sourcing + ownership** — for each of the three, where the value is sourced
   (log events / runtime state / local row counts / new callbacks) and which
   downstream card (t2 / t3 / t9) owns producing vs. surfacing vs. rendering it.
   In particular, name the card that owns any cycle instrumentation the contract
   requires.

**Output artifact:** `docs/plans/sync-v2-launch/designs/tPROG.md` (created at
execute time by the designer — the `designs/` dir does not exist yet), with one
`## Decision` section, plus pointer-only edits to `tasks/t2.md`, `tasks/t3.md`,
and `tasks/t9.md` (`> Updated from tPROG: see designs/tPROG.md ## Decision`
markers + `Inputs` citations). Cards must NOT restate the decision.

**Out of scope:**
- The gate rendering itself (t2), the bootstrapper implementation (t3), and the
  scheduler accessor implementation (t9) — this design only fixes the contract
  they share.
- The Settings sync-status fields already specified for t9 (last successful sync
  time, dirty count, error state, network state per `docs/plans/sync-v2/designs/t4.md`
  §5.2) — those stand; this design only adds the phase/intra-phase/offline
  progress shape on the same accessor.
- Any change to the four-state scheduler machine's behaviour or cadence.
