# AI Development Playbook (v0)

## Purpose

Define the minimum scaffolding required before feature development, and standardize how AI sessions consume project context.

## Minimum scaffolding 

1. Project directives/specs exist and are current:
   - `docs/specs/README.md`
   - `docs/specs/00-product.md`
   - `docs/specs/03-technical-architecture.md`
   - `docs/specs/05-data-model.md`
   - `docs/specs/06-testing-strategy.md`
   - `docs/specs/09-project-structure.md`
   - `docs/specs/08-ux-delivery-standard.md` (required for UI tasks)
   - `docs/specs/ui/README.md` (required for UI tasks; load relevant bundle docs from there)
   - `RUNBOOK.md` (human run/test/debug entrypoint; must stay current)
2. This playbook exists and is followed.
3. (If executing a task) A milestone spec exists for the active milestone.
4. (If executing a task) A task card exists for the active coding session.

## Reference hierarchy (source-of-truth chain)

1. Project level:
   - `docs/specs/README.md`
   - `docs/specs/03-technical-architecture.md`
   - `docs/specs/05-data-model.md`
   - `docs/specs/06-testing-strategy.md`
   - `docs/specs/09-project-structure.md`
   - `docs/specs/11-maestro-runtime-and-testing-conventions.md` (required for Maestro runtime/testing work)
   - `docs/specs/12-worktree-config-and-isolation.md` (required for local worktree/runtime isolation, cross-worktree test failures, and parallel-agent setup)
2. Milestone level:
   - `docs/specs/milestones/<milestone-id>.md`
3. Task level:
   - active/in-flight: `docs/tasks/<task-id>.md`
   - completed archive: `docs/tasks/complete/<task-id>.md`

Rule: each lower level must link to its parent(s).
Rule: each lower level may add detail but must not override or relax parent-level constraints.

## Cross-cutting docs maintenance (mandatory)

Milestone specs and task cards capture scoped planning/execution detail, but they do not replace project-level source-of-truth docs.

When a task materially changes cross-cutting behavior, update the relevant project-level docs in the same session:

- `docs/specs/03-technical-architecture.md`
  - for architecture/runtime behavior changes such as sync model, auth-gated sync behavior, conflict policy, offline/online semantics, or new subsystem boundaries
- `docs/specs/04-ai-development-playbook.md`
  - for execution/context-loading workflow changes future agents must follow
- `docs/specs/05-data-model.md`
  - for schema/entity ownership changes, sync-scope boundary changes, or updated data-model invariants
- `docs/specs/06-testing-strategy.md`
  - for new test layers, changed verification expectations, or changed sync/offline/auth coverage requirements
- `RUNBOOK.md`
  - for any change to local run/build/test/debug workflows, script command surfaces, simulator/dev-client setup, Supabase local-runtime/reset steps, test fixture login instructions, or log/artifact access paths

Rule:

- do not leave the authoritative description of significant sync/auth/offline behavior only in milestone/task docs;
- promote stable behavior and verification expectations into the project-level docs above.

## RUNBOOK maintenance rule (mandatory)

- `RUNBOOK.md` is the human-facing local operations guide for this repo.
- Every implementation session must review `RUNBOOK.md`.
- If the session changes any local operator behavior (run/build/test/debug commands, setup/reset paths, credentials, or log locations), update `RUNBOOK.md` in the same session before handoff.
- If behavior did not change, record `RUNBOOK.md reviewed (no changes required)` in the task completion note.

## Data-model change sync gate (mandatory)

Whenever a task changes the data model (add/change/remove entity, relationship, ownership classification, or sync-relevant field), sync impact MUST be addressed in the same task/session.

Required decision (explicit, no implicit defaults):

1. `In sync scope`:
   - update `docs/specs/05-data-model.md`,
   - update sync contract/mapping docs (`supabase/session-sync-api-contract.md` and/or milestone/task docs as applicable),
   - update implementation/tests for sync behavior.
2. `Out of sync scope`:
   - document explicit rationale and boundary in the active task card and `docs/specs/05-data-model.md`,
   - update verification expectations so exclusion is intentional and tested/guarded.

Closeout rule:
- do not mark a data-model-changing task `completed` unless its sync impact decision and required docs/test updates are complete.

## Runtime terminology and gate profiles

Use these definitions when a task says "runtime", "runtime-specific gates", or "runtime-appropriate equivalents".

- `Runtime` (for this playbook):
  - an execution surface with its own process/toolchain and verification commands (not just a folder).
  - examples in this repo: Node/TS workspace (`npm` scripts), Expo mobile runtime + Maestro, local `Supabase` stack, `Supabase` Edge Functions (`Deno`), SQL/`pgTAP`, hosted deployment environments.
- `Runtime-specific gate`:
  - the smallest repeatable verification command(s) that meaningfully validate the changed runtime when default Node gates are not sufficient or not applicable.

## Standard local quality-gate wrappers (M5)

Use these repo-level wrappers as the default local verification entrypoints unless a task card states otherwise:

- `./scripts/quality-fast.sh`
  - runs local fast gates for all currently available areas (`frontend` + `backend`)
  - supports optional area selection: `frontend` or `backend`
- `./scripts/quality-slow.sh`
  - runs local slow gates for all currently available areas (`frontend` + `backend`)
  - supports optional area selection: `frontend` or `backend`
  - task cards must state when this is mandatory (risk-triggered), because slow gates are not always required

Rule:
- task cards should reference these wrappers first, then list only task-specific/manual gates and trigger conditions.

Baseline gate profiles (task cards may tighten these):

1. `Node/TS workspace` (default)
   - `npm run lint`
   - `npm run typecheck`
   - `npm run test`
2. `Supabase` local backend runtime (`supabase/**`, no backend Node workspace introduced)
   - local runtime bring-up (`supabase start` or project wrapper)
   - local migration/reset + seed (`supabase db reset` or project wrapper)
   - fast DB/schema check (`supabase db lint` and/or `supabase test db` when `pgTAP` exists)
   - local API/Edge smoke or contract checks (health/auth/RLS/API path as scoped by task)
3. `Supabase` Edge Functions with custom logic
   - `Deno` unit tests (`deno test`) for function logic (if present)
   - `Supabase-local` integration/contract tests against the real gateway/auth context
4. `Expo` mobile UI/runtime work
   - `apps/mobile` `lint` + `typecheck` + `test`
   - `./scripts/quality-slow.sh frontend` when Maestro/runtime-sensitive changes require real simulator evidence
   - treat `docs/specs/11-maestro-runtime-and-testing-conventions.md` as the authority for reset terminology, per-worktree config, and artifact/log expectations
5. Hosted/deployed environment changes
   - relevant local gates for the changed runtime(s)
   - hosted smoke validation (manual until CI exists; task card must name owner and trigger timing)

Rule: task cards must list the exact gate commands they require; this section only defines baseline expectations.

## Delivery workflow

1. Select one MVP milestone from `docs/specs/00-mvp-deliverables.md`.
2. Write a milestone spec using `docs/specs/templates/milestone-spec-template.md`.
3. Break milestone spec into small task cards using `docs/specs/templates/task-card-template.md`.
4. Execute one task card per AI session (or a tightly related pair only).
5. Update task and milestone docs at end of session:
   - set task `Status` (`completed`, `blocked`, or `outdated`)
   - move task cards marked `completed` or `outdated` from `docs/tasks/` to `docs/tasks/complete/`
   - fill task `Completion note`
   - update milestone `Status` and task breakdown item states
   - update decision log entries when decisions changed
   - update `RUNBOOK.md` when operator-facing workflows/commands changed
6. If a task introduces a new runtime, deployment surface, or test layer, or materially changes cross-cutting architecture/runtime behavior (for example sync/auth/offline/conflict semantics):
   - update `docs/specs/06-testing-strategy.md`,
   - update `docs/specs/03-technical-architecture.md`,
   - update this playbook if execution/verification workflow changes,
   - update relevant template(s) if future tasks need new required fields or checks.

## Git sync workflow (current repo policy)

This repo currently executes task sessions directly on `main` unless a human explicitly instructs otherwise.

Required session sync steps:

1. Start-of-session sync (before edits):
   - sync local `main` with remote `main` (`origin/main`) before reading/writing task files.
   - refresh the active task card `Context Freshness` section (use `./scripts/task-bootstrap.sh <task-card-path>` when available).
2. End-of-task sync (after verification and doc/status updates, before handoff):
   - sync with remote again,
   - resolve merge/rebase conflicts locally if they occur,
   - re-run the smallest relevant verification checks if conflict resolution changes task files.
3. Commit/push ownership:
   - after end-of-task sync and conflict resolution, wait for human input before committing and pushing.

## Task execution protocol (quality-first)

Use this sequence for every task card:

1. Plan:
   - Confirm acceptance criteria.
   - Confirm required tests and commands.
