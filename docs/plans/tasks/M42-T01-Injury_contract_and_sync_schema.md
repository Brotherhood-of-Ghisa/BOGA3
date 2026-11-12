# M42-T01 — Injury contract, data model, and Sync v2 schema

- Status: `completed`
- Depends on: none
- Milestone: [M42](../milestones/M42-injury-and-discomfort-tracking.md)
- Areas: docs, backend, mobile data; UI impact: no

## Objective and scope

Establish the authoritative technical contract for injury tracking
(`docs/specs/tech/injury-contract.md`), create the Postgres migration and
mobile SQLite Drizzle schema for `injuries`, add the table to Layer 1 of
Sync v2 topological ordering, and verify schema drift and RLS isolation.
Follow milestone D1, D2, and D7. This task adds no mobile UI, live session
warnings, or MCP tools.

## Baseline to verify

Load `docs/specs/05-data-model.md` and `docs/specs/tech/sync-v2-server-contract.md`
for Sync v2 entity requirements; load `docs/specs/tech/bodyweight-load-contract.md`
for the privacy boundary pattern; load `apps/mobile/src/sync/topo-order.ts` and
`apps/mobile/src/sync/cycle.ts` for layering. Inspect `muscle_groups` seed data
in `apps/mobile/src/data/exercise-catalog-seeds.ts` for anatomy keys.

## Open — resolve before coding

- Schema columns and check constraints: `muscle_group_id` nullable FK to
  `muscle_groups(id)` (Layer 0), `side` (`'left' | 'right' | 'bilateral'`),
  `status` (`'acute' | 'managing' | 'monitoring' | 'resolved'`), `pain_score`
  (`0..10`), `label` (required non-empty text), `notes` (nullable text),
  `contraindications` (nullable text or JSON array), `started_at`
  (`timestamp_ms`), `resolved_at` (`timestamp_ms`, nullable).
- Zero-group privacy assertion: verify that `injuries` carries `owner_user_id`,
  is excluded from group projections, and cannot be read by other group members.
- Define static anatomical alias dictionary (`ANATOMY_ALIASES`) mapping lay
  terms to `muscle_groups.id`.
- Ensure Monotonic `client_updated_at_ms` advances and standard tombstone
  behavior (`deleted_at`) under Sync v2.

## Deliverables and acceptance

1. Author `docs/specs/tech/injury-contract.md` specifying lifecycle states,
   anatomical linkage, privacy boundaries, and Sync v2 serialization rules.
2. Add Postgres migration creating `app_public.injuries` with RLS policies,
   indexes, and updated `sync_push` and `sync_pull` RPC projections.
3. Add mobile Drizzle SQLite schema in `apps/mobile/src/data/schema/injuries.ts`
   with local dirty tracking columns.
4. Add `injuries` to Layer 1 of `TOPO_LAYERS` in
   `apps/mobile/src/sync/topo-order.ts` and `ENTITY_FIELDS` in `cycle.ts`.
5. Local Supabase contract tests prove owner-only access, foreign user denial,
   soft deletion, and Sync v2 push/pull round-trip.
6. Drift check passes: `npm run check:sync-drift`.

## Gates

Expected from `./boga test for`:
`fast` | `backend`
