# AGENTS.md

## Purpose

This file is the session entrypoint.
It defines what to load first and where detailed rules live.

## Always Load (All Session Types)

- `docs/specs/README.md`
- `docs/specs/00-product.md`
- `docs/specs/03-technical-architecture.md`
- `docs/specs/05-data-model.md`
- `docs/specs/04-ai-development-playbook.md`
- `docs/specs/06-testing-strategy.md`
- `docs/specs/09-project-structure.md`
- `docs/specs/12-worktree-config-and-isolation.md` (required for local worktree/runtime setup and cross-worktree issue diagnosis)
- `docs/specs/08-ux-delivery-standard.md` (required for UI tasks)
- `docs/specs/ui/README.md` (required for UI tasks; load relevant bundle docs from there)

Note: product/domain details are maintained in specs. Do not duplicate them here.

## Brainstorms Folder Rule

- `docs/brainstorms/` contains brainstorming documents only.
- These files are non-authoritative working notes, not source-of-truth product or technical specs.
- Ignore `docs/brainstorms/**` unless the user explicitly references a brainstorm file or asks for brainstorming/ideation work in that folder.

## Orchestration Protocol (Opt-in)

- `docs/operations/task-execution.md` defines the plan / task / orchestrator workflow for executing large changes via parallel PRs.
- `docs/plans/README.md` defines the opt-in trigger and the AI suggestion heuristic.
- Default behavior is **direct execution** (no orchestrator).
- For large or multi-subsystem work, propose the orchestrator during plan mode per `docs/plans/README.md`; do not enter orchestrator mode without explicit user opt-in.
- A session enters orchestrator mode only on explicit invocation `execute plan at docs/plans/<plan-name>/`.
