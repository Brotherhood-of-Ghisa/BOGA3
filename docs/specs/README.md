# Gym Tracker Project Specs

This folder is the source of truth for product and technical decisions.

## File map

The three always-load docs (per `AGENTS.md`) are marked **[always-load]**; the
rest load on demand per the `AGENTS.md` routing table.

- `docs/specs/00-product.md`: Product overview.
- `docs/specs/02-quality-and-test-gates.md`: **[always-load]** Quality/test gate ladder, what's mandatory, local infrastructure, and how to run each lane (quickref; `06` is the deep companion).
- `docs/specs/03-technical-architecture.md`: **[always-load]** Top-level architecture decisions and rationale.
- `docs/specs/04-ai-development-playbook.md`: AI-first workflow, task hierarchy, and context rules.
- `docs/specs/05-data-model.md`: Canonical data model boundaries, sync scope, and ownership invariants.
- `docs/specs/06-testing-strategy.md`: Top-level testing stack and practices.
- `docs/specs/08-ux-delivery-standard.md`: Standard UX contract, iteration loop, and evidence requirements for UI work.
- `docs/specs/09-project-structure.md`: **[always-load]** Canonical repo/project structure and path conventions (current state + agreed additions).
- `docs/specs/10-api-authn-authz-guidelines.md`: Minimal authN/authZ/API development and consumption rules for M5+ backend work.
- `docs/specs/11-maestro-runtime-and-testing-conventions.md`: Authoritative Maestro iOS runtime/testing contract and documentation ownership model for M10.
- `docs/specs/12-worktree-config-and-isolation.md`: Git worktree support, shared machine-level config, and per-worktree serving isolation design.
- `docs/specs/tech/README.md`: Index of subsystem-level technical deep-dive docs.
- `docs/specs/tech/client-sync-engine.md`: Mobile client sync engine design, flows, failure handling, and test overview (M13+).
- `docs/specs/templates/milestone-spec-template.md`: Template for milestone deep dives.
- `docs/specs/templates/task-card-template.md`: Template for per-session AI task execution.
