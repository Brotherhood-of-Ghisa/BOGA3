# Project Structure (Current + Conventions)

> **Owns:** repo layout, path ownership, placement conventions. **Not here:** worktree environments → `01`/`12`. **Load when:** always (always-load).

## Purpose

Define the canonical repository structure, path ownership, and placement conventions so implementation and test assets land in predictable locations.

## Maintenance rule

- Update this document in the same task/session when significant project-structure changes are made (for example new top-level folders, workspace moves, canonical test-location changes, or path-convention changes).
- Minor file additions within an existing well-defined folder usually do not require updates.

## Current repository structure (verified 2026-07-25)

```text
/
  AGENTS.md
  scripts/                       # Repo-level cross-workspace wrappers (quality gates, orchestration)
  apps/
    agent-auth-web/              # Static Supabase OAuth consent application
    mobile/                      # Expo React Native app (current primary codebase)
      app/                       # Expo Router routes/screens
      app/__tests__/             # Current app-side test location (legacy/needs rationalization)
      components/                # UI components
        ui/                      # Canonical UI tokens + primitives foundation (M8+)
      src/                       # Non-route app code (domain/data/helpers)
        auth/                    # Shared mobile auth client/session/provider modules (M11+)
      drizzle/                   # Mobile local DB schema/migrations artifacts
      .maestro/                  # Maestro flows + sample config
      scripts/                   # Mobile/maestro helper scripts
      artifacts/maestro/         # Maestro output artifacts, runtime state, and logs
  services/
    boga-mcp/                    # Public read-only MCP protocol/API adapter
  supabase/                      # Supabase backend root (M5 local runtime + backend assets)
    config.toml.template         # Checked-in Supabase local config template
    config.toml                  # Generated per-worktree local config (gitignored)
    migrations/                  # Postgres migrations
    seed.sql                     # Deterministic local seed fixtures
    functions/                   # Edge Functions (health + dedicated agent API)
    scripts/                     # Backend local runtime/test wrapper scripts
    tests/                       # Backend-local smoke/integration test entrypoints
  docs/
    specs/                       # Source of truth: product, architecture, testing, and technical specs
      ui/                        # Canonical UI discovery/audit/guardrail docs (M8+)
      tech/                      # Subsystem-level technical deep-dive docs (M13+)
    procedures/                  # Step-by-step procedures any agent harness follows
    plans/                       # Optional, ephemeral planning docs (any shape; deleted when shipped)
    brainstorms/                 # Working notes and brainstorming docs
```

## Workspace ownership (current)

- `apps/mobile/`
  - owns the mobile app code, mobile-only tests, mobile SQLite schema artifacts, Maestro flows/config, and mobile test helper scripts.
- `apps/agent-auth-web/`
  - owns the static Supabase OAuth consent and sign-in surface. It may contain
    only public Supabase browser configuration; protocol/token issuance stays
    in Supabase Auth.
- `services/boga-mcp/`
  - owns the public MCP Streamable HTTP adapter, OAuth protected-resource
    metadata, static tool contracts, and dedicated BoGa agent-API client.
  - must never own database/Supabase data clients, SQL, a database URL, or a
    service-role credential.
- `apps/mobile/components/ui/`
  - owns the canonical mobile UI tokens + primitive components introduced in M8 for reuse across route screens and specialized shared components.
- `apps/mobile/src/groups/` (M22)
  - owns the non-UI group client: wire types, the typed group RPC client (the only mobile code that calls Supabase for groups), `group_cache` access, the pure stream view model, the group NetInfo hook, and the resource/action hooks screens use (`docs/specs/tech/groups-contract.md` §6.1).
  - group screens under `app/**` consume it through `@/src/groups`; group code never runs inside the sync cycle and must not modify `src/sync/**` beyond the `group_cache` delete in the account wipe.
  - `set-facts.ts` (M25) is the one implementation of the group set rules, shared with the `group-eval` Edge Function, which loads it by relative path: it may import only by relative `.ts` specifier (never `@/`), and only modules that follow the same rule.
