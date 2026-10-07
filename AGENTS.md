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
   it aggregates the measured per-run records every `./boga test` lane run
   writes automatically to this machine's store (`~/.config/boga/timings/`,
   shared by all worktrees). If a lane has no data, run it; the gate records
   it. Estimating a duration is an error.

3. **Jest always; slower lanes by agreement with the operator** (the human you
   are working with). Run the agreed lanes to green before opening the PR.
   `./boga` is the single entrypoint (runnable from anywhere in the repo;
   lanes defined in `scripts/lanes.tsv`; `./boga test --list` shows everything):

   ```bash
   ./boga test fast       # mobile + docs/meta + consent/MCP unit + backend fast smoke
   ./boga test backend    # local Supabase: auth/agent/sync contracts + MCP smoke
   ./boga test frontend   # iOS sim: every Maestro lane (the frontend-ui lanes + auth-profile + sync e2e + groups e2e)
   ./boga test frontend-ui  # iOS sim: the lanes that need no backend — the default for a screen/component change
   ```

   Path defaults (`./boga test for` prints them for your diff):

   | You changed… | Default |
   | --- | --- |
   | Any `apps/mobile` TS/JS logic | `boga test fast` |
   | UI screens / components / navigation | `boga test fast` + `boga test frontend-ui` (+ the area e2e lane `boga test for` prints) |
   | Root layout / root stack / route access (`app/_layout.tsx`, `components/navigation/root-stack.tsx`) / Maestro harness or runtime scripts | `boga test fast` + `boga test frontend` |
   | Sync / boot / auth (`src/sync/**`, `src/auth/**`, scheduler, drizzle/migrations) | `boga test fast` + `boga test backend` + `boga test ios-sync-e2e` (UI↔server e2e) |
   | Backend (`supabase/migrations/**`, functions, RLS, sync RPCs) | `boga test backend` |
   | Groups (`src/groups/**`, `supabase/migrations/*group*`) | the rows above + `boga test groups-api-live` (client ↔ live server) + `boga test ios-groups-e2e` (two-user e2e) |
| Group competitions (`src/groups/competition-*`, `supabase/migrations/*competition*`) | the Groups row + `boga test groups-protocol4` (the one-way protocol-4 cutover; not in `boga test backend`) |
   | Agent consent web (`apps/agent-auth-web/**`) | `boga test fast` |
   | MCP service (`services/boga-mcp/**`) | `boga test fast` + `boga test mcp-smoke` |
   | Native iOS dependency / config-plugin change | `./boga ios build-client --force` first, then `boga test frontend` (see `02`) |

   - **Jest is never optional:** every code change adds or updates Jest
     coverage for the behaviour it changes and passes `boga test fast`.
   - **The table is a default, not a rule.** Before running any lane beyond
     `boga test fast`, propose a lane set to the operator — the default lowered or
     raised by judgement (`cosmetic`, `copy-only`, `test-only`, `docs-only`,
     `covered-by-jest`; definitions in spec `02`, "Choosing lanes") — and run
     what they agree.
   - **Maestro is minimal.** Run only the lanes whose flows exercise the change.
     Adding a Maestro flow or scenario needs a justification (why Jest cannot
     prove it) and the operator's approval first; every flow states what it
     proves (spec `06`, "Maestro scope policy").
   - **Quality targets — run once before the PR.** Not in CI and not in
     `boga test fast`, so nothing runs them for you: on the finished change run
     `./boga test jest-coverage`, `./boga test complexity` and
     `./boga test dependencies`, get all three green, and list them in the PR's
     Tests table.
     - Coverage floor (whole suite, `app`/`components`/`src`): **80% branches,
       80% lines**. Branches is the tight one (82% when the floor landed).
     - Per function: cognitive complexity **≤ 25**, **≤ 200** lines,
       nesting depth **≤ 4**, **≤ 5** params.
       Functions already over a limit are grandfathered in
       `apps/mobile/eslint-complexity-suppressions.json`; that list only
       shrinks (`npm run lint:complexity -- --prune-suppressions` after you
       split one).
     - Import direction (dependency-cruiser): no import cycles (type-only
       included); `src/**` never imports `app/**` or `components/**`;
       `src/data` imports only lower layers; `src/exercise-calculations`
       imports only itself and `src/bodyweight/as-of.ts`. Existing violations
       are grandfathered in
       `apps/mobile/dependency-cruiser-known-violations.json`; shrink it with
       `npm run lint:deps:prune` after you fix one.
     - Meet a target by adding tests, splitting the function or moving the
       code to the layer a rule allows. Lowering a threshold or adding a
       suppression or baseline entry needs the operator's agreement.
       Details: spec `02`, "Quality targets".
   - **The full sweep** (`./boga sweep --ref <ref>`, every lane in its own
     worktree) is required only before a release build. Otherwise suggest it to
     the operator when `boga test for` flags it; they decide.

   Once the worktree holds a slot lease (rule 5), the gates bootstrap deps and
   the local Supabase stack themselves; Docker must be running for the slow lanes. Full lane matrix, CI posture, and the dev-client
   rebuild rule: `docs/specs/02-quality-and-test-gates.md`.

