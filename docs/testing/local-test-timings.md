# Local test-lane timings — how to read the measured numbers

**The numbers themselves are NOT in this file, or in git.** They live as
measured per-run records in each machine's timing store,
`~/.config/boga/timings/records/` (written automatically by every `./boga test`
lane run via `scripts/lane-timing.sh`), and are read with:

```bash
./scripts/test-timings.sh                 # all lanes, this machine
./scripts/test-timings.sh ios-smoke       # one lane
./scripts/test-timings.sh --all-machines  # cross-machine rough guide
```

> **Why this exists.** Agents working on Sync (and elsewhere) had a habit of
> *inventing* test durations ("this lane takes ~10 minutes") instead of
> measuring them — and a hand-maintained table of numbers went stale and
> couldn't be safely updated by parallel agents on different machines. So the
> data is now a measurement database: every gate run appends its own record
> (one new file per run — no edits, no conflicts) to its machine's store, and
> the reader aggregates them. **If you need to state how long a lane
> takes, run the reader or run the lane — never estimate.**

## How to interpret the reader's output

1. **Medians are per-machine and recency-filtered.** The reader keys records to
   a machine fingerprint (CPU + cores + OS name — not the OS version, so an OS
   update keeps the history) and defaults to the last 90 days, so numbers
   reflect *your* machine as it is now. A fresh machine with no
   records falls back to all-machines data with a warning — treat that as a
   rough guide and let your own gate runs build local data.

2. **Medians are best-case-leaning.** Records come from real gate runs, which
   include cold first runs and contended machines; the median absorbs most of
   that. The first run in a fresh shell/session (cold caches, sim boot, stack
   boot) can sit near the lane's max; that is expected.

3. **Do NOT expect a lane to exceed ~3× its median, ever.** The reader prints a
   `ceiling (3×)` column. A run above it is a **signal something is wrong** — a
   hang, a leaked handle, an unbuilt dev client, a down Supabase stack — not
   "just a slow run". Investigate instead of waiting. Conversely, if you are
   about to claim a lane takes far longer than its ceiling, you are almost
   certainly guessing — measure it.

4. **Failed runs are recorded but excluded from medians** (the reader counts
   only `exit_code == 0`), so a red lane can't poison the timing data.

## How records are produced

- Every lane invoked through `./boga test <gate|lane>` (and the legacy
  `quality-*.sh` forwarders) is timed by `scripts/lane-timing.sh` and lands one
  JSON file in the machine's store, `$(boga_config_root)/timings/records/`
  (`~/.config/boga` by default; `BOGA_TIMINGS_DIR` overrides). The store is
  **outside every worktree**: all worktrees, the `./boga sweep` worktree, and
  the main checkout share it, so `./boga worktree release` loses nothing and
  there is nothing to commit. Filenames are
  `<utc>.<machine-id>.slot<slot>.<lane>.json`, append-only.
- Record fields: `lane`, `wall_ms`, `exit_code`, `recorded_at`, `machine_id`
  (sha1 of `hw|cores|os-name`, first 8 chars), `hw`, `cores`, `os`, `slot`,
  `commit` (short HEAD), `dirty` (`true` when the worktree had uncommitted
  changes as the lane started — the run tested work in progress, not
  `commit`; `null` when git could not tell), `source`. Records written before
  `dirty` existed lack the field.
- Commands run directly (`npm test`, a Maestro script, CI's workflow steps)
  bypass `./boga test` and record nothing; `./boga test for` only prints
  requirements.
- Set `BOGA_LANE_TIMING=0` to suppress recording for a run you know is
  unrepresentative (e.g. a deliberately loaded machine).
- One-time setup costs (iOS dev-client build, first Supabase boot) are not lane
  times; the dev-client build records under the `dev-client-build` lane when
  measured.

## Importing older records

Until 2026-09 the records were committed under `docs/testing/timings/records/`
(and from 2026-07-16 were accidentally gitignored, so most were lost when
worktrees were released). To pull that history, or records stranded in an old
checkout, into your machine's store:

```bash
./boga timings import --git 30e442b2   # the last main commit that carried them
./boga timings import <checkout>/docs/testing/timings/records
```

Import is idempotent (keyed by file name) and never overwrites a record.
