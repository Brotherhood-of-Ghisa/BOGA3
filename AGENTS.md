# AGENTS.md

The single agent entrypoint (`CLAUDE.md` is a symlink to this file, so
Claude-family harnesses auto-load it too). The rules below are **in this file on
purpose** — links are for depth, never for rules. Deep content lives in one
place each under `docs/specs/**`, routed from here.

## Non-negotiables (read these even if you read nothing else)

1. **This machine runs EVERY local gate** — including the iOS Maestro lanes
   (simulator + Metro) and the local-Supabase backend lanes (Docker). "Not in
   CI" means *you* run it locally, never "can't run". Before claiming a gate is
   unavailable, run `./boga doctor` — a FAIL there is a bootstrap gap to fix,
   not a skip.

2. **Never state a test duration you didn't measure.** Run `./boga timings` —
   it aggregates the measured per-run records the gates write automatically
   (`docs/testing/timings/records/`). If a lane has no data, run it; the gate
   records it. Estimating a duration is an error.

3. **Run the gates for what you changed, to green, before opening the PR.**
   `./boga` is the single entrypoint (runnable from anywhere in the repo;
   lanes defined in `scripts/lanes.tsv`; `./boga test --list` shows everything):

   ```bash
   ./boga test fast       # mobile + docs/meta + consent/MCP unit + backend fast smoke
   ./boga test backend    # local Supabase: auth/agent/sync contracts + MCP smoke
   ./boga test frontend   # iOS sim: every Maestro lane (the frontend-ui lanes + auth-profile + sync e2e + groups e2e)
   ./boga test frontend-ui  # iOS sim: the lanes that need no backend — what a screen/component change requires
   ```

   | You changed… | Run |
   | --- | --- |
   | Any `apps/mobile` TS/JS logic | `boga test fast` |
   | UI screens / components / navigation | `boga test fast` + `boga test frontend-ui` (+ the area e2e lane `boga test for` prints) |
   | Root layout (`app/_layout.tsx`) / Maestro harness or runtime scripts | `boga test fast` + `boga test frontend` |
   | Sync / boot / auth (`src/sync/**`, `src/auth/**`, scheduler, drizzle/migrations) | `boga test fast` + `boga test backend` + `boga test ios-sync-e2e` (UI↔server e2e) |
   | Backend (`supabase/migrations/**`, functions, RLS, sync RPCs) | `boga test backend` |
   | Groups (`src/groups/**`, `supabase/migrations/*group*`) | the rows above + `boga test ios-groups-e2e` (two-user e2e) |
   | Agent consent web (`apps/agent-auth-web/**`) | `boga test fast` |
   | MCP service (`services/boga-mcp/**`) | `boga test fast` + `boga test mcp-smoke` |
   | Native iOS dependency / config-plugin change | `./boga ios build-client --force` first, then `boga test frontend` (see `02`) |

   Gate selection is path-based and selective (`./boga test for` is the
   authority). The backstop is `./boga sweep --ref <ref>` — every lane, in its
   own worktree — run before an iOS build and on large or shared-UI PRs
   (`boga test for` flags those; spec `02`).

   Once the worktree holds a slot lease (rule 5), the gates bootstrap deps and
   the local Supabase stack themselves; Docker must be running for the slow lanes. Full lane matrix, CI posture, and the dev-client
   rebuild rule: `docs/specs/02-quality-and-test-gates.md`.

4. **The sync-infra and sync-e2e lanes run locally — do not defer them.** Each
   worktree has its own slot-isolated local Supabase; the wrappers export
   `SYNC_TEST_SUPABASE_URL`/`SYNC_TEST_SUPABASE_ANON_KEY` themselves. There is
   no remote-only test lane in this repo.

5. **You own your worktree from open to merge.** Nothing cleans up after you
   (spec `01`; contract `12`):
   - **Open:** `./boga worktree create <branch>` (new worktree from the latest
     `origin/main`), or `./boga worktree start` inside a worktree your harness
     made. It fails unless the worktree contains the latest `origin/main`; pass
     `--base`/`--from <ref>` only when told to. Every `./boga test|db|ios|env`
     command, Supabase script, and Maestro run fails hard without this slot lease.
   - **PR opened:** `./boga db down`, then run `./boga pr wait` in the background.
   - **PR merged or closed** (`pr wait` exits): `./boga worktree release`.
   - **Leftovers from dead sessions:** follow
     `docs/procedures/worktree-cleanup.md` — it asks the human before removing
     anything.
   - Never nest a worktree inside another checkout; never share
     `apps/mobile/node_modules` or an iOS simulator across worktrees.

