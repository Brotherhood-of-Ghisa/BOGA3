---
task_id: M19-T07-Add_server_sync_push_guard_for_deprecated_seed_rows
milestone_id: "M19"
status: planned
ui_impact: "yes"
areas: "backend|frontend|cross-stack|docs"
runtimes: "supabase|sql|node|expo|maestro|docs"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test frontend; ./boga test ios-sync-e2e"
docs_touched: "docs/specs/05-data-model.md, docs/specs/10-api-authn-authz-guidelines.md, docs/specs/tech/sync-v2-server-contract.md, docs/specs/ui/README.md"
---

# M19-T07-Add_server_sync_push_guard_for_deprecated_seed_rows

## Task metadata

- Task ID: M19-T07-Add_server_sync_push_guard_for_deprecated_seed_rows
- Title: Add server sync_push guard for deprecated seed rows
- Status: `planned`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: 2026-07-17
- Session interaction mode: `non_interactive`

## Parent references

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M19-prune-starter-exercise-catalog.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- AuthN/AuthZ guidelines: `docs/specs/10-api-authn-authz-guidelines.md`
- Sync v2 server contract: `docs/specs/tech/sync-v2-server-contract.md`
- Project structure: `docs/specs/09-project-structure.md`
- Supabase runtime guide: `supabase/README.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`

## Context Freshness

- Verified current branch + HEAD commit: fill during task kickoff.
- Start-of-session sync with `origin/main` completed?: `N/A` for planned card creation; verify during task kickoff.
- Parent refs opened in this session:
  - `docs/specs/milestones/M19-prune-starter-exercise-catalog.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/10-api-authn-authz-guidelines.md`
  - `docs/specs/tech/sync-v2-server-contract.md`
  - `supabase/README.md`
- Code/docs inventory freshness checks run:
  - Task is planned only; run `sync_push` RPC, contract-test, sync-cycle, and sync-state UI inventory during implementation kickoff.
