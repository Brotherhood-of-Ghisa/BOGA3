# Local test-lane timings (measured reference)

**Last updated: 2026-06-07.** These timings drift as the suites, toolchain, and
hardware change — treat them as a guide and re-measure if a figure looks off (the
measurement date and method are under *How to read these numbers*). Bump this date
whenever you revise the table or re-measure.

> **Why this file exists.** Agents working on Sync (and elsewhere) have a habit of
> *inventing* test durations ("this lane takes ~10 minutes") instead of measuring
> them. This document records **real, measured** wall-clock times for every
> locally-runnable test lane so those numbers can be cited instead of guessed.
> If you need to state how long a lane takes, cite this file or re-measure — do
> not hallucinate.

## How to read these numbers (READ FIRST)

1. **When recorded.** 2026-06-05, between ~11:33 and ~12:19 BST, on the commit at
   the head of `main` at that time (worktree `hungry-rosalind-6dacfe`, slot 73,
   clean tree). Re-measure if the suite or toolchain has changed materially since.

2. **These are BEST-CASE, single-agent, local numbers.** Every lane was run on a
   single developer machine (spec below) with **nothing else heavy running** — no
   parallel agents, no concurrent worktrees competing for CPU, the iOS dev-client
   already built and cached, and the local Supabase stack already up. Each lane
   was run **3 times** and the **median** is the headline figure. This is the
   floor, not the typical CI/shared-host experience.

3. **Do NOT expect a lane to exceed ~2-3× its recorded median, ever.** A run that
   takes more than 2-3× the median below is a **signal something is wrong** (a hang,
   a cold/contended machine, a leaked handle, an unbuilt dev client, a down Supabase
   stack) — not "just a slow run". The **"≤ ceiling (3× median)"** column makes that
   threshold concrete: above it, investigate rather than wait. Conversely, if you
   are about to claim a lane takes far longer than the ceiling here, you are almost
   certainly guessing — measure it.

### Machine the numbers were measured on

| | |
|---|---|
| Hardware | Apple M4 Max, 16 cores, 48 GB RAM, `arm64` |
| OS | macOS 26.3.1 (Darwin 25.3.0) |
| Node / npm | v24.13.1 / 11.12.1 |
| Jest | 29.7.0 (`jest-expo` preset) |
| Supabase CLI | v2.76.15 (invoked via `npx`, local stack in Docker) |
| iOS runtime / Xcode | iOS 26.2 simulator (`23C54`) / Xcode 26.2 (`17C52`) |

### Method

Each lane command was run 3× back-to-back, wall-clock captured per run
(`perl Time::HiRes` deltas around the exact command the repo's `package.json` /
gate scripts invoke). Lanes were run **serially, one group at a time** (frontend →
backend → iOS Maestro) so no two heavy workloads overlapped. Pre-warm before
timing: the iOS dev-client `.app` was force-built and cached; the local Supabase
baseline (`./supabase/scripts/ensure-local-runtime-baseline.sh`) was already
running with fixtures provisioned.

---

## Summary — median wall-clock per lane

Times in seconds. `min`/`max` are the fastest/slowest of the 3 runs; `median` is
the headline. `≤ ceiling` = 3× median = "above this, something is wrong".

### Frontend — `apps/mobile` (command run from `apps/mobile/`)

| Lane | Command | median | min–max | ≤ ceiling (3×) | Status |
|---|---|---:|---:|---:|:--:|
| lint | `npm run lint` | 0.7 s | 0.7–4.2 s | 2.2 s | ✅ pass |
| typecheck | `npm run typecheck` | 2.5 s | 2.4–2.9 s | 7.4 s | ✅ pass |
| jest (full unit/integration) | `npm test` | 4.6 s | 4.4–9.7 s | 13.7 s | ✅ pass |
| jest (sync subset) | `npm run test:sync` | 3.6 s | 3.5–3.6 s | 10.7 s | ✅ pass |
| open-handle guard | `npm run test:handles` | 19.9 s | 19.5–32.6 s | 59.7 s | ✅ pass |

### Backend — Supabase (commands run from repo root; each re-ensures the warm local stack)

