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
./scripts/quality-slow.sh frontend # boots the iOS simulator, runs Maestro smoke + data-smoke + auth-profile
```

Each script bootstraps what it needs (idempotent) and `cd`s into the right
workspace — installing deps if missing and booting/seeding the local Supabase, so
you do not set env vars or provision infrastructure by hand (Docker must be running
for the slow lanes). (`npm run …` scripts live only in `apps/mobile/package.json` —
there is no root `package.json` — but invoke the gates above, not the raw scripts.)
New-worktree setup, prerequisites, and teardown: `01-worktree-and-environment.md`.

## Which gate for what you changed

| You changed… | Run |
| --- | --- |
| Any `apps/mobile` TS/JS logic | `./scripts/quality-fast.sh` |
| `apps/mobile` UI screens / components / navigation (`app/**`, `components/**`) | `quality-fast` **+** `./scripts/quality-slow.sh frontend` |
| Sync / boot / auth (`apps/mobile/src/sync/**`, `src/auth/**`, data bootstrap/migrations, `drizzle/**`) | `quality-fast` **+** `./scripts/quality-slow.sh backend` |
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

**The slow gates (Maestro iOS + the backend/sync-v2 suites) are NOT in CI.** They
only run when you run them locally, so breakage on those lanes accumulates on
`main` invisibly. Run the slow gate for your area (table above) before the PR.

## Maintenance

Update this doc in the same change whenever you alter a gate: a `scripts/quality-*`
wrapper, a `supabase/scripts/test-*` wrapper, an `apps/mobile/package.json`
`test*`/`lint`/`typecheck` script, or `.github/workflows/ci.yml`. If a fact here
ever disagrees with the scripts, the scripts win — fix the doc.

## Deeper docs (load when relevant)

- `06-testing-strategy.md` — per-test-entry-point catalog (purpose / infra / when), coverage policies, hang-safety rationale.
- `11-maestro-runtime-and-testing-conventions.md` — Maestro runtime contract.
- `12-worktree-config-and-isolation.md` — slot model and isolation.
- `docs/testing/local-test-timings.md` — measured per-lane wall-clock times.