- Known stale references or assumptions: old app builds can still seed the pre-M19 bundle locally; this task prevents exact known deprecated seed IDs from persisting remotely as active rows.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M19-T07-Add_server_sync_push_guard_for_deprecated_seed_rows.md`

## Objective

Prevent old app builds from re-populating the remote Sync v2 mirror with exact
known deprecated bundled seed rows after M19 cleanup, while giving supported app
versions a clear user-visible stale-client/update-required sync state if the
server cannot safely coerce the push.

## Scope

### In scope

- Create the server migration with `supabase migration new <name>`.
- Add a `sync_push` guard for the finalized M19 suppressed exercise definition IDs and their exact seed mapping IDs.
- Prefer tombstone-and-ack behavior: when an old client pushes a deprecated seed row as active, store a tombstone instead of the active row and acknowledge the batch.
- Ensure the server-written tombstone is newer under LWW than the stale active row so the same old client can pull the tombstone and hide the row locally.
- Preserve normal `sync_push` behavior for kept seed rows, non-`seed_*` user-created rows, and historical `session_exercises` that reference a tombstoned exercise definition.
- Add a stable stale-catalog error token only for cases that cannot be safely tombstoned and acknowledged.
- If a stale-catalog error token is added, update the mobile sync classifier, SyncGate/status surfaces, and tests so supported clients show an update-required message.
- Emit privacy-safe diagnostics for stale deprecated seed pushes; diagnostics may go to `public.app_logs`, but logs are not a substitute for user-visible feedback.

### Out of scope

- General minimum-supported-version enforcement.
- App Store / TestFlight mandatory update infrastructure.
- Hard-deleting deprecated seed rows.
- Auto-merging historical `session_exercises.exercise_definition_id` references into kept exercise IDs.
- Rewriting non-`seed_*` user-created rows.
- Changing table ownership, RLS policy shape, or broad Sync v2 envelope shape.

## UI Impact

- UI Impact?: `yes`
- UI is needed only if the implementation adds a stale-catalog rejection token. The user-facing surface should be an existing setup/sync status surface, not the developer-only log viewer.

## UX Contract

### Key user flows

1. Old client pushes known deprecated seeds:
   - Trigger: an old app build signs into an empty remote account and pushes its pre-M19 seed bundle.
   - Success outcome: the server stores tombstones for known deprecated seed rows; the client pull hides those rows without requiring a tailored message.
   - Failure/edge outcome: if the server cannot safely coerce the batch, it returns the stale-catalog token and supported clients show an update-required sync state.
2. Supported client receives stale-catalog token:
   - Trigger: `sync_push` returns the stable stale-catalog token.
   - Success outcome: first-sync gate or sync status shows concise update-required copy and does not imply data loss.
   - Failure/edge outcome: old clients that do not know the token may show their existing generic sync failure; document this caveat in closeout.

### Interaction + appearance notes

- Reuse existing SyncGate/status styling and action patterns.
- Do not use `public.app_logs` or the developer-only log viewer as the user-facing message path.
- Copy should say the app needs an update to finish syncing catalog changes; it should not claim workout data was lost.

## Acceptance criteria

1. `sync_push` cannot persist exact known deprecated M19 seed definition or mapping IDs as active remote rows after the guard deploys.
2. Deprecated seed rows pushed active by an old client are tombstoned and acknowledged when safe.
3. The tombstone returned by a later pull wins locally under LWW over the stale active row that old client pushed.
4. Kept seed rows, user-created rows, user-renamed seed rows, and historical session rows are not modified by the guard.
5. Any fallback stale-catalog token is stable, documented, classified by supported clients, and surfaced through a user-visible update-required sync state.
6. Stale deprecated seed push diagnostics are privacy-safe and do not include exercise names, workout contents, credentials, JWTs, or service-role material.
7. Backend contract tests cover old-client active push, tombstone pullback, non-deprecated pass-through, and cross-user isolation.
8. UI/sync tests cover the stale-catalog message path if the fallback token is implemented.

## Docs touched

- Planned docs/spec files to update and why:
  - `docs/specs/05-data-model.md` - update if server-side deprecated seed coercion becomes source-of-truth sync behavior.
  - `docs/specs/10-api-authn-authz-guidelines.md` - update only if auth/RLS/API posture changes.
  - `docs/specs/tech/sync-v2-server-contract.md` - document any stale-catalog token or server-side coercion behavior.
  - `docs/specs/ui/README.md` and routed UI docs - inspect if SyncGate/status copy or route behavior changes.

## Testing and verification approach

- Planned checks/commands:
  - `supabase --help` and relevant subcommand `--help` before migration commands.
  - `./boga test fast`
  - `./boga test backend`
  - `./boga test frontend` if a user-visible sync message changes UI.
  - `./boga test ios-sync-e2e`
  - `./boga test for --diff <range>`
- Test layers covered: local Supabase `sync_push` contracts, Sync v2 pullback/convergence, mobile sync classifier/status UI, device-level sync proof if UI or end-to-end sync behavior changes.
- Execution triggers: always before task closeout.
- Slow-gate triggers: backend RPC changes require backend; sync-cycle changes require iOS sync e2e; UI status changes require frontend.
- CI/manual posture note: backend/frontend/iOS sync gates are local-only here and must be run on this machine.

## Implementation notes

- Planned files/areas allowed to change:
  - `supabase/migrations/**`
  - `supabase/tests/**`
  - `apps/mobile/src/sync/**`
  - `apps/mobile/app/__tests__/**`
  - SyncGate/status UI files only if the fallback stale-catalog token is implemented
- Project structure impact: none planned.
- Constraints/assumptions:
  - Use exact finalized M19 suppressed seed IDs from `M19-T01`; do not use broad name matching.
  - Prefer server tombstones over hard rejection so old clients can converge without a mandatory-update system.
  - Do not introduce service-role credentials in mobile/client code.

## Mandatory verify gates

- Standard local fast gate: `./boga test fast`
- Standard local slow gate: `./boga test backend`; `./boga test frontend`; `./boga test ios-sync-e2e`
- Additional gate(s), if any: follow `./boga test for --diff <range>`.

## Evidence

- Fill during implementation.
- UI/UX task visual artifacts note: fill during implementation if user-visible sync copy changes.
- Manual verification summary: fill during implementation.

## Completion note

- What changed:
- What tests ran:
- What remains:

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Update parent milestone task breakdown/status in the same session.
