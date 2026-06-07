# tFINAL: verify plan outcomes

**Type:** build

> Updated from t1: see designs/t1.md ## Decision

**Problem:** Verify that the plan's outcomes are delivered end-to-end. This task is the contract with
the human — its tests must fail if an outcome is missed. The central proof is the anti-brick
guarantee: a wiped/reinstalled client must re-pull `muscle_groups` (Layer 0) before
`exercise_muscle_mappings` (Layer 1) under `PRAGMA foreign_keys = ON`, and the FK must hold.

**Inputs:** All other tasks merged (t1-t9). Read the plan-level `## Outcomes` section verbatim.
Binding contract in `designs/t1.md ## Decision`. Relevant landed artifacts to exercise:
- Server: `app_public.muscle_groups` + composite FK in
  `supabase/migrations/20260525120000_sync_v2_clean_room.sql`; the push/pull RPCs.
- Client: `apps/mobile/src/data/schema/muscle-groups.ts`, the regenerated `drizzle/**` baseline,
  `apps/mobile/src/sync/topo-order.ts`, `apps/mobile/src/sync/cycle.ts`,
  `apps/mobile/src/data/bootstrap.ts`, `apps/mobile/src/data/exercise-catalog-seeds.ts`,
  `apps/mobile/src/sync/account-wipe.ts`.
- Drift: `apps/mobile/scripts/check-sync-schema-drift.ts`,
  `apps/mobile/src/data/schema/sync-extras.json`.
- Test harness: `apps/mobile/app/__tests__/helpers/in-memory-db.ts` (FK-on default).

**Outcomes (assert each plan outcome with an automated test):**
- **PO1 (server table):** drift checker (`--strict`) and/or a backend contract assertion confirms
  `app_public.muscle_groups` has the PK, columns, indexes, triggers, RLS, grants, and zero CHECKs.
- **PO2 (composite FK):** an assertion confirms the
  `(owner_user_id, muscle_group_id) → app_public.muscle_groups(owner_user_id, id)`
  `deferrable initially deferred` FK exists.
- **PO3 (client schema round-trips):** a wire round-trip test serializes a `muscle_groups` row and
  reads it back with `deletedAt` / dirty columns / id-default behavior intact.
- **PO4 (single baseline):** an assertion (extending or referencing `domain-schema-migrations.test.ts`)
  confirms `localRuntimeMigrations.journal.entries` length 1, keys `['m0000']`, and that the baseline
  carries the new `muscle_groups` shape without the non-editable guard.
- **PO5 (registry):** an assertion confirms `'muscle_groups'` is in Layer 0 of `TOPO_LAYERS`, is in
  `EntityTableName`, and has `ENTITY_FIELDS`/`ENTITY_TABLES` entries with the exact wire field set.
- **PO6 (dirty seed + boot FK):** an assertion confirms `seedSystemExerciseCatalog` seeds
  `muscle_groups` `local_dirty = 1`, the standalone boot seed no longer runs for `muscle_groups`,
  `account-wipe` clears `muscle_groups`, and boot enables `PRAGMA foreign_keys = ON` after migrations
  / before seeding.
- **PO7 (drift):** an assertion confirms `sync-extras.json` lacks the `muscleGroupId` exemption and
  the checker derives 9 entities and exits 0 under `--strict`.
- **PO8 (anti-brick round-trip — the central proof):** under `PRAGMA foreign_keys = ON`, seed
  `muscle_groups` (Layer 0) dirty → push → simulate a wiped/reinstalled client (wipe local entity
  tables + reset cursors) → drain pull layer-by-layer and assert `muscle_groups` rows land before
  `exercise_muscle_mappings` rows, the FK holds, and no FK violation / brick occurs.
- **PO9 (docs):** covered by the existing spec-invariant tests staying green (drift-rule wording,
  manual-wipe-doc-exists, etc.); add an assertion only if a plan-outcome doc claim is machine-checkable
  and not already covered.
- All added tests run in the repo quality gates: the infra-free assertions in `./scripts/quality-fast.sh`
  (and `npm run test:handles`), the Postgres-dependent ones in `./scripts/quality-slow.sh backend`
  (drift `--strict`, sync-v2 contract suites). The slow **frontend** lane is ⛔ N/A (no UI changes).
  The **data-smoke** sim lane is relevant to the data-layer change — run it for the reinstall path if
  feasible; declare it per `docs/specs/02-quality-and-test-gates.md`.
- Each test maps 1:1 (or as a coherent group) to a plan outcome so the audit can verify coverage.
  Tests fail if a plan outcome is broken; pass if every outcome holds.

**Output artifact:** the test file(s), at the repo's conventional locations, the audit can grep for.
Expected (final names at the builder's discretion, but list each in the PR):
- `apps/mobile/app/__tests__/sync/muscle-groups-synced-entity-round-trip.test.ts` — PO3, PO5, PO8
  (the anti-brick reinstall round-trip under FK enforcement).
- `apps/mobile/app/__tests__/sync/muscle-groups-seed-and-wipe.test.ts` — PO6.
- Assertions covering PO1/PO2/PO7 in the drift/backend lane
  (`apps/mobile/app/__tests__/sync/drift-check.test.ts` and/or a `supabase/tests/` contract script;
  reuse the existing harness — do not duplicate the drift checker).
- PO4 coverage in or alongside `apps/mobile/app/__tests__/domain-schema-migrations.test.ts`.

**Out of scope:** Bundling unrelated test improvements. Tests that exercise individual task outcomes
already covered on their own cards (those stay on t3-t7); this card tests the PLAN outcomes
end-to-end. Any production-code change (if a test reveals a gap, surface it — do not patch product
code under the test card).
