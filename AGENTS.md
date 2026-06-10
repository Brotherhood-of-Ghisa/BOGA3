# AGENTS.md

The single agent entrypoint (`CLAUDE.md` is a symlink to this file, so
Claude-family harnesses auto-load it too). The rules below are **in this file on
purpose** — links are for depth, never for rules. Deep content lives in one
place each under `docs/specs/**`, routed from here.

## Non-negotiables (read these even if you read nothing else)

1. **This machine runs EVERY local gate** — including the iOS Maestro lanes
   (simulator + Metro) and the local-Supabase backend lanes (Docker). "Not in
   CI" means *you* run it locally, never "can't run". Before claiming a gate is
   unavailable, verify capability — a failing check is a bootstrap gap to fix,
   not a skip:

   ```bash
   xcrun simctl list devices available   # bootable iOS sims → Maestro lanes runnable
   maestro --version && xcodebuild -version
   docker info                           # Docker up → local Supabase lanes runnable
   ```

2. **Never state a test duration you didn't measure.** Run
   `./scripts/test-timings.sh` — it aggregates the measured per-run records the
   gates write automatically (`docs/testing/timings/records/`). If a lane has no
   data, run it; the gate records it. Estimating a duration is an error.

3. **Run the gates for what you changed, to green, before opening the PR:**

   ```bash
   ./scripts/quality-fast.sh          # lint + typecheck + jest (+ backend fast smoke)
   ./scripts/quality-slow.sh backend  # local Supabase: auth/RLS + sync-v2 contracts + drift + sync-infra
   ./scripts/quality-slow.sh frontend # iOS sim: Maestro smoke + data-smoke + auth-profile + sync e2e
   ```

   | You changed… | Run |
   | --- | --- |
   | Any `apps/mobile` TS/JS logic | `quality-fast.sh` |
   | UI screens / components / navigation | `quality-fast.sh` + `quality-slow.sh frontend` |
   | Sync / boot / auth (`src/sync/**`, `src/auth/**`, scheduler, drizzle/migrations) | `quality-fast.sh` + `quality-slow.sh backend` + `npm run test:e2e:ios:sync` (UI↔server e2e) |
   | Backend (`supabase/migrations/**`, functions, RLS, sync RPCs) | `quality-slow.sh backend` |
   | Native dependency / config-plugin change | rebuild dev client first, then `quality-slow.sh frontend` (see `02`) |

   The gates self-bootstrap deps and the local Supabase stack; Docker must be
   running for the slow lanes. Full lane matrix, CI posture, and the dev-client
   rebuild rule: `docs/specs/02-quality-and-test-gates.md`.

4. **The sync-infra and sync-e2e lanes run locally — do not defer them.** Each
   worktree has its own slot-isolated local Supabase; the wrappers export
   `SYNC_TEST_SUPABASE_URL`/`SYNC_TEST_SUPABASE_ANON_KEY` themselves. There is
   no remote-only test lane in this repo.

## Always load (every session)

- `docs/specs/01-worktree-and-environment.md` — set up / tear down a worktree.
- `docs/specs/02-quality-and-test-gates.md` — the full gate/lane reference.
- `docs/specs/03-technical-architecture.md` — tech choices, decision register.
- `docs/specs/09-project-structure.md` — repo layout, path ownership.

## Load on demand (by task area)

| If your task touches… | Also load |
| --- | --- |
| UI / screens / components / navigation | `docs/specs/08-ux-delivery-standard.md`, `docs/specs/ui/README.md` (index → load only the bundle docs you need) |
| Data model / schema / migrations / sync scope | `docs/specs/05-data-model.md` |
| Sync (data model, server schema, push/pull RPC, drift) | `docs/specs/05-data-model.md`, `docs/specs/tech/sync-v2-server-contract.md` |
| Auth / RLS / backend API | `docs/specs/10-api-authn-authz-guidelines.md`, `supabase/README.md` |
| Maestro / iOS e2e flows or harness | `docs/specs/11-maestro-runtime-and-testing-conventions.md`, `apps/mobile/README-maestro.md` |
| Worktree internals / isolation / slot model / cross-worktree bugs | `docs/specs/12-worktree-config-and-isolation.md` (deep contract; everyday setup is in `01`) |
| Deep testing strategy / adding or changing a test lane | `docs/specs/06-testing-strategy.md` |
| Data import (GymBook / JSON) | `apps/mobile/scripts/import/BOGA_IMPORT_JSON_CONTRACT.md` |
| Human local-dev ops (run/build/debug, logs, reset) | `RUNBOOK.md` |
| Product/domain context | `docs/specs/00-product.md`, `docs/specs/README.md` (full spec index) |

Product and domain details are maintained in the specs above — do not duplicate
them here.

## Ignore plans, tasks, and brainstorms unless you are executing one

`docs/plans/**`, `docs/tasks/**`, and `docs/brainstorms/**` are working notes,
not source-of-truth. They include completed, superseded, and abandoned material
that will mislead you if you treat it as current. **Do not read them, and do not
let them steer your work, unless the user explicitly points you at a specific
plan/task to execute or to brainstorm in.** Source-of-truth lives in
`docs/specs/**`, `AGENTS.md`, and `RUNBOOK.md`.

## Pull requests

Keep PR bodies lean and data-driven — follow `.github/pull_request_template.md`:
**Objective / Tests / Review hard / Deviations**, using data and `file:line`
pointers, not prose (~25 lines; link, don't quote). The **Tests** section must list
every gate lane from `docs/specs/02-quality-and-test-gates.md` with ✅ ran / ⛔ N/A
and a result + evidence link for each — "CI green" alone is not enough, and every
⛔ must cite the path-trigger rule it relies on (table above / spec `02`).
