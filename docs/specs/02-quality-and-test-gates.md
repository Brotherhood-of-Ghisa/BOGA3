# Quality & Test Gates (Always-Load Quickref)

> **Owns:** the gate ladder, the (generated) lane matrix, path→gate triggers, CI posture. **Not here:** per-test purpose and policies → `06`; durations → `./boga timings`. **Load when:** always (always-load).

The single source of truth for how to verify a change in this repo: how to set up,
the exact commands, and which gate to run for what you changed. One of the three
always-load docs (with `03-technical-architecture.md` and `09-project-structure.md`).

The deep per-test catalog and strategy live in `06-testing-strategy.md`; cite it,
don't restate it here.

## Run the gates (`./boga`, from anywhere in the repo)

```bash
./boga test fast       # lint + typecheck + jest + backend fast smoke
./boga test backend    # boots local Supabase, runs auth/RLS + sync-v2 contract suites + sync-infra
./boga test frontend   # boots the iOS simulator, runs Maestro smoke + data-smoke + auth-profile + sync e2e
./boga test --list     # every lane: name, gate, infra, CI?, command
./boga test <lane>     # one lane by name (e.g. ./boga test sync-push-contract)
./boga doctor          # verify THIS machine can run every lane
```

Lanes are defined in `scripts/lanes.tsv` (the lane registry — names there are
the canonical lane names everywhere: this doc, the timing records, `boga`).
The legacy `./scripts/quality-fast.sh` / `./scripts/quality-slow.sh` forward to
`boga` with their old argument forms.

Each script bootstraps what it needs (idempotent) and `cd`s into the right
workspace — installing deps if missing and booting/seeding the local Supabase, so
you do not set env vars or provision infrastructure by hand (Docker must be running
for the slow lanes). (`npm run …` scripts live only in `apps/mobile/package.json` —
there is no root `package.json` — but invoke the gates above, not the raw scripts.)
New-worktree setup, prerequisites, and teardown: `01-worktree-and-environment.md`.

## This dev environment runs EVERY gate — "not in CI" ≠ "can't run here"

This machine can run **every** local gate, including the slow ones: the iOS
Maestro lanes (booted simulator + Metro + dev client) and the local Supabase
backend lanes (Docker). **"Not in CI" means you must run it locally — not that it
cannot be run.** Never defer a gate by claiming the simulator or Supabase is
"unavailable" in your environment: that is a recurring false assumption. Verify
capability with the command, don't assume absence:

```bash
xcrun simctl list devices available   # bootable iOS sims (e.g. iPhone 17 Pro) → Maestro lanes runnable
maestro --version                     # Maestro CLI present → boga test frontend runnable
xcodebuild -version                   # Xcode present → dev-client build / sim runnable
docker info                           # Docker up → local Supabase → boga test backend runnable
```

The **only** thing that genuinely "can't run" the iOS/Supabase slow gates is
**CI's** Linux runner (no iOS simulator) — a CI-runner fact, **not** a
this-machine fact. CI-can't ≠ this-machine-can't. If a check above fails, fix the
tool and run the gate; do not skip it.

## The test-lane map (read this once)

**One idea explains the whole gate structure: a lane's *infrastructure
dependency* decides everything — how fast it is, which gate it sits in, and
whether CI can run it.** "Fast/slow" and "frontend/backend" are labels that track
that one axis; when they seem to disagree, infra wins.

- **No infra (pure Node/jest)** → CI-safe. The only lanes CI runs today.
- **Local Supabase + Docker** → CI-*able*, but kept local **by choice** today
  (Docker boot cost). A regression here lands on `main` green until a human runs
  the backend gate; the cheap way to add CI coverage is to run this gate in CI —
  not to rewrite the tests as infra-free.
- **iOS simulator + Metro** → can **never** run on CI's Linux runners. Local-only
  by necessity.

So "fast" does **not** imply "in CI" (the backend fast smoke needs Docker and is
local-only), and "not in CI" is not a property of a *test* — it is where the repo
currently draws the line.

### Lane matrix (what runs where)