| Lane | Command | median | min–max | ≤ ceiling (3×) | Status |
|---|---|---:|---:|---:|:--:|
| backend fast smoke | `./supabase/scripts/test-fast.sh` | 38.5 s | 31.1–38.6 s | 115 s | ✅ pass |
| auth / RLS contract | `./supabase/scripts/test-auth-authz.sh` | 3.5 s | 3.5–4.1 s | 10.6 s | ✅ pass |
| sync v2 schema smoke | `./supabase/scripts/test-sync-v2-schema-smoke.sh` | 5.2 s | 5.2–5.6 s | 15.5 s | ✅ pass |
| sync v2 push contract | `./supabase/scripts/test-sync-push-contract.sh` | 4.0 s | 4.0–4.4 s | 11.9 s | ✅ pass |
| sync v2 pull contract | `./supabase/scripts/test-sync-pull-contract.sh` | 4.2 s | 4.1–4.6 s | 12.5 s | ✅ pass |
| dev_wipe_my_data contract | `./supabase/scripts/test-dev-wipe-my-data.sh` | 3.3 s | 3.1–3.5 s | 9.8 s | ✅ pass |
| sync schema-drift (strict) | `npm run check:sync-drift -- --strict` (from `apps/mobile`) | 35.4 s | 27.2–35.5 s | 106 s | ✅ pass |
| sync v2 end-to-end | `./supabase/scripts/test-sync-v2-e2e.sh` | 118.4 s | 118.3–120.9 s | 355 s (~5.9 min) | ✅ pass |

> The backend lanes above are exactly what `./scripts/quality-slow.sh backend`
> runs, in order. Each wrapper calls `ensure-local-runtime-baseline.sh`, which is
> a no-op (~a few seconds) when the stack is already up — that overhead **is**
> included in each figure. First-ever boot of the local stack (image pull +
> migrate + seed + fixtures) is a separate one-time cost, not included here (tens
> of seconds to a few minutes depending on Docker image cache).

### iOS Maestro — `apps/mobile` (command run from `apps/mobile/`, warm cached dev client)

| Lane | Command | median | min–max | ≤ ceiling (3×) | Status |
|---|---|---:|---:|---:|:--:|
| smoke | `npm run test:e2e:ios:smoke` | 73.6 s | 71.5–98.9 s | 221 s (~3.7 min) | ✅ pass |
| data-runtime-smoke | `npm run test:e2e:ios:data-smoke` | 110.0 s | 109.3–110.4 s | 330 s (~5.5 min) | ✅ pass |
| gates (smoke + data, shared sim/Metro) | `npm run test:e2e:ios:gates` | 135.3 s | 134.5–135.5 s | 406 s (~6.8 min) | ✅ pass |
| auth-profile (signed-in) | `npm run test:e2e:ios:auth-profile` | — | (≈283 s to **fail**) | — | ❌ **red** (see Notes) |

> `gates` runs the smoke + data-runtime-smoke flows against **one** provisioned
> simulator + one Metro instance, so it is cheaper (~135 s) than running smoke
> (~74 s) and data-smoke (~110 s) separately (~184 s) — it pays the ~55-60 s
> sim-boot/Metro-warm overhead once instead of twice.

### One-time setup costs (NOT part of any lane's per-run time)

| Setup step | Command | measured | Note |
|---|---|---:|---|
| iOS dev-client build | `cd apps/mobile && ./scripts/maestro-ios-dev-client-build.sh --force` | 129.4 s (~2 min 9 s) | Measured with partially-warm Xcode module/DerivedData caches. A fully cold build (or CI) is materially longer. Currently rebuilt **per worktree** — see Notes. |
| Local Supabase baseline first boot | `./supabase/scripts/ensure-local-runtime-baseline.sh` | not separately timed | One-time per worktree session; reused (no reset) on subsequent calls. |

---

## Notes, caveats, and known-broken lanes

- **"Run 1 of a session is slower" is normal — the median already accounts for it.**
  Cold-cache first runs are visible in several lanes (`lint` 4.2 s run-1 vs 0.7 s
  warm; `jest` 9.7 s vs 4.4 s; `test:handles` 32.6 s vs 19.5 s; `ios-smoke` 98.9 s
  vs 71.5 s). The headline median reflects a warm machine. The first run in a fresh
  shell/session can sit near the listed **max**; that is expected and still well
  under the 3× ceiling.

