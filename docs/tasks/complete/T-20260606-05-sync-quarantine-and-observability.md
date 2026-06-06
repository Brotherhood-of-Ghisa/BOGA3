---
task_id: T-20260606-05-sync-quarantine-and-observability
milestone_id: "M13"
status: completed
ui_impact: "no"
areas: "frontend|docs"
runtimes: "node|expo"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "./scripts/quality-slow.sh frontend"
docs_touched: "docs/specs/03-technical-architecture.md,docs/specs/05-data-model.md,docs/specs/06-testing-strategy.md,docs/specs/tech/client-sync-engine.md,RUNBOOK.md"
---

# Task Card

## Task metadata

- Task ID: `T-20260606-05-sync-quarantine-and-observability`
- Title: Add sync quarantine for FK-blocked dirty rows
- Status: `completed`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-06-06`
- Session interaction mode: `interactive (default)`

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M13-simple-backend-sync.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- AI development playbook: `docs/specs/04-ai-development-playbook.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- Client sync engine deep-dive: `docs/specs/tech/client-sync-engine.md`
- Review input: `docs/reviews/db-sync-offline-fk-review-2026-06-06.md`
- Worktree/runtime isolation: `docs/specs/12-worktree-config-and-isolation.md`
- Human run/test/debug guide: `RUNBOOK.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit: `codex/review-db-sync-functionalities-for-issues` @ `bc9d81f` (push-side FK preflight from T-04 landed).
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `N/A` — single-session continuation on the existing review branch; no upstream rebase requested.
- Parent refs opened in this session:
  - `docs/specs/README.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/04-ai-development-playbook.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/12-worktree-config-and-isolation.md`
  - `docs/specs/tech/client-sync-engine.md`
  - `docs/reviews/db-sync-offline-fk-review-2026-06-06.md`
  - `RUNBOOK.md`
- Code/docs inventory freshness checks run:
  - T-04 push preflight landed (`findPushBatchFkViolations` in `src/sync/fk-graph.ts`, throw-on-violation in `runPushLeg`); this task replaces the throw with quarantine-and-continue.
  - Schema/migration conventions: drizzle-kit generate + `scripts/bundle-migrations.ts` via `npm run db:generate`; squashed `m0000` baseline, new tables append as incremental migrations (now `m0001`).
  - Status/gate surfacing: `getSyncStatus` snapshot (`src/sync/sync-status.ts`) is the chosen blocked-rows surface; the first-sync gate holder/bridge left unchanged (no new UI per `ui_impact: no`).
- Known stale references or assumptions:
  - This task assumes single-device-per-user. Quarantine handles local structural defects, not multi-device conflict resolution.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260606-05-sync-quarantine-and-observability.md`

## Objective

Prevent one structurally bad dirty row from permanently blocking an otherwise valid offline backlog by persisting a quarantine record, skipping quarantined rows during push selection, continuing valid pushes, and logging enough diagnostics to repair the defect.

## Scope

### In scope

- Add a local sync quarantine table or equivalent persisted runtime state.
- Persist quarantined row identity, entity type, error code, first/last seen timestamps, occurrence count, and safe diagnostic context.
- Exclude quarantined rows from normal push batch selection.
- Continue pushing valid independent dirty rows after quarantining an orphan row.
- Add status/gate surface data for "blocked rows exist" without building a full repair UI.
- Add structured logging for quarantine creation, repeated detection, and successful non-offending push continuation.

### Out of scope

- Full user-facing repair workflow.
- Automatic destructive local graph repair.
- Multi-device conflict resolution.
- Backend schema changes unless the chosen design unexpectedly needs them.

## UI Impact (required checkpoint)

- UI Impact?: `no`
- Rationale:
  - This task may expose blocked-row state to existing status surfaces, but should not introduce new screens or visual repair flows. If visible UI text/layout changes are needed, update `ui_impact` to `yes` and load UI refs before editing UI.

## Acceptance criteria