4. **The sync-infra and sync-e2e lanes run locally — do not defer them.** Each
   worktree has its own slot-isolated local Supabase; the wrappers export
   `SYNC_TEST_SUPABASE_URL`/`SYNC_TEST_SUPABASE_ANON_KEY` themselves. There is
   no remote-only test lane in this repo.

5. **You own your worktree from open to merge.** Nothing cleans up after you
   (spec `01`; contract `12`). Work always happens in a local worktree unless
   the user says otherwise (cloud containers have no iOS simulator).
   - **Open:** `./boga worktree create <branch>` (new worktree from the latest
     `origin/main`), or `./boga worktree start` inside a worktree your harness
     made. It fails unless the worktree contains the latest `origin/main`; pass
     `--base`/`--from <ref>` only when told to. Every `./boga test|db|ios|env`
     command, Supabase script, and Maestro run fails hard without this slot lease.
   - **PR opened:** `./boga db down`. Optional: `./boga pr wait` in the
     background to notice the merge.
   - **PR merged:** you clean up in the same session — `./boga worktree release`
     removes the slot's Supabase containers/volumes, the lease, and the
     worktree. PR closed unmerged: ask the human first.
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
- `docs/product/` — every file: the product decisions (what counts, how
  figures are computed and shown, screen copy), one fact per ID
  (`docs/product/README.md`). Never decide an `open` fact or change an
  `accepted` one without the product owner's approval: stop and ask. An
  approved fact change may ship in the PR that implements it.

## Load on demand (by task area)

| If your task touches… | Also load |
| --- | --- |
| UI / screens / components / navigation | `docs/specs/08-ux-delivery-standard.md`, `docs/specs/ui/README.md`, `docs/specs/ui/ai-design-policy.md` |
| Data model / schema / migrations / sync scope | `docs/specs/05-data-model.md` |
| Sync (data model, server schema, push/pull RPC, drift) | `docs/specs/05-data-model.md`, `docs/specs/tech/sync-v2-server-contract.md` |
| Auth / RLS / backend API | `docs/specs/10-api-authn-authz-guidelines.md`, `supabase/README.md` |
| Stats, records, PRs, volume/1RM, set or session counts (`src/exercise-calculations`, `src/data/*stats*`, facts, progress) | `docs/specs/tech/training-metrics-contract.md` |
| Groups (group tables/RPCs, share trigger, `src/groups`, group screens) | `docs/specs/tech/groups-contract.md`, `docs/specs/10-api-authn-authz-guidelines.md` |
| Maestro / iOS e2e flows or harness | `docs/specs/11-maestro-runtime-and-testing-conventions.md`, `apps/mobile/README-maestro.md` |
| Worktree lifecycle (open / release / repair), slot-lease errors, or isolation bugs | `docs/specs/01-worktree-and-environment.md` (everyday), `docs/specs/12-worktree-config-and-isolation.md` (deep contract) |
| Cleaning up leftover worktrees, leases, or Supabase stacks | `docs/procedures/worktree-cleanup.md` (follow it step by step) |
| A stored or published figure's rule (calculation, eligibility, records), a `*_RULES_VERSION` / `METRIC_REVISION`, or the sync protocol | `docs/procedures/rule-upgrade.md` |
| Deep testing strategy / adding or changing a test lane | `docs/specs/06-testing-strategy.md` |
| Data import (GymBook / JSON) | `apps/mobile/scripts/import/BOGA_IMPORT_JSON_CONTRACT.md` |
| Human local-dev ops (run/build/debug, logs, reset) | `RUNBOOK.md` |
| Product/domain context | `docs/specs/00-product.md`, `docs/specs/README.md` (full spec index) |

