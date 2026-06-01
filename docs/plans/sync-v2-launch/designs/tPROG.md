# Design: sync/bootstrap progress-reporting contract

## Question

What is the contract by which the sync/bootstrap layer reports progress to the
UI — the **phase** it is in, an **intra-phase progress / liveness** signal that
visibly advances while work happens, and a **network-unreachable** signal — and
**where is each value sourced**? Three downstream tasks each need this shape: t2
renders it on the sync-gate full-screen block, t3's bootstrapper produces it, and
t9's single shared scheduler-state accessor surfaces it to both the gate and
Settings.

## Constraints

- The network-unreachable signal must derive from the scheduler's existing NetInfo
  `isInternetReachable` projection (`onlineProjection` in `scheduler.ts`) — no
  parallel network source.
- A scheduler **wiring failure at boot CRASHES** (re-throw); that is not an offline
  state. The offline signal is the healthy-build offline case only.
- **ONE** shared scheduler-state accessor (t9 adds it) is the single read path the
  gate AND Settings both consume — the contract must not require a second accessor.
- **Exact-percentage progress is infeasible.** The pull drains each topo layer to
  `has_more = false` (`cycle.ts runPullLeg`); the seeder writes a bundle of unknown
  size; no row/layer totals are known up front. The representation must be honest
  about this.
- The contract's symbol/type names must be self-contained — no plan/card/design ids
  or `docs/plans/...` paths in downstream code.
- It must compose with the merged four-state scheduler (`OFFLINE` / `LONG_TIMEOUT`
  / `SHORT_TIMEOUT` / `RUNNING`) and its structured log events, without changing
  the machine's behaviour or cadence.

### The phases that genuinely exist (derived, not invented)

From `docs/plans/sync-v2/designs/t3.md` §1 and `cycle.ts`: the first-sync runs
inside the bootstrapper as `runFirstFullPull()` → (if `rowsPulled == 0`)
`runSeeder()` → set `bootstrap_completed_at`. The cycle leg itself is
PULL → PUSH → PULL, where each pull drains the 4 topo layers (`TOPO_LAYERS`). So
the genuinely-distinct, observable phases of a first sync are exactly:

- **pull** — draining the 4 layers (the dominant, restore-bearing phase).
- **push** — flushing dirty rows (on a fresh restore this is near-empty; on the
  seed branch it sends the seeded rows on the *next* cycle, not the bootstrap one).
- **seed** — the conditional `rowsPulled == 0` catalog insert.

There is no "connecting" or "auth" phase to invent; an offline/auth condition is
expressed by the network/error signals already in scope, not a phase.

## Options considered

### Option A — Exact percentage

A `0..1` (or `0..100`) completion fraction the gate renders as a progress bar.

- ✗ **Dishonest / impossible.** Totals are unknown up front (see Constraints); a
  percentage would require either a server-provided row count (new RPC surface,
  out of scope) or a fabricated denominator that jumps and stalls. Rejected on the
  exact-percentage constraint.

### Option B — Phase + monotonic counters (no denominator)

A small struct: the current `phase` (`'pull' | 'push' | 'seed' | 'done' | 'idle'`),
plus **monotonic counters with no total** — `layersCompleted` (0..4 within pull) and
`rowsApplied` (running count of pulled rows) — plus an `offline` boolean derived
from the scheduler projection. The gate shows the phase label, an indeterminate
activity indicator, and "synced N items" / "layer K of 4" as the advancing liveness
proof. No bar, no percentage.

- ✓ Every value is **already produced** at points the bootstrapper/pull leg
  traverse: `runFirstFullPull` returns `rowsPulled`; the pull leg loops layer 0..3;
  the seed branch is an explicit `if`. No server total needed.
- ✓ Honest: counters only ever go up; "layer K of 4" has a real, known denominator
  (the 4 topo layers are fixed) without claiming to know row totals.
- ✓ Composes with the single accessor: the scheduler owns `runSyncCycle`'s
  lifecycle and already holds the network projection, so it can hold the latest
  progress snapshot the bootstrapper feeds it.
- ✗ Slightly more surface than a pure heartbeat (two counters + phase vs. one tick).

### Option C — Phase + heartbeat liveness only

The current `phase` plus a monotonically-increasing `heartbeatTick` (or
`lastProgressAtMs`) that bumps whenever any unit of work commits, plus the `offline`
boolean. The gate shows the phase label and an indicator that animates while the
tick advances; no item/layer counts.

- ✓ Simplest possible producer: one "I made progress" ping at each layer/page/seed
  commit.
- ✓ Fully honest about the unknown total.
- ✗ Weaker UX: "something is happening" but not "how much" — a returning user
  restoring a large history sees motion but no sense of scale. The plan's gate
  outcome explicitly wants an **advancing** signal; a tick satisfies "advancing"
  but `layer K of 4` + `N items` is strictly more informative for the same producer
  cost (the bootstrapper already crosses those boundaries).