2. Red:
   - Write/update tests first.
   - Run targeted tests and confirm expected failures.
3. Green:
   - Implement minimum code needed for tests to pass.
   - After each meaningful change, run the smallest relevant check (targeted test or gate) before continuing.
4. Refactor:
   - Improve structure without changing behavior.
   - Re-run targeted tests.
   - Re-run the smallest relevant gate after each refactor batch.
5. Verify:
   - Run mandatory quality gates:
     - `./scripts/quality-fast.sh` (default local fast gate; use area-specific form when task scope is intentionally narrower)
     - `./scripts/quality-slow.sh <area>` when the task card's risk triggers require slow local gates (for example Maestro runtime smoke, backend auth/RLS/API contract suites)
     - add runtime-specific gates when wrappers do not cover the changed runtime/layer (for example `deno test`, `pgTAP`, hosted smoke checks)
     - if a wrapper or default `lint/typecheck/test` shape is `N/A` for the task/runtime, document the `N/A` rationale and run the runtime-specific equivalent(s) instead
   - Run task-specific checks if defined.
   - Rule: do not defer all verification to the end; apply targeted checks during development and full gates at closeout.
6. Closeout:
   - Update task completion note with outcomes and remaining risks.
   - Update task `Status` in the task card.
   - Update milestone `Status` + task breakdown state in the milestone card before handoff.

## Test and implementation session policy

Default:

1. Keep test creation and feature implementation in the same task/session using the protocol above.

If complexity/risk justifies it, create additional follow-up task cards:

1. Complex domain logic with many edge cases.
2. Large multi-screen UI flows.
3. High-risk refactors where behavior lock-in is needed first.

## Execution-mode context packet (strict gatekeeper)

Provide these references at execution start:

1. This playbook: `docs/specs/04-ai-development-playbook.md`
2. Active milestone spec
3. Active task card
4. Any changed parent specs
5. `docs/specs/05-data-model.md` (always load when task touches schema/entities/sync scope; update when data-model boundaries change)
6. `docs/specs/09-project-structure.md` (always load for context; update only when task changes paths/layout/conventions)
7. `docs/specs/08-ux-delivery-standard.md` (for UI tasks)
8. `docs/specs/ui/README.md` (for UI tasks; use as the index to load only the relevant UI docs)
9. Relevant `docs/specs/ui/*.md` bundle docs for the task (UI tasks only; usually `ux-rules`, `screen-map`, `navigation-contract`, `components-catalog`)
10. `docs/specs/10-api-authn-authz-guidelines.md` (for backend API/auth work and API-consuming integration tasks)
11. `supabase/session-sync-api-contract.md` (for session sync API work and FE/backend sync integration tasks, when present)
12. `docs/specs/11-maestro-runtime-and-testing-conventions.md` (required for tasks that touch `apps/mobile/.maestro/**`, `apps/mobile/scripts/maestro*`, the Maestro harness/runtime helpers, or that require real iOS simulator smoke validation)
13. `RUNBOOK.md` (always load; update in-session when local operator workflow changes)
14. `docs/specs/12-worktree-config-and-isolation.md` (required when creating/repairing worktrees, changing local runtime setup, or investigating cross-worktree contamination)

## Worktree execution rules

Apply these rules whenever a human or agent session runs in a linked git worktree or investigates local cross-worktree behavior.

1. Run `./scripts/worktree-setup.sh` before local runtime or gate commands if the worktree has not already been initialized.
2. Run `./scripts/worktree-doctor.sh` when tests appear to hit another worktree's Supabase runtime, Metro server, simulator, dependency tree, or generated config.
3. Treat nested BOGA worktrees as a setup bug:
   - do not patch Jest, Vitest, Metro, TypeScript, or watcher config to compensate for nested placement;
   - remove the nested worktree and recreate it outside the checkout with `./scripts/worktree-create.sh <branch-name>`.
4. Do not share `apps/mobile/node_modules` across worktrees.
5. Keep simulator/Metro/Supabase isolation values in generated per-worktree config files, not in shared docs or task cards.

Recommended bootstrap helper (optional but preferred when available):

- `./scripts/task-bootstrap.sh <task-card-path>`
  - prints a start-of-session context/freshness report (git SHA/status, parent refs, missing refs, and gate snippets) to support the task card `Context Freshness` section.

## Maestro task rules

Apply these rules to tasks that change the mobile Maestro runtime, harness, or flows.