**Editing tests in a directory ⇒ read that directory's `README.md` first** —
per-feature coverage policies live next to the tests they govern (e.g.
`apps/mobile/__tests__/sync/README.md`), not in the specs.

Product and domain details are maintained in the specs above — do not duplicate
them here.

## Persistent docs have word budgets

Every doc reachable from this file has a word budget
(`scripts/doc-budgets.tsv`; `./boga docs budgets` prints each doc's count). A
doc over its budget is split or trimmed — never given a bigger budget without
the operator's agreement. Every link to another doc sits behind a load trigger
("if you are changing X, load Y"). `docs-check` enforces the budgets and that
every repo path a doc cites exists. Before writing, splitting or trimming a
persistent doc, load `docs/specs/README.md` ("Doc rules").

## Planning is optional and ephemeral

How work is planned is the user's choice: no plan, a single plan doc, a
milestone with task cards, or anything else. Milestones and task cards are one
optional workflow (`docs/plans/README.md`). Every planning doc lives under
`docs/plans/**` and is deleted once its work ships; git history keeps it.
Durable decisions belong in `docs/specs/**`, and a PR updates the owning spec
when it ships the decision.

**Never reference a plan from code or docs**: no `docs/plans/...` path and no
task/milestone ID (`M<n>-T<nn>`, `T-<YYYYMMDD>-<nn>`) in code, tests, flows,
migrations, specs, or other docs — state the rule itself in the owning spec.
Commit messages and PR bodies may cite them. `docs-check` enforces both halves;
already-applied migrations are exempt (`scripts/plan-ref-exempt.txt`).

**Task protocol.** When the user wants to plan multi-PR work together, or hands
you a task card to execute, offer the task protocol in
[`docs/plans/README.md`](docs/plans/README.md#task-protocol-boga)
(Claude Code: the user-level `/task-protocol` skill): plan together → one session per task → task-level
design → build → review agent → PR → user review → merge → offer next cards →
clean up the worktree and its stack.

`docs/plans/**` and `docs/brainstorms/**` are working notes, not
source-of-truth, and may be stale. **Do not read them, and do not let them
steer your work, unless the user points you at a specific plan, task, or
brainstorm.** Source-of-truth lives in `docs/specs/**`, `AGENTS.md`, and
`RUNBOOK.md`.

## Pull requests

Keep PR bodies lean and data-driven — follow `.github/pull_request_template.md`:
**Objective / Tests / Review hard / Deviations**, using data and `file:line`
pointers, not prose (~25 lines; link, don't quote). The **Tests** section lists
the lanes that ran, each with its result and an evidence link ("CI green" alone
is not enough), and notes that the set was agreed with the operator, including
any default lane skipped and the reason. Before opening it, run
`docs/product/REVIEW.md` on the branch diff next to `/code-review`, and put
its verdict on the Tests section's `Product facts:` line.