1. A dirty orphan child row detected by push preflight or server `FK_VIOLATION` is persisted in local quarantine state.
2. Quarantine records include entity type, entity id, error code, first seen time, last seen time, and occurrence count.
3. Quarantined rows are skipped by future push selection until repaired or explicitly cleared.
4. A test with one orphan row and one valid independent dirty row proves the valid row still pushes and clears dirty.
5. A repeated quarantine detection updates `last_seen`/count instead of creating unbounded duplicates.
6. Quarantine state survives app restart/local database reopen.
7. Existing status/gate composition can report that blocked sync rows exist, even if full repair UI is deferred.
8. Quarantine creation logs a structured event through `logEvent` with safe context and no row payload/user-entered values.
9. Continued push after quarantine logs a structured event indicating non-offending rows continued.
10. Logger failure never prevents quarantine persistence or valid row push continuation.
11. Schema/migration tests cover the new quarantine table if added.
12. Docs record quarantine semantics, repair limitations, and operator log expectations.

## Docs touched (required)

- Planned docs/spec files to update and why:
  - `docs/specs/03-technical-architecture.md` - record quarantine as sync runtime behavior.
  - `docs/specs/05-data-model.md` - add quarantine table under test/runtime/sync bookkeeping, not user backup scope.
  - `docs/specs/06-testing-strategy.md` - record quarantine coverage expectations.
  - `docs/specs/tech/client-sync-engine.md` - document quarantine flow and status semantics.
  - `RUNBOOK.md` - add log inspection/operator notes if new diagnostics are useful to humans.

## Testing and verification approach

- Planned checks/commands:
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/sync-cycle-push.test.ts app/__tests__/sync-cycle-convergence.test.ts`
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/domain-schema-migrations.test.ts app/__tests__/bundle-migrations.test.ts`
  - `cd apps/mobile && npm run db:generate:canary`
  - `./scripts/quality-fast.sh frontend`
  - `./scripts/quality-slow.sh frontend`
- Test layers covered:
  - local schema/migration tests
  - sync push/quarantine Jest tests
  - status/gate mapping tests if state is surfaced
  - native runtime smoke through frontend slow gate if schema changes
- Slow-gate triggers:
  - required if this task adds a SQLite table/migration or changes runtime persistence.
- Hosted/deployed smoke ownership:
  - `N/A`; quarantine is local runtime state unless implementation changes backend contracts.
