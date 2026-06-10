# Local test-lane timings — how to read the measured numbers

**The numbers themselves are NOT in this file.** They live as measured per-run
records under `docs/testing/timings/records/` (written automatically by the
quality gate wrappers via `scripts/lane-timing.sh`) and are read with:

```bash
./scripts/test-timings.sh                 # all lanes, this machine
./scripts/test-timings.sh ios-smoke       # one lane
./scripts/test-timings.sh --all-machines  # cross-machine rough guide
```

> **Why this exists.** Agents working on Sync (and elsewhere) had a habit of
> *inventing* test durations ("this lane takes ~10 minutes") instead of
> measuring them — and a hand-maintained table of numbers went stale and
> couldn't be safely updated by parallel agents on different machines. So the
> data is now a measurement database: every gate run on every machine appends
> its own record (one new file per run — no edits, no merge conflicts), and the
> reader aggregates them per machine. **If you need to state how long a lane
> takes, run the reader or run the lane — never estimate.**

## How to interpret the reader's output

1. **Medians are per-machine and recency-filtered.** The reader keys records to
   a machine fingerprint (hardware + cores + OS) and defaults to the last 90
   days, so numbers reflect *your* machine as it is now. A fresh machine with no
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

- Every lane invoked through `./scripts/quality-fast.sh` / `./scripts/quality-slow.sh`
  is timed by `scripts/lane-timing.sh` and lands one JSON file in
  `docs/testing/timings/records/` (append-only by construction —
  timestamp + machine + slot + lane in the filename — so parallel agents,
  parallel worktrees, and branch merges never conflict).
- **Commit the new record files with your PR.** They are the dataset; a gate run
  whose records are discarded teaches the repo nothing.
- Set `BOGA_LANE_TIMING=0` to suppress recording for a run you know is
  unrepresentative (e.g. a deliberately loaded machine).
- One-time setup costs (iOS dev-client build, first Supabase boot) are not lane
  times; the dev-client build records under the `dev-client-build` lane when
  measured.

## Known data gaps

- `sync-infra` and `ios-auth-profile` have no green measured records yet (the
  auth-profile lane's pre-fix red runs were discarded as invalid timings). Their
  first gate runs will populate them.
- The seed records (`20260605.m4max-seed.ndjson`) were migrated from the
  hand-measured 2026-06-05 table (Apple M4 Max, 16 cores, macOS 26.3.1; 3 runs
  per lane, serial, warm caches) so historical medians survive the format
  change.
