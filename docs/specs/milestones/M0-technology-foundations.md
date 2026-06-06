# Milestone Spec

## Milestone metadata

- Milestone ID: `M0`
- Title: Technology foundations
- Status: `completed`
- Owner: `AI + human reviewer`
- Target window: `2026-02 (bootstrap)`

## Parent references

- Project directives: `docs/specs/README.md`
- Milestone index: `docs/specs/milestones/README.md` (the retired `00-mvp-deliverables.md` index)
- Architecture: `docs/specs/03-technical-architecture.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`

## Milestone objective

Establish the minimum policy, app scaffold baseline, and quality gates required before feature implementation starts.

## In scope

- Temporary execution-policy bootstrap exception while verify scripts do not yet exist.
- Expo Router smoke app scaffold at `apps/mobile`.
- Local quality gates (`lint`, `typecheck`, `test`) and smoke coverage.
- Restoration of strict verify enforcement after gates are operational.

## Out of scope

- Session tracking feature implementation (`Session -> Exercise -> Set`).
- Backend/auth/sync/group features.
- CI workflow automation beyond local gate readiness.

## Deliverables

1. Bootstrap policy and milestone scaffolding complete (`T-20260215-01`).
2. Expo Router smoke app scaffold complete (`T-20260215-02`).
3. Testing and quality gates operational with strict enforcement restored (`T-20260215-03`).

## Acceptance criteria

1. Milestone and task documentation chain is valid (`Project -> MVP -> Milestone -> Task`).
2. Temporary bootstrap verify exception is explicitly bounded and removed after gate implementation.
3. `apps/mobile` scaffold and baseline root message are implemented.
4. `npm run lint`, `npm run typecheck`, and `npm run test` pass locally for `apps/mobile`.

## Task breakdown

1. `docs/tasks/complete/T-20260215-01-m0-bootstrap-execution-policy.md` - define bootstrap exception and create this milestone spec.
2. `docs/tasks/complete/T-20260215-02-m0-expo-smoke-app.md` - scaffold Expo Router app and root smoke message.
3. `docs/tasks/complete/T-20260215-03-m0-testing-and-quality-gates.md` - add smoke test, quality scripts, and remove bootstrap exception.

## Risks / dependencies

- Local Node/npm/Expo toolchain availability may block scaffold and gate commands.
- Bootstrap exemption must remain temporary; stale policy text after T-03 would weaken enforcement clarity.

## Decision log

- Date: 2026-02-17
- Decision: Run Milestone 0 as a three-task sequence (policy -> scaffold -> gates).
- Reason: Keep bootstrap risk isolated while preserving strict long-term quality enforcement.
- Impact: Unblocks implementation sessions with clear expiry and closeout checkpoints.