- CI/manual posture note:
  - local slow frontend evidence is mandatory for local migration/runtime confidence.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/src/data/schema/**`
  - `apps/mobile/drizzle/**`
  - `apps/mobile/src/sync/**`
  - sync/status tests
  - docs listed above
- Project structure impact:
  - no new top-level paths expected.
- Constraints/assumptions:
  - Quarantine state is local runtime bookkeeping, not synced user data.
  - Do not clear user dirty rows silently.
  - Do not log full row payloads, exercise names, gym names, or other user-entered values.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `./scripts/quality-slow.sh frontend`
- Additional gate(s): targeted Jest commands and `npm run db:generate:canary`

## Evidence

- Targeted Jest (quarantine + neighbours): `app/__tests__/sync-cycle-quarantine.test.ts` (9 tests) + `sync-cycle-push-preflight.test.ts` + `domain-schema-migrations.test.ts` + `sync-status-composer.test.ts` → all PASS. Broader sync suite (`sync-cycle-push`, `-convergence`, `-pull`, `bundle-migrations`, `sync-status-panel`, `sync-bootstrapper`) → 58 PASS.
- `npm run db:generate:canary`: regenerated cleanly, then `No schema changes, nothing to migrate` on re-run (schema ⇄ migration bundle in sync); produced `drizzle/0001_dapper_vision.sql` (CREATE TABLE `sync_quarantine`, composite PK, no FKs) + bundle now 2 entries.
- `./scripts/quality-fast.sh frontend`: PASS — 87 suites, 788 tests green (the in-test `[logging] app log insert failed` console.warn is the expected best-effort logEvent error path, not a failure).
- `./scripts/quality-slow.sh frontend`: PASS — all six iOS Maestro flows green: `smoke-launch`, `data-runtime-smoke` (proves the new `0001` migration applies on a real device boot), `launch-requires-sign-in`, `sync-gate-first-cycle`, `settings-sync-status` (the surface extended with `blockedRowCount`), `auth-profile-happy-path`. NOTE: the first run exited 0 *vacuously* because `JAVA_HOME` was unset and Maestro silently no-op'd; re-ran with `JAVA_HOME=/opt/homebrew/opt/openjdk` exported and confirmed each `[Passed] <flow>` marker. No native deps changed, so no dev-client rebuild was required.
- Manual verification summary (required when CI is absent/partial): quarantine persists, skips/continues, cascades, and survives reopen; the two diagnostics carry safe context only and never block on logger failure (all asserted by `sync-cycle-quarantine.test.ts`); the `settings-sync-status` Maestro flow renders the extended status surface on a real device. Details:
  - Persistence: `quarantineRows` upsert — fresh insert at count 1 (first==last), repeat preserves `first_seen`, advances `last_seen` + `occurrence_count`, no duplicate row. Survives a fresh drizzle handle over the same SQLite connection (restart proxy).
  - Skip/continue: `selectPushBatch` excludes quarantined ids; integration proves one orphan + one valid independent dirty row → valid row pushes and clears dirty, orphan quarantined (still dirty), cycle converges (no throw, no gate error). Cascade: a child of a quarantined orphan is itself quarantined in the same drain.
  - Logger: `sync.row_quarantined` (warn) + `sync.push_continued_after_quarantine` (info) carry opaque ids/structural metadata only (no `Ex se-orphan` payload); a rejecting logger never blocks persistence or the continued push.

## Completion note

- What changed: replaced the push-side throw-on-orphan wedge with persistent quarantine-and-continue, adding a local quarantine table, a status surface, tests, and spec/RUNBOOK updates. Details:
  - New local-only `sync_quarantine` table (`apps/mobile/src/data/schema/sync-quarantine.ts`, migration `drizzle/0001_dapper_vision.sql`): composite `(entity_type, entity_id)` PK, error code + diagnostic FK context, first/last-seen, occurrence count; FK-free, never synced, not in topo layers.
  - New `apps/mobile/src/sync/quarantine.ts`: idempotent `quarantineRows` upsert, `readQuarantine` (keys + ids-by-type), `countQuarantinedRows`.
  - `apps/mobile/src/sync/cycle.ts` push leg: replaced the throw-on-orphan wedge with quarantine-and-continue — orphans are persisted, excluded from selection, and valid rows keep pushing; bounded cascade loop quarantines children of quarantined orphans; emits `sync.row_quarantined` + `sync.push_continued_after_quarantine` (best-effort, safe context only). `selectPushBatch` now excludes quarantined rows.
  - `apps/mobile/src/sync/fk-graph.ts`: `findPushBatchFkViolations` takes an optional `quarantinedKeys` set so a present-but-quarantined parent flags its child (cascade support).
  - `apps/mobile/src/sync/sync-status.ts`: `SyncStatusSnapshot.blockedRowCount` surfaces that blocked rows exist (no new UI).
  - Docs: client-sync-engine §15 (+§16 renumber), data-model, architecture decision table, testing-strategy, RUNBOOK log triage, M13 milestone entry 11.
- What tests ran: targeted Jest suites, `db:generate:canary`, and both frontend quality gates — all green. Details:
  - Targeted Jest: `sync-cycle-quarantine` (9), `sync-cycle-push-preflight`, `domain-schema-migrations`, `sync-status-composer` + broader sync suite (58) — all green.
  - `npm run db:generate:canary` — clean (`No schema changes` on re-run).
  - `./scripts/quality-fast.sh frontend` — 87 suites / 788 tests green.
  - `./scripts/quality-slow.sh frontend` — all 6 iOS Maestro flows passed (see Evidence; required because this task adds a SQLite migration).
- What remains: nothing for this card; the items below are deliberately out of scope. Details:
  - Out of scope per the card: user-facing repair UI, automatic destructive local graph repair, multi-device conflict resolution. Server-side `FK_VIOLATION` (without row identity) still throws as before — the deterministic preflight is the quarantine driver.

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If completed/outdated, move this file to `docs/tasks/complete/`.
- Run `./scripts/task-closeout-check.sh docs/tasks/T-20260606-05-sync-quarantine-and-observability.md` or document why `N/A`.