The one table that joins all four facts. **Generated** from `scripts/lanes.tsv`
and the measured timing records — edit those and run `./boga docs gen`; the
`docs-check` lane fails if this table drifts. Never quote a duration you didn't
get from `./boga timings` or a run.

<!-- boga:gen:lane-matrix — generated from scripts/lanes.tsv + timings records; edit those, then run ./boga docs gen -->
| Lane | Run via | In which gate | CI? | Measured median† |
| --- | --- | --- | :--: | --- |
| *Infra: none — CI runs these* | | | | |
| lint | `./boga test lint` | `boga test fast` (frontend half) | ✅ | ~2.3s |
| typecheck | `./boga test typecheck` | `boga test fast` (frontend half) | ✅ | ~2.7s |
| jest-full | `./boga test jest-full` | `boga test fast` (frontend half) | ✅ | ~6.7s |
| docs-check | `./boga test docs-check` | `boga test fast` (repo half) | ✅ | ~0.0s |
| meta-tests | `./boga test meta-tests` | `boga test fast` (repo half) | ✅ | ~1.5s |
| handles | `./boga test handles` | — (run by name) | ✅ | ~20s |
| jest-sync | `./boga test jest-sync` | — (run by name) | ❌ | ~3.6s |
| *Infra: local Supabase + Docker — CI-able, local-only today* | | | | |
| backend-fast | `./boga test backend-fast` | `boga test fast` (backend half) | ❌ | ~35s |
| auth-authz | `./boga test auth-authz` | `boga test backend` | ❌ | ~3.5s |
| sync-v2-schema | `./boga test sync-v2-schema` | `boga test backend` | ❌ | ~5.2s |
| sync-push-contract | `./boga test sync-push-contract` | `boga test backend` | ❌ | ~4.0s |
| sync-pull-contract | `./boga test sync-pull-contract` | `boga test backend` | ❌ | ~4.2s |
| dev-wipe-my-data | `./boga test dev-wipe-my-data` | `boga test backend` | ❌ | ~3.3s |
| sync-drift | `./boga test sync-drift` | `boga test backend` | ❌ | ~35s |
| sync-v2-e2e | `./boga test sync-v2-e2e` | `boga test backend` | ❌ | ~2.0m |
| sync-infra | `./boga test sync-infra` | `boga test backend` | ❌ | N/A |
| *Infra: iOS simulator + Metro — never CI-able (+ local Supabase where noted)* | | | | |
| ios-smoke | `./boga test ios-smoke` | `boga test frontend` | ❌ | ~1.4m |
| ios-data-smoke | `./boga test ios-data-smoke` | `boga test frontend` | ❌ | ~1.8m |
| ios-gates | `./boga test ios-gates` | — (run by name) | ❌ | ~2.3m |
| ios-auth-profile *(+ local Supabase)* | `./boga test ios-auth-profile` | `boga test frontend` | ❌ | ~3.5m |
| ios-sync-e2e *(+ local Supabase)* | `./boga test ios-sync-e2e` | `boga test frontend` | ❌ | ~3.1m |

† All-machine median of the recorded green runs (`docs/testing/timings/records/`); `N/A` = no measured data yet, **not** "instant" — run the lane to record it. Per-machine numbers: `./boga timings`.
<!-- /boga:gen:lane-matrix -->

Two traps this table exists to kill:

- **`test:handles` is the one CI lane outside every gate aggregate** (registry
  gate `extra`), so a green local `boga test fast` is **not** the same as a green
  CI run. Run `./boga test handles` yourself when you touch timers, sockets,
  subscriptions, or async teardown.
- **Two lanes cross the FE/BE line, and they are NOT interchangeable:**
  **sync-infra** is a mobile jest body driving the *real* `runSyncCycle` against a
  *real* Supabase endpoint — breadth coverage (LWW, multi-device, drift) with
  emulated storage and no UI; it sits at the end of `boga test backend`.
  **iOS sync e2e** is the device-level proof — real recorder UI, real cycle, real
  local Supabase (log a workout → pending drains to 0 → full wipe → re-sign-in
  restores from the remote DB). Bugs in UI gating, NetInfo, session handoff, and
  trigger wiring only surface in the e2e lane; a green sync-infra is not evidence
  for them.