## Design work (all contributors and agents)

For every significant UI/design task, load and follow
`docs/specs/ui/ai-design-policy.md`. It is the single provider-neutral policy
for accepted design targets, external-artifact vs repository authority,
generated-code integration, screenshot comparison, conflict reporting, and
commit boundaries.

## Always load (every session)

- `docs/specs/02-quality-and-test-gates.md` — the full gate/lane reference.
- `docs/specs/03-technical-architecture.md` — tech choices, decision register.
- `docs/specs/09-project-structure.md` — repo layout, path ownership.

## Load on demand (by task area)

| If your task touches… | Also load |
| --- | --- |
| UI / screens / components / navigation | `docs/specs/08-ux-delivery-standard.md`, `docs/specs/ui/README.md`, `docs/specs/ui/ai-design-policy.md` |
| Data model / schema / migrations / sync scope | `docs/specs/05-data-model.md` |
| Sync (data model, server schema, push/pull RPC, drift) | `docs/specs/05-data-model.md`, `docs/specs/tech/sync-v2-server-contract.md` |
| Auth / RLS / backend API | `docs/specs/10-api-authn-authz-guidelines.md`, `supabase/README.md` |
| Groups (group tables/RPCs, share trigger, `src/groups`, group screens) | `docs/specs/tech/groups-contract.md`, `docs/specs/10-api-authn-authz-guidelines.md` |
| Maestro / iOS e2e flows or harness | `docs/specs/11-maestro-runtime-and-testing-conventions.md`, `apps/mobile/README-maestro.md` |
| Worktree lifecycle (open / release / repair), slot-lease errors, or isolation bugs | `docs/specs/01-worktree-and-environment.md` (everyday), `docs/specs/12-worktree-config-and-isolation.md` (deep contract) |
| Cleaning up leftover worktrees, leases, or Supabase stacks | `docs/procedures/worktree-cleanup.md` (follow it step by step) |
| Deep testing strategy / adding or changing a test lane | `docs/specs/06-testing-strategy.md` |
| Data import (GymBook / JSON) | `apps/mobile/scripts/import/BOGA_IMPORT_JSON_CONTRACT.md` |
| Human local-dev ops (run/build/debug, logs, reset) | `RUNBOOK.md` |
| Product/domain context | `docs/specs/00-product.md`, `docs/specs/README.md` (full spec index) |

**Editing tests in a directory ⇒ read that directory's `README.md` first** —
per-feature coverage policies live next to the tests they govern (e.g.
`apps/mobile/app/__tests__/sync/README.md`), not in the specs.

Product and domain details are maintained in the specs above — do not duplicate
them here.

## Planning is optional and ephemeral

How work is planned is the user's choice: no plan, a single plan doc, a
milestone with task cards, or anything else. Milestones and task cards are one
optional workflow (`docs/plans/README.md`). Every planning doc lives under
`docs/plans/**` and is deleted once its work ships; git history keeps it.
Durable decisions belong in `docs/specs/**`, and a PR updates the owning spec
when it ships the decision.

`docs/plans/**` and `docs/brainstorms/**` are working notes, not
source-of-truth, and may be stale. **Do not read them, and do not let them
steer your work, unless the user points you at a specific plan, task, or
brainstorm.** Source-of-truth lives in `docs/specs/**`, `AGENTS.md`, and
`RUNBOOK.md`.

## Pull requests

Keep PR bodies lean and data-driven — follow `.github/pull_request_template.md`:
**Objective / Tests / Review hard / Deviations**, using data and `file:line`
pointers, not prose (~25 lines; link, don't quote). The **Tests** section must list
every gate lane from `docs/specs/02-quality-and-test-gates.md` with ✅ ran / ⛔ N/A
and a result + evidence link for each — "CI green" alone is not enough, and every
⛔ must cite the path-trigger rule it relies on. Get the rules from
`./boga test for` (it prints what your diff requires and why); validate the body
with `./boga pr check --body <file>` before opening — CI runs the same check.