1. Load the Maestro contract:
   - include `docs/specs/11-maestro-runtime-and-testing-conventions.md` in the execution packet and task-card parent refs.
2. Declare the slow-gate posture explicitly:
   - task cards must state whether `./scripts/quality-slow.sh frontend` is required or `N/A`;
   - default to `required` when changing `apps/mobile/.maestro/**`, `apps/mobile/scripts/maestro*`, `apps/mobile/app/maestro-harness.tsx`, `apps/mobile/src/maestro/**`, mobile data bootstrap/migrations, or native Expo/SQLite/dev-client dependencies.
3. Use the locked reset terminology:
   - say `full reset`, `data reset`, and `teleport`, not ad hoc equivalents.
4. Keep the contract synthetic:
   - put the full runtime/testing policy only in `docs/specs/11-maestro-runtime-and-testing-conventions.md`;
   - runbooks and task cards should link back to that doc rather than duplicating the whole contract.
5. Record runtime evidence when slow gates run:
   - include the executed command(s) plus artifact roots under `apps/mobile/artifacts/maestro/<task-id-or-ad-hoc>/<timestamp>/`.

## UI docs bundle usage (UI tasks)

Use `docs/specs/ui/README.md` as the entrypoint for app-specific UI docs.

Canonical UI docs maintenance trigger map:

- `docs/specs/ui/README.md` (`Maintenance rules`) is the canonical source for "which UI docs to update when X changes".
- Task templates/task cards may keep a short execution checklist, but should link back to the canonical map rather than redefining it differently.

Update the relevant UI docs in the same task/session when UI-affecting changes land:

1. `screen-map.md`
   - route inventory, screen purpose, or high-level state set changes
2. `navigation-contract.md`
   - route paths, params, redirects, or screen-to-screen transitions change
3. `components-catalog.md`
   - reusable UI tokens/primitives/shared components are added/removed/renamed or their purpose changes
4. `ux-rules.md`
   - app-specific UI semantics/guardrails/pattern conventions change

Authoring rule for `docs/specs/ui/**`:

- keep docs synthetic and overview-first (entrypoint docs),
- link to source files for exact props/variants/implementation details,
- avoid duplicating source code structure/API documentation unless a compact contract summary is necessary to prevent ambiguity.

## UI Development Rules Summary (UI tasks)

Use this section as the quick-start checklist for UI execution. Detailed app-specific rules and inventories live in `docs/specs/ui/**` and `docs/specs/08-ux-delivery-standard.md`.

Non-negotiables for UI-affecting work:

1. Tokens/primitives first:
   - prefer shared tokens/primitives and documented reusable components over screen-local styling;
   - avoid raw color literals and ad hoc spacing/typography/radius values in screen files unless the task explicitly allows an exception and the rationale is recorded.
2. Composition over one-offs:
   - compose existing primitives/patterns before introducing a screen-local one-off;
   - if a one-off is necessary, document why and promote it to a reusable primitive when it becomes repeatable.
3. Same-session UI docs maintenance:
   - update the relevant `docs/specs/ui/*.md` docs in the same task when screens/routes/navigation behavior/components/semantics change;
   - task cards must list the planned UI docs updates (or an explicit no-update rationale).
4. Reusable pattern promotion:
   - new reusable UI patterns must be captured as primitives/shared components and documented in `components-catalog.md` (and `ux-rules.md` when semantics/guardrails change).

Authoritative UI docs bundle (load via the index, then only what the task needs):

- Index: `docs/specs/ui/README.md`
- Discovery baseline: `docs/specs/ui/repo-discovery-baseline.md`
- Pattern audit: `docs/specs/ui/ui-pattern-audit.md`
- App-specific UI rules/semantics: `docs/specs/ui/ux-rules.md`
- Screen inventory/state summaries: `docs/specs/ui/screen-map.md`
- Route/params/transitions contracts: `docs/specs/ui/navigation-contract.md`
- Tokens/primitives/shared components catalog: `docs/specs/ui/components-catalog.md`
- Cross-task UI process/evidence standard: `docs/specs/08-ux-delivery-standard.md`

## Task card rules

1. Task card must include explicit references to:
   - Project directives
   - MVP deliverable
   - Milestone spec