## Which gate for what you changed

Machine-readable form: `scripts/triggers.tsv`, queried with
`./boga test for [--diff <range>] [paths…]` — it prints the required gates AND
the trigger rule demanding each, which is exactly what a ⛔ N/A in the PR
Tests table must cite. `./boga pr check` enforces this on PR bodies (CI runs
it on every PR). The table below is the human summary; keep both in sync.

| You changed… | Run |
| --- | --- |
| Any `apps/mobile` TS/JS logic | `./boga test fast` |
| `apps/mobile` UI screens / components / navigation (`app/**`, `components/**`) | `./boga test fast` **+** `./boga test frontend` |
| Sync / boot / auth (`apps/mobile/src/sync/**`, `src/auth/**`, scheduler, data bootstrap/migrations, `drizzle/**`, sync RPCs) | `./boga test fast` **+** `./boga test backend` **+** `./boga test ios-sync-e2e` (the UI↔server e2e lane) |
| Backend (`supabase/migrations/**`, `functions/**`, RLS/policies, sync RPCs) | `./boga test backend` |
| Added/removed/upgraded a **native** dependency (iOS pod, native Expo module, or a native field / config plugin in `apps/mobile/app.config.ts`) | **First** `./boga ios build-client --force`, then `./boga test frontend` |

Run the gate(s) for your change **to green before opening the PR**, and put the
evidence (command output / Maestro artifact path) in the PR. A pure-JS or
config-only change never needs the dev-client rebuild (Metro bundles it at
runtime); a native change always does, or every worktree's Maestro run fails at
boot with `Cannot find native module`.

## What CI runs

CI (`.github/workflows/ci.yml`) runs **only the fast lane** — `lint`, `typecheck`,
`test`, `test:handles` — in `apps/mobile`, with a 5-minute timeout per step.
`test:handles` is the open-handle guard (`jest --detectOpenHandles`); CI runs it
on every PR, so you only need it locally when you touched timers, sockets,
subscriptions, or async teardown. `npm test` is deliberately bare `jest` (no
`--forceExit`) so leaked handles surface — don't add it.

**Everything else is local-only** (see the `CI?` column in the lane matrix). The
backend/sync-v2 suites are CI-*able* but kept local by choice; the Maestro iOS
lanes can never run on CI's Linux runners. Either way, breakage on those lanes
accumulates on `main` invisibly until a human runs them — so run the slow gate for
your area (table above) before the PR.

## Maintenance

Update this doc — **including the lane matrix above** — in the same change
whenever you alter a gate or lane: `scripts/lanes.tsv` (the registry `./boga`
runs from), `scripts/triggers.tsv` (the path-trigger registry behind
`boga test for` / `boga pr check`), `supabase/scripts/run-suite.sh` / `test-*.sh`,
`apps/mobile/scripts/maestro-run-lane.sh`, an `apps/mobile/package.json`
`test*`/`lint`/`typecheck` script, or `.github/workflows/ci.yml`. If a fact here
ever disagrees with `scripts/lanes.tsv` or the scripts, the registry/scripts
win — fix the doc.

**Source-of-truth ownership** (so the test docs can't drift apart again):
this doc owns the lane matrix + CI membership; `06-testing-strategy.md` owns each
test's purpose/why; durations are owned by the measured records under
`docs/testing/timings/records/` (written by the gates, read via
`./scripts/test-timings.sh` — no doc hand-maintains them). Each links by lane
name; none restates another's column.

## Deeper docs (load when relevant)

- `06-testing-strategy.md` — per-test-entry-point catalog (purpose / infra / when), coverage policies, hang-safety rationale.
- `11-maestro-runtime-and-testing-conventions.md` — Maestro runtime contract.
- `12-worktree-config-and-isolation.md` — slot model and isolation.
- `./scripts/test-timings.sh` — measured per-lane wall-clock times (interpretation: `docs/testing/local-test-timings.md`).
