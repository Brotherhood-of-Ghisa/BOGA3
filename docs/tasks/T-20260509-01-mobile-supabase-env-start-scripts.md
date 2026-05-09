---
task_id: T-20260509-01-mobile-supabase-env-start-scripts
milestone_id: "M14"
status: planned
ui_impact: "no"
areas: "frontend|backend|docs"
runtimes: "node|expo|supabase"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "N/A"
docs_touched: "RUNBOOK.md, apps/mobile/package.json, supabase/scripts/* as needed"
---

# Task Card

## Task metadata

- Task ID: `T-20260509-01-mobile-supabase-env-start-scripts`
- Title: Mobile Supabase hosted/local Expo start scripts
- Status: `planned`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-05-09`
- Session interaction mode: `interactive (default)`

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M14-observability-and-diagnostics.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- Worktree/runtime isolation: `docs/specs/12-worktree-config-and-isolation.md`
- Runbook: `RUNBOOK.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit:
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `no` - task card was created as a follow-up note during an interactive troubleshooting session; perform normal freshness checks before implementation.
- Parent refs opened in this session:
  - `docs/specs/templates/task-card-template.md`
  - `docs/tasks/README.md`
  - `apps/mobile/package.json`
  - `supabase/scripts/local-runtime-up.sh`
  - `supabase/.env.hosted.example`
  - `supabase/.env.local.example`
  - `RUNBOOK.md`
- Code/docs inventory freshness checks run:
  - `rg` for `EXPO_PUBLIC_SUPABASE`, `env.hosted`, `env.local`, and hosted/local script usage - current as of `2026-05-09`
- Known stale references or assumptions:
  - `supabase/.env.hosted` is machine-local and may not be populated on every developer machine.
  - `apps/mobile/.env.local` is the Expo-consumed env file; `supabase/.env.local` is a Supabase CLI/script config file, not the mobile app backend selector.