2. Task card must define:
   - machine-readable frontmatter metadata for new task cards (recommended; markdown body remains authoritative)
   - In-scope / out-of-scope
   - context freshness checkpoint (what refs/inventories were re-opened or verified this session)
   - UI impact checkpoint (for UI-adjacent tasks, explicitly declare `yes|no` and keep/remove UI-only sections accordingly)
   - UX contract with key user flows (for UI tasks)
   - UI docs impact / docs touched plan (for UI tasks; which `docs/specs/ui/*.md` files must be updated and why, or explicit `no UI docs update` rationale)
   - Acceptance criteria
   - Testing and verification approach (commands/checks)
   - test-layer ownership and execution triggers for non-trivial backend/deployment/E2E work
   - hosted/deployed smoke validation ownership (or explicit task that owns it when deferred)
   - CI/manual verification posture when CI is absent or partial
   - project-structure impact (new paths/conventions or explicit no-structure-change decision)
   - Allowed files/areas
3. Task card must end with a completion note:
   - What changed
   - What tests ran
   - What remains
4. Task status must be updated in the same session as implementation:
   - `planned|in_progress -> completed` only when acceptance criteria + required gates are green.
   - otherwise set `blocked` with explicit reason and next action.

## Status update policy (mandatory)

Before ending any implementation session, AI must update both:

1. Active task card:
   - `Status`
   - `Completion note`
2. Active milestone card:
   - `Status` (or explicit unchanged rationale if milestone remains open)
   - task breakdown progress for touched tasks

Rule: do not consider a task done if code is complete but status fields were not updated.
Rule: if a task makes significant project-structure changes (for example adds/moves/removes top-level folders, moves canonical test locations, introduces a new workspace, or changes path conventions), update `docs/specs/09-project-structure.md` in the same session and summarize the change in the task completion note.
Rule: run `./scripts/task-closeout-check.sh <task-card-path>` before handoff when the helper is available, or document why it was `N/A`.
Rule: confirm `RUNBOOK.md` was reviewed in every implementation session, and update it in-session when operator-facing behavior changed.

## Automated feedback loops (before human review)

1. Local verification gates must pass (`./scripts/quality-fast.sh`, plus required `./scripts/quality-slow.sh <area>` and any documented runtime-appropriate equivalents).
2. CI verification gates must pass on the branch/PR only when CI is configured for the repo/branch; otherwise mark this loop `N/A` and follow the manual/deferred verification posture in `Current CI posture`.
3. Run an AI self-review pass against:
   - Acceptance criteria coverage
   - Test completeness
   - Offline requirements
   - Security/data access constraints
4. Human review starts only after all applicable loops above are green (the GitHub Actions frontend gate must be green on the PR).

## Current CI posture

1. A GitHub Actions pipeline (`.github/workflows/ci.yml`) runs on every push and pull request to `main`. The `frontend` job (`apps/mobile`) runs, in order: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` (5-minute step timeout), and `npm run test:handles` (the `--detectOpenHandles` open-handle guard, 5-minute step timeout).
2. Hang-safety is enforced in CI rather than masked: the step timeouts turn a leaked-handle hang (the failure mode that once stalled the unit gate) into a fast, loud failure, and the open-handle guard surfaces the leaking handle with a stack. The unit run deliberately does NOT use `--forceExit`, which would hide such leaks. See `docs/specs/06-testing-strategy.md` (Unit-test hang safety) for the full policy.
3. Not yet in CI: the iOS Maestro slow gates and the backend Supabase contract suites remain local/manual. Task cards must still call out which `quality-slow`/manual checks are required and their triggers, and completion notes must summarize that evidence.
4. When CI coverage expands (e.g. backend or e2e gates), update this playbook and `docs/specs/06-testing-strategy.md` in the same task/session to reflect the new gate ownership.

## Stop-ship conditions

Do not mark task complete if any condition is true:

1. Any required quality gate fails.
2. Acceptance criteria are partially unmet.
3. Required tests are missing or failing.
4. Regressions are detected and not explicitly accepted.

## Escalation protocol (human-in-the-loop)

Required triggers:

1. Critical execution prerequisites are missing -> immediate escalation (no retries).
2. Mandatory verify gates fail after `3` full verify attempts -> escalate.
3. Same failure signature repeats for `2` consecutive attempts without a new hypothesis -> escalate early.

Provide clear information to the human about the failure, what you tried to fix the failure, why the fixes failed and suggest next steps.

## Change discipline

1. If implementation changes architecture/testing behavior, update the relevant spec in the same session.
2. If implementation makes significant project-structure changes, update `docs/specs/09-project-structure.md` in the same session.
3. Record major decisions using `Date / Decision / Reason / Impact`.
