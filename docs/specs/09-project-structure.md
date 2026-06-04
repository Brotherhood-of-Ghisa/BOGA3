# Project Structure (Current + Conventions)

## Purpose

Define the canonical repository structure, path ownership, and placement conventions so implementation and test assets land in predictable locations.

## Maintenance rule

- Update this document in the same task/session when significant project-structure changes are made (for example new top-level folders, workspace moves, canonical test-location changes, or path-convention changes).
- Minor file additions within an existing well-defined folder usually do not require updates.

## Current repository structure (verified 2026-03-02)

```text
/
  AGENTS.md
  hooks/                        # Git hook sources installed into shared .git/hooks by setup scripts
  scripts/                       # Repo-level cross-workspace wrappers (quality gates, orchestration)
  apps/
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
  supabase/                      # Supabase backend root (M5 local runtime + backend assets)
    config.toml.template         # Checked-in Supabase local config template
    config.toml                  # Generated per-worktree local config (gitignored)
    migrations/                  # Postgres migrations
    seed.sql                     # Deterministic local seed fixtures
    functions/                   # Edge Functions (including health smoke endpoint)
    scripts/                     # Backend local runtime/test wrapper scripts
    tests/                       # Backend-local smoke/integration test entrypoints
  docs/
    specs/                       # Project/milestone/task process and technical specs
      ui/                        # Canonical UI discovery/audit/guardrail docs (M8+)
      tech/                      # Subsystem-level technical deep-dive docs (M13+)
    tasks/                       # Active task cards
      complete/                  # Completed task-card archive
    brainstorms/                 # Working notes and brainstorming docs
```

## Workspace ownership (current)

- `apps/mobile/`
  - owns the mobile app code, mobile-only tests, mobile SQLite schema artifacts, Maestro flows/config, and mobile test helper scripts.
- `apps/mobile/components/ui/`
  - owns the canonical mobile UI tokens + primitive components introduced in M8 for reuse across route screens and specialized shared components.
- `apps/mobile/src/auth/`
  - owns shared mobile auth integration modules such as the Supabase client bootstrap, auth storage adapter, session service, and React provider/hook surface.
- `apps/mobile/.maestro/`
  - owns committed Maestro flow definitions and the checked-in sample config file (`maestro.env.sample`).
  - the per-worktree file `apps/mobile/.maestro/maestro.env.local` is canonical but remains untracked/local-only.
- `scripts/`
  - owns repo-level cross-workspace wrappers (for example standard local quality-gate commands).
  - owns BOGA worktree setup/orchestration/cleanup helpers (`worktree-create.sh`, `worktree-setup.sh`, `worktree-doctor.sh`, `worktree-sweep.sh`, `worktree-clean.sh`, `worktree-lib.sh`, `boga-config-init.sh`).
- `hooks/`
  - owns checked-in Git hook source files.
  - hook files are installed into the shared `.git/hooks/` directory by `scripts/worktree-setup.sh`; they are not executed directly from this folder by Git.
- `apps/mobile/artifacts/maestro/`
  - owns generated Maestro runtime artifacts, screenshots, and lifecycle logs (`runtime.env`, `provision.log`, `launch.log`, `teardown.log`, `expo-start.log`, `maestro-junit.xml`).
- `docs/specs/`
  - owns project policy, architecture/testing strategy, milestone specs, and templates.
- `docs/specs/ui/`
  - owns authoritative UI discovery/audit/guardrail documentation produced in M8+ tasks.
- `docs/specs/tech/`
  - owns subsystem-level technical deep-dive docs that complement (but do not replace) top-level architecture/testing docs.
- `docs/tasks/`
  - owns active per-session execution task cards (`planned`, `in_progress`, `blocked`).
- `docs/tasks/complete/`
  - owns completed task cards after closeout.
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
- `docs/tasks/complete/`
  - canonical archive location for task cards whose status is `completed`.
  - move a task card here in the same session that marks it `completed`.
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
- `hooks/`
  - canonical location for checked-in Git hook sources.
- `.worktree-slot`
  - canonical gitignored per-worktree slot identity file at repo root.
  - generated by `./scripts/worktree-setup.sh`.
  - must not be committed.
- `apps/mobile/scripts/`
  - keep Maestro runtime/toolkit wrappers here (`maestro-env.sh`, `maestro-ios-*.sh`) rather than introducing a separate top-level test-runtime folder.
- `apps/mobile/scripts/import/`
  - canonical home for mobile-local import digestion tooling and import handoff contract docs.
  - source-specific digesters here convert third-party exports into BOGA-friendly JSON only; generic importers or DB-writing tools must be documented separately and must not commit private export data.
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