- Optional helper command (recommended):
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260509-01-mobile-supabase-env-start-scripts.md`

## Objective

Add clear mobile start commands for hosted and local Supabase modes so developers can run the Expo app against the intended backend without manually editing env files or accidentally testing against the wrong database.

## Scope

### In scope

- Add mobile/package script(s) for hosted Supabase startup, for example `npm run start:hosted`.
- Add mobile/package script(s) for local Docker Supabase startup, for example `npm run start:local`.
- Reuse existing Supabase env-switching helpers instead of duplicating credential parsing.
- Ensure commands print clear restart/cache behavior and the selected backend.
- Update `RUNBOOK.md` with the canonical hosted/local Expo startup commands.
- Add or update small shell/helper checks if needed for script syntax and failure modes.

### Out of scope

- Deploying or applying hosted database migrations.
- Changing Supabase Auth/provider configuration.
- Adding production release/EAS environment automation.
- Adding UI changes or user-facing environment switching.
- Storing hosted secrets in the repo.

## UI Impact (required checkpoint)

- UI Impact?: `no`
- Rationale: this task changes developer startup commands and environment selection only; it does not alter app screens, routes, navigation, visual appearance, or user-facing behavior.

## Acceptance criteria

1. A developer can run a documented command from `apps/mobile` to point Expo at hosted Supabase and start Metro.
2. A developer can run a documented command from `apps/mobile` to point Expo at local Docker Supabase and start Metro.
3. Hosted mode reads from `supabase/.env.hosted` and fails clearly if `SUPABASE_URL` or `SUPABASE_ANON_KEY` is missing.
4. Local mode starts or reuses Docker Supabase through the existing local runtime wrapper and updates `apps/mobile/.env.local` to local values.
5. Unrelated entries in `apps/mobile/.env.local` are preserved when switching modes.
6. Documentation states that Expo/Metro must be restarted or cache-cleared after switching backend targets.
7. The distinction between `supabase/.env.local` and `apps/mobile/.env.local` is documented to avoid future confusion.

## Docs touched (required)

- Planned docs/spec files to update and why:
  - `RUNBOOK.md` - canonical operator commands for hosted/local mobile startup and backend switching.
  - `apps/mobile/package.json` - add start script aliases if implementation chooses package scripts.
  - `supabase/scripts/use-hosted-mobile-env.sh` - reuse or adjust if needed for package-script ergonomics.
  - `supabase/scripts/local-runtime-up.sh` - only if needed to support non-interactive local mobile start ergonomics.
- Project-level docs:
  - `docs/specs/09-project-structure.md` update only if new canonical script locations or path conventions are introduced.
  - `docs/specs/06-testing-strategy.md` update only if verification expectations change beyond local command ergonomics.

## Testing and verification approach

- Planned checks/commands:
  - `bash -n supabase/scripts/use-hosted-mobile-env.sh`
  - syntax check any new shell wrapper(s)
  - run hosted env switch in a controlled way only when hosted credentials are configured
  - run local env switch through `./supabase/scripts/local-runtime-up.sh` only if Docker runtime testing is in scope for the implementation session
  - `cd apps/mobile && npm run typecheck`
- Standard local gate usage:
  - `./scripts/quality-fast.sh frontend` if package scripts or mobile config changes are made.
  - `./scripts/quality-slow.sh frontend`: `N/A` unless Maestro/runtime-sensitive mobile startup behavior is changed.
- Test layers covered:
  - shell syntax checks
  - package-script smoke/manual verification
  - frontend typecheck/fast gate as applicable
- Execution triggers:
  - always for script/package changes.
- Slow-gate triggers:
  - `N/A` unless implementation changes Maestro, dev-client build, native runtime, or simulator behavior.
- Hosted/deployed smoke ownership:
  - manual hosted app smoke remains operator-owned; this task only provides safer startup commands.
- CI/manual posture note:
  - CI is absent/partial; record local command output and any manual hosted/local startup proof in the completion note.
- Notes:
  - Avoid printing secret values. Redact anon/service-role keys in logs if any diagnostics are added.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/package.json`
  - `supabase/scripts/use-hosted-mobile-env.sh`
  - optional new wrapper under `apps/mobile/scripts/` or `supabase/scripts/` if package-script ergonomics require it
  - `RUNBOOK.md`
- Project structure impact:
  - No new top-level folders expected.
  - If a new canonical script location is introduced, update `docs/specs/09-project-structure.md`.
- Constraints/assumptions:
  - `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are Expo bundle-time values.
  - `supabase/.env.hosted` is linked to machine-global config and must not be committed with real secrets.
  - `supabase/.env.local` is for Supabase CLI settings, not mobile backend selection.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend` after script/package changes, unless implementation only touches docs and shell helper comments.
- Standard local slow gate: `N/A` unless runtime-sensitive Maestro/dev-client behavior changes.
- Optional closeout validation helper: `./scripts/task-closeout-check.sh docs/tasks/T-20260509-01-mobile-supabase-env-start-scripts.md`
- Additional gate(s):
  - shell syntax checks for touched shell scripts.

## Evidence

- To be filled during implementation.
- Manual verification summary:
  - Record which command was run for hosted mode and local mode, and what `apps/mobile/.env.local` target URL was set to after each command without printing keys.
- Deferred/manual hosted checks summary:
  - Hosted DB migration/smoke validation is not owned by this task unless explicitly added to implementation scope.

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed:
- What tests ran:
- What remains:

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Ensure completion note is filled before handoff.
- If the task changed significant cross-cutting behavior, ensure the relevant project-level docs (`03`, `04`, `05`, `06`) were updated in the same session rather than only the milestone/task docs.
- If significant project-structure changes were made, update `docs/specs/09-project-structure.md` and mention it in completion note.
- Update parent milestone task breakdown/status in the same session if this task becomes part of M14 closeout.
- Run `./scripts/task-closeout-check.sh docs/tasks/T-20260509-01-mobile-supabase-env-start-scripts.md` (or document why `N/A`) before handoff.