- `apps/mobile/src/exercise-core/` (M25)
  - owns `ExerciseCore` (`{ name, loadInputMode }`), the load-mode list, and `validateExerciseCore`: the one rule set that personal exercises (`src/data/exercise-catalog.ts`) and group exercises (`src/groups/api.ts`) share. It also owns `exercise-core-vectors.json`, which `groups-contract` runs against the server as well.
  - imports nothing, so an Edge Function can load it by relative path.
- `apps/mobile/src/auth/`
  - owns shared mobile auth integration modules such as the Supabase client bootstrap, auth storage adapter, session service, and React provider/hook surface.
- `apps/mobile/.maestro/`
  - owns committed Maestro flow definitions (`flows/`), their `runScript` helpers (`scripts/`, e.g. the scripted counterparty of the two-user groups flow), and the checked-in sample config file (`maestro.env.sample`).
  - the per-worktree file `apps/mobile/.maestro/maestro.env.local` is canonical but remains untracked/local-only.
- `scripts/`
  - owns repo-level cross-workspace wrappers (for example standard local quality-gate commands).
  - owns the BOGA worktree lifecycle scripts (`worktree-create.sh`, `worktree-start.sh`, `worktree-ls.sh`, `worktree-release.sh`, `worktree-doctor.sh`, `worktree-lib.sh`, `boga-config-init.sh`, `pr-wait.sh`).
  - owns cross-workspace MCP/consent test wrappers and the real OAuth-to-MCP
    smoke harness.
- `supabase/functions/agent-api/`
  - owns the authenticated, read-only BoGa3 agent HTTP API. This is the only
    service-role data boundary in the Virtual Coach flow; every query derives
    and filters by the validated OAuth subject.
- `supabase/functions/group-eval/` (M25)
  - owns the group evaluator: it drains `group_eval_queue` for the pg_net kick and pg_cron sweep, normalizes shared sets with `apps/mobile/src/groups/set-facts.ts`, and writes only through the service-role-only `group_eval_*` RPCs (`docs/specs/tech/groups-contract.md` §2.10). It has no client-facing API.
- `supabase/tests/lib/`
  - owns helpers sourced by more than one backend lane body (for example `groups-fixtures.sh`, shared by `groups-contract` and `groups-leaderboards`); files here are never lane bodies themselves.
- `docs/procedures/`
  - owns step-by-step procedures that any agent harness follows when `AGENTS.md` routes to them (for example `worktree-cleanup.md`). A procedure states when to run it, its rules, and exact commands; the contracts it applies stay in `docs/specs/**`.
- `apps/mobile/artifacts/maestro/`
  - owns generated Maestro runtime artifacts, screenshots, and lifecycle logs (`runtime.env`, `provision.log`, `launch.log`, `teardown.log`, `expo-start.log`, `maestro-junit.xml`).
- `docs/specs/`
  - owns project policy, product, architecture/testing strategy, and technical contracts (the durable source of truth).
- `docs/specs/ui/`
  - owns authoritative UI discovery/audit/guardrail documentation produced in M8+ tasks.
- `docs/specs/tech/`
  - owns subsystem-level technical deep-dive docs that complement (but do not replace) top-level architecture/testing docs.
- `docs/plans/`
  - owns optional, ephemeral planning docs in whatever shape the user chooses (a single plan, or `milestones/` + `tasks/` from the starter templates in `templates/`). See `docs/plans/README.md`.
  - not source of truth. A planning doc is deleted once its work ships; git history keeps it.
- `docs/brainstorms/`
  - owns non-authoritative ideation notes (helpful context, not source of truth).
- `supabase/`
  - owns local Supabase backend config, migrations, seeds, Edge Functions, and backend-local test/runtime wrappers.
  - `supabase/config.toml.template` is tracked; `supabase/config.toml` is generated per worktree and gitignored.

## Agreed structure conventions (M5+ additions)

- `supabase/` (introduced in M5)
  - backend root for local Supabase project assets (migrations, seeds, functions, and backend-local tests).
- `docs/specs/ui/` (introduced in M8)
  - canonical location for authoritative UI discovery/audit/guardrail docs (for example repo discovery baseline, pattern audit, screen map, navigation contract, components catalog, UX rules).
  - keep UI docs under `docs/specs/ui/**` rather than `docs/brainstorms/**` once they become source-of-truth references.
- `docs/specs/tech/` (introduced in M13)
  - canonical location for subsystem-level technical deep dives (for example client sync engine internals, failure handling, and maintenance contracts).
  - keep deep-dive docs concise, source-linked, and update them in the same task when subsystem behavior materially changes.
- `docs/plans/` lifecycle
  - there is no in-repo archive for plans, milestones, or task cards: delete them in the change that ships or abandons their work (git history keeps them). Durable decisions move into the owning `docs/specs/**` doc in the PR that ships them.
- `apps/mobile/.maestro/flows`
  - remains the canonical location for Maestro flow definitions.
- `apps/mobile/.maestro/maestro.env.sample`
  - checked-in sample for per-worktree Maestro configuration.
- `apps/mobile/.maestro/maestro.env.local`
  - canonical untracked per-worktree Maestro config file.
- `apps/mobile/artifacts/maestro/`
  - canonical runtime artifact root for Maestro runs.
  - each run writes task/timestamp-scoped subdirectories plus `runtime.env` and lifecycle logs under that root.
- `apps/mobile/components/ui/` (introduced in M8)
  - canonical location for mobile UI tokens and primitive components used by shared/screen UI code.
  - keep specialized feature components (for example navigation/session-layout components) in domain folders under `apps/mobile/components/**`; compose primitives from `apps/mobile/components/ui/**`.
- `apps/mobile/src/auth/` (introduced in M11)
  - canonical location for shared mobile auth modules.
  - keep Supabase auth bootstrap/session/provider code here rather than scattering route-local client wiring under `app/**`.
- `apps/mobile/src/utils/isDevMode.ts`
  - canonical dev-mode guard for the mobile app.
  - returns `true` for Metro dev bundles (`__DEV__`) **and** for the `com.phano.boga3.dev` EAS build (TestFlight dev), so developer-only UI / escape hatches (e.g. the local-data reset on the Settings screen, the Maestro harness route) stay available on internal builds.
  - **Never use `__DEV__` directly** outside this file — production-bundled TestFlight builds set it to `false`, and a `no-restricted-syntax` ESLint rule will reject it. Import `isDevMode` from `@/src/utils/isDevMode` instead.
- `e2e/` (reserved)
  - reserved for cross-stack orchestration/tests that span mobile + backend.
  - strategy may be documented before implementation exists.
- `scripts/` (repo root)
  - canonical location for repo-level cross-workspace wrappers (for example `./scripts/quality-fast.sh`, `./scripts/quality-slow.sh`).
  - keep workspace-specific wrappers in the owning workspace (for example `apps/mobile/scripts/**`, `supabase/scripts/**`).
  - canonical location for worktree setup and diagnostics wrappers.
- `.worktree-slot`
  - canonical gitignored per-worktree slot identity file at repo root; half of the slot lease (`docs/specs/12-worktree-config-and-isolation.md`).
  - written only by `./boga worktree start`.
  - must not be committed.
- `apps/mobile/scripts/`
  - keep Maestro runtime/toolkit wrappers here (`maestro-env.sh`, `maestro-ios-*.sh`) rather than introducing a separate top-level test-runtime folder.
- Mobile test-directory refactor
  - moving tests out of `apps/mobile/app/__tests__/` is a valid follow-up improvement, but it must be done in a dedicated task (not mixed into unrelated backend work).

## Placement guidance

- Put code near the runtime/workspace that owns it:
  - mobile app code/tests in `apps/mobile/**`
  - Supabase backend assets in `supabase/**`
  - cross-stack orchestration in repo-root `e2e/**` and/or shared `scripts/**` (as documented)
- Prefer one canonical location per test/tool type and document exceptions in `docs/specs/06-testing-strategy.md`.
- If a new folder becomes canonical for a subsystem or test type, update this doc and any impacted templates/playbook references in the same task.

## Known cleanup opportunities (tracked)

- Rationalize mobile test placement currently under `apps/mobile/app/__tests__/` into a dedicated mobile test directory (deferred to a dedicated follow-up task).
- Optional follow-up: add a repo-root command alias surface (for example root `package.json` script aliases) if ergonomics justify it; current canonical wrappers are `./scripts/quality-fast.sh` and `./scripts/quality-slow.sh`.