- **`test:e2e:ios:auth-profile` is currently RED (≈283 s to fail).** The lane runs
  four flows; it aborts at the 2nd (`sync-gate-first-cycle.yaml`) on
  `assertVisible: sync-gate-activity-indicator`. On the simulator the first-sync
  gate renders its **offline** branch ("You are offline…") instead of the activity
  indicator, because the sync scheduler projects `NetInfo.isInternetReachable ===
  true` and arms offline-first, and `isInternetReachable` is unreliable/`null` on
  the iOS simulator. The ~283 s is a real full run that ends in a failure (not a
  hang/timeout); flows 3-4 never execute. When fixed, expect this lane to run
  **longer** than 283 s (it currently stops early) — re-measure once green.
  *(A fix-it card was spawned.)*

- **`test:sync:infra` (LOCAL — runnable here, do NOT defer):** the lane reads
  `SUPABASE_BRANCH_URL` / `SUPABASE_BRANCH_ANON_KEY`, but those name *any* endpoint
  carrying the sync schema + the `user_a` fixture — including **this worktree's own
  slot-isolated local Supabase**. Bring the baseline up
  (`./supabase/scripts/ensure-local-runtime-baseline.sh`), export
  `SUPABASE_BRANCH_URL`/`SUPABASE_BRANCH_ANON_KEY` from `supabase status -o env`
  (`API_URL`/`ANON_KEY`), then `npm run test:sync:infra`. It is light (no iOS
  simulator / Metro), so it should be one of the cheaper slow-side lanes — measure
  and record its local timing here. Its schema-drift half is also covered by the
  `sync-drift` backend lane above.

- **`lint`/`typecheck` are gates, not tests** — included for completeness because
  they are part of `./scripts/quality-fast.sh frontend` and agents quote them too.

## Reproducing / re-measuring

Bootstrap first if needed (`cd apps/mobile && npm install` then
`./scripts/worktree-setup.sh` from repo root), pre-build the iOS dev client, and
bring up the local Supabase baseline. Then run each command above 3× and take the
median, keeping the machine otherwise idle. The aggregate fast picture is
`./scripts/quality-fast.sh` (frontend lint+typecheck+jest, backend fast smoke);
the slow picture is `./scripts/quality-slow.sh frontend|backend`.

## Raw per-run measurements

All three runs per lane (ms), exactly as recorded.

| Lane | run 1 | run 2 | run 3 | exit codes |
|---|---:|---:|---:|:--:|
| lint | 4178 | 721 | 709 | 0/0/0 |
| typecheck | 2900 | 2439 | 2468 | 0/0/0 |
| jest-full | 9739 | 4558 | 4417 | 0/0/0 |
| jest-sync | 3558 | 3555 | 3517 | 0/0/0 |
| handles | 32554 | 19889 | 19506 | 0/0/0 |
| backend-fast | 31058 | 38475 | 38579 | 0/0/0 |
| auth-authz | 4090 | 3538 | 3528 | 0/0/0 |
| sync-v2-schema | 5621 | 5167 | 5150 | 0/0/0 |
| sync-push-contract | 4409 | 3952 | 3959 | 0/0/0 |
| sync-pull-contract | 4578 | 4164 | 4083 | 0/0/0 |
| dev-wipe-my-data | 3545 | 3134 | 3278 | 0/0/0 |
| sync-drift | 27165 | 35417 | 35483 | 0/0/0 |
| sync-v2-e2e | 120864 | 118308 | 118414 | 0/0/0 |
| ios-smoke | 98924 | 73621 | 71519 | 0/0/0 |
| ios-data-smoke | 109347 | 110368 | 110016 | 0/0/0 |
| ios-gates | 135490 | 134534 | 135261 | 0/0/0 |
| ios-auth-profile | 283612 | 280177 | 286347 | 1/1/1 (sync-gate offline) |
| dev-client-build (one-time) | 129401 | — | — | 0 |
