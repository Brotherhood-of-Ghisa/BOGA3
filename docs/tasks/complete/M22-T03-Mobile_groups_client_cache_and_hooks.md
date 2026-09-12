---
task_id: M22-T03-Mobile_groups_client_cache_and_hooks
milestone_id: "M22"
status: completed
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
- Status: `completed`
- Depends on: none. It codes against the contract types, and RPCs are mocked
  in jest.
- Parallel with: `M22-T01`

## Parent references (required)

- Milestone spec: `docs/specs/milestones/archive/M22-groups-and-foundations.md`
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
(#266). Gate results are for commit `498b52d` (membership-write typing
update) unless noted. Durations are measured records (`./boga timings`,
`docs/testing/timings/records/`).

- `npx jest groups account-switch-local-wipe domain-schema-migrations`:
  9 suites and 103 tests passed.
- `./boga test fast`: exit 0.
  - `lint` 1.4s, `typecheck` 3.2s, `jest-full` 6.2s (114 suites, 1086
    tests).
  - `backend-fast` 1.2m, `docs-check` 0.1s, `meta-tests` 1.3s.
  - `agent-auth-web` 2.7s (6 tests), `mcp-unit` 4.0s (5 tests).
- `./boga test handles`: exit 0, 114 suites, 1086 tests, no open handles,
  23.2s.
- `./boga test backend`: exit 0 for all 11 lanes: `auth-authz` 7.9s, `agent-api` 6.6s, `sync-v2-schema` 7.5s, `sync-push-contract` 6.0s, `sync-pull-contract` 6.2s, `dev-wipe-my-data`, `sync-drift` 39s (`--strict`), `sync-v2-e2e` 2.2m, `sync-infra` 10s, `mcp-smoke` 8.7s.
- `./boga test frontend`: exit 0 for all 4 lanes: `ios-smoke` 1/1 flow (`/20260911-121423-53218`); `ios-data-smoke` 1/1 flow, 1.1m, migration m0004 applied on device (`/20260911-121458-55387`); `ios-auth-profile` 1/1 flow, 1.2m (`/20260911-121607-58515`); `ios-sync-e2e` 1/1 flow, 1.7m, account wipe with `group_cache` (`/20260911-121720-61182`).
- Earlier run (commit 5d16550, before the typing update): `ios-smoke` passed
  (`apps/mobile/artifacts/maestro/ad-hoc/20260910-221914-25920`), and
  `ios-data-smoke` hit a 900s harness timeout at host load average about 112
  (`…/ad-hoc/20260910-222037-29457`). The OrbStack Docker API then hung, and
  the remaining Docker lanes were deferred until it recovered.

## Completion note

- What changed: `apps/mobile/src/groups/**`, the `group_cache` schema with
  migration 0004, the `group_cache` delete in `wipeLocalTables`, and jest
  suites `groups-*`. Docs: spec 05, spec 09, and the groups-contract §6.1–§6.2
  As-built notes.
- Membership-write results follow the M22-T01 as-built §4.3. `leaveGroup`
  resolves `{ group_id }`. `removeGroupMember`, `setGroupMemberRole`, and
  `transferGroupOwnership` resolve the `group_get` payload
  `{ group, members }`. Each is shape-checked, and the contract §6.1
  As-built note records this.
- What tests ran: see Evidence.
- What remains: review and merge. The screens (`M22-T04`, `T05`) consume
  these hooks.
