# AGENTS.md

This file is the session entrypoint and router. It defines the small set of docs
every session loads, and where to find everything else **only when a task needs
it**. It deliberately holds no deep content — facts live in one place each, linked
below, so they can't drift across copies.

## Always load (every session)

Four short docs. They answer: how do I set up and run, how do I verify, what are
the tech choices, and where does code live?

- `docs/specs/01-worktree-and-environment.md` — set up / tear down a worktree
  environment (the slot model in one line; deep contract is `12`).
- `docs/specs/02-quality-and-test-gates.md` — quality/test gates, what's
  mandatory, and how to run each lane. **This machine runs every lane — incl. the
  iOS Maestro and local-Supabase slow gates. "Not in CI" means run it locally,
  never "can't run"; verify capability with the commands there before deferring.**
- `docs/specs/03-technical-architecture.md` — high-level technical choices and the
  decision register.
- `docs/specs/09-project-structure.md` — repo layout, path ownership, placement
  conventions.

That's the minimum. Do not pre-load the docs below; pull them in when your task
enters their area.

## Load on demand (by task area)

| If your task touches… | Also load |
| --- | --- |
| UI / screens / components / navigation | `docs/specs/08-ux-delivery-standard.md`, `docs/specs/ui/README.md` (index → load only the bundle docs you need) |
| Data model / schema / migrations / sync scope | `docs/specs/05-data-model.md` |
| Sync (data model, server schema, push/pull RPC, drift) | `docs/specs/05-data-model.md`, `docs/specs/tech/sync-v2-server-contract.md` |
| Auth / RLS / backend API | `docs/specs/10-api-authn-authz-guidelines.md`, `supabase/README.md` |
| Maestro / iOS e2e flows or harness | `docs/specs/11-maestro-runtime-and-testing-conventions.md`, `apps/mobile/README-maestro.md` |
| Worktree internals / isolation / slot model / cross-worktree bugs | `docs/specs/12-worktree-config-and-isolation.md` (deep contract; the everyday setup/teardown is in `01`) |
| Deep testing strategy / adding or changing a test lane | `docs/specs/06-testing-strategy.md`, `docs/testing/local-test-timings.md` |
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
and a result + evidence link for each — "CI green" alone is not enough.
