# Gym Tracker Project Specs

This folder is the source of truth for product and technical decisions.

## File map

The three always-load docs (per `AGENTS.md`) are marked **[always-load]**; the
rest load on demand per the `AGENTS.md` routing table. (Spec numbering has
gaps — `04`, `07` — from retired docs; gaps are intentional, do not renumber.)

- `docs/specs/00-product.md`: Product overview.
- `docs/specs/01-worktree-and-environment.md`: Set up / tear down a worktree environment (quickref; `12` is the deep contract).
- `docs/specs/02-quality-and-test-gates.md`: **[always-load]** Quality/test gate ladder, what's mandatory, and how to run each lane (quickref; `06` is the deep companion).
- `docs/specs/03-technical-architecture.md`: **[always-load]** Top-level architecture decisions and rationale.
- `docs/specs/05-data-model.md`: Canonical data model boundaries, sync scope, and ownership invariants.
- `docs/specs/06-testing-strategy.md`: Per-test-entry-point catalog (purpose/infra/when) and coverage policies; deep companion to `02`.
- `docs/specs/08-ux-delivery-standard.md`: Standard UX contract, iteration loop, and evidence requirements for UI work.
- `docs/specs/09-project-structure.md`: **[always-load]** Canonical repo/project structure and path conventions (current state + agreed additions).
- `docs/specs/10-api-authn-authz-guidelines.md`: Minimal authN/authZ/API development and consumption rules for backend work.
- `docs/specs/11-maestro-runtime-and-testing-conventions.md`: Authoritative Maestro iOS runtime/testing contract and documentation ownership model.
- `docs/specs/12-worktree-config-and-isolation.md`: Git worktree support, shared machine-level config, and per-worktree serving isolation design.
- `docs/specs/milestones/M18-group-exercise-catalogue-private-mapping.md`: Planned group exercise catalogue, private-to-group exercise mapping, and group session-share milestone.
- `docs/specs/milestones/M19-prune-starter-exercise-catalog.md`: Planned starter exercise catalog pruning, remote tombstone cleanup, server-side deprecated-seed push guard, and sync-safe rollout.
- `docs/specs/tech/README.md`: Index of subsystem-level technical deep-dive docs.
- `docs/specs/tech/sync-v2-server-contract.md`: Authoritative sync-v2 server contract — schema / LWW / RLS (Part A) and push/pull RPC wire contract (Part B).
- `docs/specs/templates/milestone-spec-template.md`: Template for milestone deep dives.
- `docs/specs/templates/task-card-template.md`: Template for per-session AI task execution.
