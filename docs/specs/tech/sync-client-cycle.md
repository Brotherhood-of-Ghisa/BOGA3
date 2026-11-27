# Sync client cycle

> **Owns:** the mobile sync cycle's loop and guarantees, the dirty-bit lifecycle
> and the clock-monotonicity guard. **Not here:** the RPC protocol and wire shapes
> (`sync-v2-server-contract.md`), the columns (`../05-data-model.md`).
> **Load when:** changing `apps/mobile/src/sync/cycle.ts`, a dirty-bit write or
> `nowMonotonic()`.

## The cycle

`apps/mobile/src/sync/cycle.ts` runs PULL → PUSH → PULL and repeats until a
whole round is quiet: both pull legs wrote nothing and the push leg sent
nothing. Quiet counts rows **applied**, not returned, so an echo of
rows already held is quiet. The first-sign-in seed decision instead counts rows
**received**, so a resumed bootstrap is not mistaken for an empty account.

Guarantees:

- Per-batch commits: an interruption leaves the store consistent, and
  re-running from the same state reaches the same end state.
- Batch N's ack is applied before batch N+1 is built; otherwise N+1 would
  re-send the same rows.
- **No round cap and no cycle deadline.** Only convergence and the per-request
  timeout (`INTERNAL`) bound a cycle: a cap would report a non-converging spin
  as converged. A cycle resumes from persisted state, so it may span scheduler
  ticks.

## Dirty-bit lifecycle

The two local-only columns are defined in `docs/specs/05-data-model.md`
("Local sync bookkeeping"). `local_dirty = 0` means the server has the row.

| Event | `local_dirty` | `local_updated_at_ms` |
| --- | --- | --- |
| Repository write (create, update, soft delete, cascade) | `1` | `nowMonotonic()` |
| Pull apply, incoming wins | `0` | incoming `client_updated_at_ms` |
| Pull apply, incoming loses | unchanged | unchanged |
| Push ack, row unchanged since send | `0` | unchanged |
| Push ack, row edited since send | stays `1` | unchanged |
| Push error | unchanged | unchanged |

Every repository write sets the dirty bit in the same transaction as the row;
there is no "mark dirty later" path.

**Push-in-flight race.** The cycle records each row's `local_updated_at_ms` at
send time; the ack clears only rows still holding it.

## Clock-monotonicity guard

`nowMonotonic()` (`apps/mobile/src/data/clock.ts`) returns
`max(Date.now(), last_emitted_ms + 1)` and backs every dirtying write.
Pull apply raises it to the newest pulled stamp, so local edits out-stamp
rows stamped ahead of this clock. It persists on `sync_runtime_state` **in the
same transaction as the row write**; otherwise a crash could emit a timestamp
LWW rejects. The counter is device-global and survives every wipe.
