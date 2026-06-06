---
task_id: T-20260305-05-securestore-entitlements-cleanup
milestone_id: "M11"
status: outdated
ui_impact: "no"
areas: "frontend"
runtimes: "expo,maestro"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "./scripts/quality-slow.sh frontend"
docs_touched: "docs/specs/06-testing-strategy.md,docs/specs/11-maestro-runtime-and-testing-conventions.md"
---

> **OUTDATED — archived 2026-06-06.** This M11-era cleanup (authored 2026-03-05)
> was never actioned and M11 has long shipped. Retained for history only; not in
> flight. Ignore unless explicitly re-opened.

## Task metadata

- Task ID: `T-20260305-05-securestore-entitlements-cleanup`
- Title: Remove temporary SecureStore entitlement fallback once signed iOS dev-client is available
- Status: `outdated`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-03-05`
- Session interaction mode: `interactive (default)`

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M11-auth-ui-and-profile-management.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`

## Objective

Remove the temporary in-memory auth storage fallback in `apps/mobile/src/auth/storage.ts` after local Maestro uses a signed iOS dev-client build with Keychain entitlements, while preserving green auth/profile runtime tests.

## Scope

### In scope

- Remove fallback-on-entitlement-error behavior from mobile auth storage.
- Restore SecureStore-only storage behavior for auth session persistence.
- Ensure Maestro runtime build path uses signed dev-client artifacts with entitlements.
- Update Maestro/testing docs to remove temporary workaround notes if no longer needed.

### Out of scope

- Backend/Supabase auth contract changes.
- Profile UI changes unrelated to storage/runtime entitlement behavior.

## UI Impact (required checkpoint)

- UI Impact?: `no`

## Acceptance criteria

1. `apps/mobile/src/auth/storage.ts` no longer includes in-memory fallback logic for entitlement errors.
2. Local iOS Maestro auth-profile flow passes with signed dev-client and without SecureStore entitlement runtime errors.
3. `./scripts/quality-slow.sh frontend` passes.
4. Any temporary workaround references are removed/updated in affected docs.

## Docs touched (required)

- `docs/specs/06-testing-strategy.md` - adjust runtime/logging/workaround notes as needed.
- `docs/specs/11-maestro-runtime-and-testing-conventions.md` - document signed-dev-client entitlement expectation and remove temporary workaround language if present.

## Testing and verification approach

- Planned checks/commands:
  - `./scripts/quality-fast.sh frontend`
  - `npm run test:e2e:ios:auth-profile`
  - `./scripts/quality-slow.sh frontend`
- Slow-gate triggers:
  - required, because this task changes auth bootstrap persistence and Maestro real-runtime behavior.
- CI/manual posture note:
  - CI is not configured; local gate evidence is required in completion note.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/src/auth/storage.ts`
  - `apps/mobile/src/auth/service.ts` (only if reset helpers need alignment)
  - `apps/mobile/scripts/maestro-ios-*.sh` and related runtime helper scripts if signing path needs updates
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/11-maestro-runtime-and-testing-conventions.md`
- Constraints/assumptions:
  - signed iOS development certificate/profile is available on the machine running Maestro.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `./scripts/quality-slow.sh frontend`
- Additional gate: `npm run test:e2e:ios:auth-profile`

## Evidence

- Capture artifact roots under `apps/mobile/artifacts/maestro/<task-id-or-ad-hoc>/<timestamp>/`.
- Include `expo-start.log` and `simulator-system.log` checks showing no SecureStore entitlement failures.
- Manual verification summary required because CI is absent.

## Completion note (fill at end)

- What changed:
- What tests ran:
- What remains:

