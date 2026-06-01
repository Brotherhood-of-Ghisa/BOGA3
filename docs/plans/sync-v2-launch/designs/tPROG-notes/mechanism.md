# Mechanism candidates: t3 → scheduler progress hand-off

Deep-dive notes for `designs/tPROG.md`. The main doc fixes the **contract**
(`SyncProgress` shape + sourcing + ownership). It deliberately leaves *how* t3
hands the live snapshot to the accessor as a build choice. This note records the
candidate plumbings so the t3/t9 builders don't re-litigate the trade-off, and
explains why the choice is safely deferred.

## Why deferred

All candidates produce the identical observable contract: t9's single accessor
returns the latest `SyncProgress`; t2 renders it. They differ only in internal
wiring with the same blast radius (`scheduler.ts` + the bootstrapper) and the same
testability (each is unit-testable by driving the producer and reading the
accessor). None changes the four-state machine's behaviour or cadence. So the
choice has no cross-task contract consequences — it is exactly the kind of
small/obvious implementation detail the design protocol says to leave to the build.

## Candidate 1 — module-level progress sink in the scheduler (recommended default)

The scheduler keeps a module-scoped `let latestProgress: SyncProgress` next to its
existing `state` / `onlineProjection`. It exports a tiny internal setter the
bootstrapper calls as it crosses boundaries; the production accessor merges
`latestProgress` (overriding `offline` from the live `onlineProjection`) into the
status it returns.

- Mirrors the module's existing pattern exactly (`state`, `onlineProjection`,
  `timerHandle` are all module-scoped; `__getSchedulerStateForTests` already reads
  them). Lowest conceptual cost.
- `offline` stays single-sourced: the accessor always overrides it from
  `onlineProjection`, so a stale snapshot can never report wrong network state.
- Reset on cycle/run start keeps `rowsApplied`/`layersCompleted` honest per run.

## Candidate 2 — callback threaded into `runSyncCycle` / the bootstrapper

`runSyncCycle` (and the bootstrapper) take an optional `onProgress?(p)` the
scheduler passes when it starts a cycle; the scheduler stores what it receives.

- More explicit data flow, but widens `cycle.ts`'s signature and every call site,
  and the cycle currently takes no args — a larger diff for no observable gain.
- Risks t3's size budget if the callback is threaded through every layer of the
  pull leg (the t3 card's split note flags exactly this).

## Candidate 3 — standalone shared progress store module

A new `sync/progress.ts` holding the snapshot, written by the bootstrapper, read by
the accessor.

- Cleanest separation, but adds a module and an import edge for a single tiny piece
  of state the scheduler is already the natural home for. Over-engineered for launch.

## Recommendation

Candidate 1 unless the t3/t9 builders find a concrete reason otherwise. It is the
smallest diff, matches the module's existing idioms, and keeps `offline`
single-sourced. Recorded as a recommendation, not a binding decision — the contract
in the main doc is what binds.