## Decision

**Option B — phase + denominator-free monotonic counters + an offline boolean,
exposed as one progress field on the single shared scheduler-state accessor.**

The contract is a single immutable snapshot shape (≤ 5-line sketch; names are
illustrative, builders may refine casing to match house style — the *shape* is
binding):

```ts
type SyncProgress = {
  phase: 'idle' | 'pull' | 'push' | 'seed' | 'done';
  layersCompleted: number; // 0..4 during 'pull' — the ONLY known denominator
  rowsApplied: number;     // monotonic count this run; never a percentage
  offline: boolean;        // mirrors scheduler onlineProjection === false
};
```

Why B wins: it is the only option that is **both honest and informative**. A
gives a value that cannot be computed (no totals — rejected on the explicit
constraint). C is honest but throws away two counts the producer already has for
free, so the gate can only ever say "working…". B reuses values that already exist
at the exact points the bootstrapper and pull leg traverse (`rowsPulled`, the
`layer = 0..3` loop, the `rowsApplied == 0` seed branch), needs no server-side
total and no new RPC, and the "4" in "layer K of 4" is a genuinely-known fixed
denominator (`TOPO_LAYERS.length`) — not a fabricated one.

`offline` is a pure projection of the scheduler's `onlineProjection` (true when the
machine is in `OFFLINE`, i.e. NetInfo `isInternetReachable !== true`); it never
derives from a phase or a cycle error, so a wiring-failure crash (which never
reaches a steady state) cannot masquerade as offline. A cycle that ends
`AUTH_REQUIRED` is **not** `offline` — that is the gate's error/route concern
(t1/t2), out of scope here.

### Sourcing + ownership

| Contract element | Sourced from | Producer | Surfacer | Renderer |
| --- | --- | --- | --- | --- |
| `phase` + `layersCompleted` + `rowsApplied` | the bootstrapper / first-pull leg as it crosses layer, page, and seed boundaries (values it already computes) | **t3** | **t9** | **t2** |
| `offline` | the scheduler's existing `onlineProjection` (NetInfo) | scheduler (merged) | **t9** | **t2** |

- **t3 owns producing** the phase/counters. It reports progress as it crosses the
  boundaries it already traverses — set `phase='pull'` and bump `layersCompleted`
  per drained layer (and `rowsApplied` per applied page), `phase='seed'` on the
  seed branch, `phase='done'` once `bootstrap_completed_at` is set. **t3 owns any
  cycle/bootstrapper instrumentation** the contract needs. The push leg may report
  `phase='push'` but needs no counter (a fresh restore pushes ~nothing; the seeded
  rows flush on the *next* cycle, after the gate has dismissed).
- **t9 owns surfacing**: it extends the single shared scheduler-state accessor it
  is already adding so the snapshot's returned shape includes `SyncProgress`
  alongside the fields it already exposes (current state, last-cycle error, online
  projection). The scheduler is the natural holder because it already owns
  `runSyncCycle`'s lifecycle and the network projection; t3 feeds it the latest
  progress snapshot, the accessor returns the latest. **No second accessor.**
- **t2 owns rendering**: phase label, an indeterminate activity indicator driven by
  the counters advancing ("layer K of 4", "N items"), and the offline message when
  `offline` is true.

### Mechanism is left to the build tasks

How t3 hands the snapshot to the scheduler (a module-level progress sink the
scheduler reads, vs. a callback threaded into `runSyncCycle`, vs. a small shared
progress store) is an **implementation choice for t3 + t9**, not a design decision —
both are small and obvious. The binding contract is only: the `SyncProgress` shape
above, produced by t3, surfaced by t9's single accessor, rendered by t2, with
`offline` wired to the scheduler projection. See
[mechanism notes](tPROG-notes/mechanism.md) for the candidate plumbings and why the
choice is safely deferred.

## Downstream impact

- t2: card updated to reference this doc (renders the contract).
- t3: card updated to reference this doc (produces phase + counters; owns the
  cycle/bootstrapper instrumentation).
- t9: card updated to reference this doc (surfaces the shape on the single shared
  accessor).

## Open questions / follow-ups

- **Push-leg counter.** Left absent by design (near-empty on first sync). If a
  future first-sync path pushes a large dirty backlog, a `rowsPushed` counter is a
  trivial additive extension — not needed for launch.
- **Multi-cycle restore.** If a restore needs more than one scheduled cycle to
  fully drain, `rowsApplied` resets per run; the gate stays up on
  `bootstrap_completed_at` (set only after the first full pull completes), so this
  does not affect gate dismissal. Cross-cycle cumulative counts are out of scope.

## Linked notes

- [Mechanism candidates for t3→scheduler progress hand-off](tPROG-notes/mechanism.md)
