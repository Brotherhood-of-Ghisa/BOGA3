# Quality & Test Gates (Always-Load Quickref)

The single source of truth for how to verify a change in this repo: how to set up,
the exact commands, and which gate to run for what you changed. One of the three
always-load docs (with `03-technical-architecture.md` and `09-project-structure.md`).

The deep per-test catalog and strategy live in `06-testing-strategy.md`; cite it,
don't restate it here.

## Run the gates (from the repo root)

```bash
./scripts/quality-fast.sh          # lint + typecheck + jest unit/integration tests
./scripts/quality-slow.sh backend  # boots local Supabase, runs auth/RLS + sync-v2 contract suites + sync-infra
./scripts/quality-slow.sh frontend # boots the iOS simulator, runs Maestro smoke + data-smoke + auth-profile + sync e2e
```

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
maestro --version                     # Maestro CLI present → quality-slow.sh frontend runnable
xcodebuild -version                   # Xcode present → dev-client build / sim runnable
docker info                           # Docker up → local Supabase → quality-slow.sh backend runnable
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

The one table that joins all four facts. For durations, run
`./scripts/test-timings.sh` — it aggregates the measured records the gates write
automatically (interpretation guide: `docs/testing/local-test-timings.md`). The
time column here is order-of-magnitude only (`N/A` = not currently measured, not
"instant"); never quote a duration you didn't get from the reader or a run.

| Lane | Command | In which gate | CI? | ~Time |
| --- | --- | --- | :--: | --- |
| *Infra: none — CI runs these* | | | | |
| lint | `npm run lint` | `quality-fast.sh frontend` | ✅ | ~1s |
| typecheck | `npm run typecheck` | `quality-fast.sh frontend` | ✅ | ~3s |
| jest unit/integration | `npm test` | `quality-fast.sh frontend` | ✅ | ~5s |
| open-handle guard | `npm run test:handles` | **CI only** (no wrapper runs it) | ✅ | ~20s |
| *Infra: local Supabase + Docker — CI-able, local-only today* | | | | |
| backend fast smoke | `test-fast.sh` | `quality-fast.sh backend` | ❌ | ~40s |
| auth / RLS contract | `test-auth-authz.sh` | `quality-slow.sh backend` | ❌ | ~4s |
| sync-v2 schema smoke | `test-sync-v2-schema-smoke.sh` | `quality-slow.sh backend` | ❌ | ~5s |
| sync-v2 push contract | `test-sync-push-contract.sh` | `quality-slow.sh backend` | ❌ | ~4s |
| sync-v2 pull contract | `test-sync-pull-contract.sh` | `quality-slow.sh backend` | ❌ | ~4s |
| dev-wipe contract | `test-dev-wipe-my-data.sh` | `quality-slow.sh backend` | ❌ | ~3s |
| sync schema-drift (strict) | `npm run check:sync-drift -- --strict` | `quality-slow.sh backend` | ❌ | ~35s |
| sync-v2 end-to-end | `test-sync-v2-e2e.sh` | `quality-slow.sh backend` | ❌ | ~2min |
| **sync-infra (mobile cross-stack)** | `npm run test:sync:infra` (`test-sync-infra.sh`) | `quality-slow.sh backend` (last) | ❌ | N/A |
| *Infra: iOS simulator + Metro — never CI-able* | | | | |
| iOS smoke | `npm run test:e2e:ios:smoke` | `quality-slow.sh frontend` | ❌ | ~75s |
| iOS data-smoke | `npm run test:e2e:ios:data-smoke` | `quality-slow.sh frontend` | ❌ | ~110s |
| iOS auth-profile | `npm run test:e2e:ios:auth-profile` | `quality-slow.sh frontend` | ❌ | N/A |
| **iOS sync e2e (UI↔server)** | `npm run test:e2e:ios:sync` | `quality-slow.sh frontend` (last) | ❌ | N/A |

Two traps this table exists to kill:

- **`test:handles` is the one lane CI runs that no `quality-*` wrapper does**, so a
  green local `quality-fast.sh frontend` is **not** the same as a green CI run. Run
  `test:handles` yourself when you touch timers, sockets, subscriptions, or async
  teardown.
- **Two lanes cross the FE/BE line, and they are NOT interchangeable:**
  **sync-infra** is a mobile jest body driving the *real* `runSyncCycle` against a
  *real* Supabase endpoint — breadth coverage (LWW, multi-device, drift) with
  emulated storage and no UI; it sits at the end of `quality-slow.sh backend`.
  **iOS sync e2e** is the device-level proof — real recorder UI, real cycle, real
  local Supabase (log a workout → pending drains to 0 → full wipe → re-sign-in
  restores from the remote DB). Bugs in UI gating, NetInfo, session handoff, and
  trigger wiring only surface in the e2e lane; a green sync-infra is not evidence
  for them.

## Which gate for what you changed

| You changed… | Run |
| --- | --- |
| Any `apps/mobile` TS/JS logic | `./scripts/quality-fast.sh` |
| `apps/mobile` UI screens / components / navigation (`app/**`, `components/**`) | `quality-fast` **+** `./scripts/quality-slow.sh frontend` |
| Sync / boot / auth (`apps/mobile/src/sync/**`, `src/auth/**`, scheduler, data bootstrap/migrations, `drizzle/**`, sync RPCs) | `quality-fast` **+** `./scripts/quality-slow.sh backend` **+** `npm run test:e2e:ios:sync` (the UI↔server e2e lane) |
| Backend (`supabase/migrations/**`, `functions/**`, RLS/policies, sync RPCs) | `./scripts/quality-slow.sh backend` |
| Added/removed/upgraded a **native** dependency (iOS pod, native Expo module, or a native field / config plugin in `apps/mobile/app.config.ts`) | **First** `cd apps/mobile && ./scripts/maestro-ios-dev-client-build.sh --force`, then `./scripts/quality-slow.sh frontend` |

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

Update this doc — **including the lane matrix above** — in the same change whenever
you alter a gate: a `scripts/quality-*` wrapper, a `supabase/scripts/test-*`
wrapper, an `apps/mobile/package.json` `test*`/`lint`/`typecheck` script, or
`.github/workflows/ci.yml`. If a fact here ever disagrees with the scripts, the
scripts win — fix the doc.

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
