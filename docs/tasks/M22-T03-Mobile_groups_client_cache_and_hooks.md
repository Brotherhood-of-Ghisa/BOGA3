---
task_id: M22-T03-Mobile_groups_client_cache_and_hooks
milestone_id: "M22"
status: in_progress
ui_impact: "no"
areas: "frontend"
runtimes: "node|expo"
gates_fast: "./boga test fast; ./boga test handles"
gates_slow: "./boga test backend; ./boga test frontend; ./boga test ios-sync-e2e"
docs_touched: "docs/specs/tech/groups-contract.md, docs/specs/05-data-model.md, docs/specs/09-project-structure.md"
---

# M22-T03 — Mobile: groups client, local cache, and data hooks

## Task metadata

- Task ID: `M22-T03-Mobile_groups_client_cache_and_hooks`
- Status: `in_progress`
- Depends on: none. It codes against the contract types, and RPCs are mocked
  in jest.
- Parallel with: `M22-T01`

## Parent references (required)

- Milestone spec: `docs/specs/milestones/M22-groups-and-foundations.md`
- **Contract:** `docs/specs/tech/groups-contract.md`
  - §4: the wire shapes and error tokens;
  - §6.1: the module layout;
  - §6.2: `group_cache`;
  - §7: freshness and offline.
- Data model: `docs/specs/05-data-model.md`, the local integrity contract and
  the sync impact gate
- Tests: `docs/specs/06-testing-strategy.md` (the in-memory SQLite fixture,
  unit-test hang safety); `apps/mobile/app/__tests__/README.md`

## Objective

Build the non-UI mobile foundation: the typed RPC client with error mapping,
the local-only `group_cache` table with its account-wipe integration, the pure
stream view model, and the resource and action hooks that the screens use.

## Scope

### In scope

- **`apps/mobile/src/groups/`:** `types.ts`, `api.ts`, `cache.ts`,
  `stream-view-model.ts`, `use-group-resource.ts`, `use-group-action.ts`,
  `index.ts`, plus a NetInfo online hook if the sync-status accessor has no
  subscription (contract §6.1; do not modify the scheduler).
- **`apps/mobile/src/data/schema/group-cache.ts`:** exported from the schema
  index. Run `npm run db:generate` and commit the generated SQL and bundle.
- **`apps/mobile/src/sync/account-wipe.ts`:** add the `group_cache` delete
  inside the existing wipe transaction.

### Out of scope

Screens, routes, and the tab (`M22-T04`, `T05`). The server (`M22-T01`,
`T02`).

## Acceptance criteria

1. **Typed client.** `api.ts` exposes one typed function per RPC in contract
   §4. PostgREST errors map to `GroupApiError` codes by token prefix, transport
   failures map to `NETWORK`, and anything else maps to `INTERNAL`. It is
   jest-covered for every token.
2. **Cache.** `group_cache` is local-only and FK-free, and its migration is
   bundled.
   - Reads return nothing when `user_id` differs from the current user.
   - `evictGroup` removes `group:<id>`, `stream:<id>`, and all `session:*`
     entries.
   - `wipeLocalTables` clears the table.
   - All of this is covered with the shared in-memory SQLite fixture.
3. **View model.**
   - An `active` session reads "Training now" regardless of age (C7.2).
   - A `completed` session reads "Completed · <compact duration>".
   - Membership sentences are "X joined", "X left the group", and "X was
     removed" (C7.3).
   - A null username falls back to "Unnamed member".
   - Volume is formatted in kg, and the filter chips are All plus one per
     group.
4. **`use-group-resource`.**
   - It renders the cache first.
   - It refreshes on focus, every 30 s while focused, and on `refresh()`.
   - It sets `offline` when the device is offline or the last refresh failed
     with `NETWORK`, and keeps `lastUpdatedAtMs`.
   - On `NOT_FOUND` it evicts and surfaces a `lostAccess` state.
   - It never throws into render.
   - These are covered with fake timers, and there are no open handles.
5. **`use-group-action`.** It refuses immediately when offline, with no RPC
   call and no cache change, surfaces mapped errors, and never queues.
6. **Gates.** `./boga test handles` is green, since the task touches timers.
   The other gates are listed below.

## Docs touched (required)

- `docs/specs/05-data-model.md`: add `group_cache` to the local schema
  inventory as a test/runtime-style local-only table with sync impact
  `out of sync scope`, and to the wipe description.
- `docs/specs/09-project-structure.md`: record `apps/mobile/src/groups/`
  ownership.
- `docs/specs/tech/groups-contract.md`: add **As-built** notes to §6.1–§6.2.

## Testing and verification approach

- **Iterate** with `cd apps/mobile && npx jest groups`.
- **Before the PR:**
  - `./boga test fast`;
  - `./boga test handles`;
  - `./boga test backend` (`src/data` and `drizzle` triggers);
  - `./boga test frontend`, which includes data-smoke for the migration
    change and ios-sync-e2e for the `src/sync/account-wipe.ts` trigger.
- **Evidence:** the command output and artifact paths.

## Implementation notes

- Mirror the Supabase call pattern of `apps/mobile/src/auth/profile.ts`, with
  `schema('app_public').rpc(...)`.
- Jest mocks follow `app/__tests__/auth-profile-service.test.ts`.

## Evidence

Branch `m22-t03-mobile-groups-client`, rebased on `origin/main` 9cb5d80
(#266). Results below are measured runs on this machine (`./boga timings`).

- `npx jest groups account-switch-local-wipe domain-schema-migrations`:
  9 suites and 102 tests passed.
- Infra-free lanes on the rebased branch, each exit 0: `lint`, `typecheck`,
  `jest-full` (114 suites, 1085 tests), `docs-check`, `meta-tests`,
  `agent-auth-web`, `mcp-unit`. `mcp-unit` now finds 0 production
  vulnerabilities, so the audit failure is fixed by #266.
- `./boga test handles` passed: 114 suites, 1085 tests, exit 0, no open
  handles. It took 15.6m and ran on the pre-rebase commit; #266 changed only
  tooling. The duration is inflated by host CPU contention (load average
  above 100).
- `ios-smoke` passed: `smoke-launch` in 7s
  (`apps/mobile/artifacts/maestro/ad-hoc/20260910-221914-25920`).
- `ios-data-smoke` run 1 failed on a harness timeout, not an app failure
  (`…/ad-hoc/20260910-222037-29457`).
  - Steps 0–25 passed: data-reset boot with all migrations including m0004,
    and the recorder with the seeded catalog.
  - Step 26, tap "Reps for exercise 1 set 1", hung for 900s at load average
    about 112. The field is visible and focused in the failure screenshot.
  - Rerun: see the Completion note.
- **Blocked by infrastructure:** `backend-fast` (inside `boga test fast`),
  `boga test backend`, `ios-auth-profile`, and `ios-sync-e2e`.
  - The OrbStack Docker API is wedged: `/_ping` on
    `~/.orbstack/run/docker.sock` times out, and a watcher saw no recovery in
    30 min.
  - `orb status` reports Running.
  - It was not restarted, because other worktrees' Supabase stacks share it.

## Completion note

- What changed: `apps/mobile/src/groups/**`, the `group_cache` schema with
  migration 0004, the `group_cache` delete in `wipeLocalTables`, and jest
  suites `groups-*`. Docs: spec 05, spec 09, and the groups-contract §6.1–§6.2
  As-built notes.
- What tests ran: see Evidence.
- What remains: run `boga test backend`, the full `boga test fast`
  (backend half), `ios-auth-profile`, and `ios-sync-e2e` once Docker is
  healthy. Open the PR after those are green.
