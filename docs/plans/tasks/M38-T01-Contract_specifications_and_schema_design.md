# M38-T01 — Contract specifications and schema design

- Status: `planned`
- Depends on: none
- Milestone: `docs/plans/milestones/M38-agent-programme-and-plan-edits.md`
- Areas: cross-stack; UI impact: no

## Objective

Graduate the approved agent programme edit proposal into the canonical session planning and authorization specifications. Add the database migration for `plan_edit_enabled`, write receipts operation CHECK widening, and `last_modified_by` attribution across the four authored plan tables, aligning Sync v2 projections and mobile Drizzle schemas.

## Scope

- In:
  - Spec updates to `docs/specs/tech/session-planning-contract.md` (§1.5, §6.1, §6.2, §7) and `docs/specs/10-api-authn-authz-guidelines.md`.
  - Supabase migration:
    - Add `plan_edit_enabled boolean not null default false` to `public.agent_plan_permissions`.
    - Widen `agent_plan_write_receipts_operation_valid` check to include the new edit operations.
    - Add `last_modified_by text default 'human' check (last_modified_by in ('human', 'agent'))` to `training_programmes`, `session_plans`, `session_plan_exercises`, and `session_plan_sets`.
    - Update `sync_push` and `sync_pull` RPC projections to include `last_modified_by`.
  - Mobile Drizzle SQLite schema and migration for `last_modified_by`.
  - Update `ENTITY_FIELDS` in `apps/mobile/src/sync/cycle.ts`.
- Out:
  - Implementation of mutation RPC functions (owned by T02).
  - Implementation of Edge Function routes (owned by T03).
  - Connected Agents UI screen toggle (owned by T05).

## Decided

- D1: Editing restricted to pending, unattached blocks; performed history and active workouts are untouched.
- D5: Separate `plan_edit_enabled` column in `agent_plan_permissions`.
- D6: Attribution tracked with `last_modified_by` across all four authored entities.

## Open — resolve with the user at session start

- Confirm Drizzle migration generation strategy and sync schema drift test expectations.

## Deliverables and acceptance

1. Canonical specs updated within their word budgets, removing the absolute no-edit restriction and defining the mutation contract.
2. Migration applies cleanly on local Supabase; `agent_plan_permissions` has `plan_edit_enabled`, receipts table permits new operation tokens, and authored tables have `last_modified_by`.
3. Sync push and pull round-trip `last_modified_by` correctly without schema drift warnings.
4. Fast tests and sync tests pass.

## Specs to update

- `docs/specs/tech/session-planning-contract.md` — rewrite §1.5, add route and tool definitions, add error tokens.
- `docs/specs/10-api-authn-authz-guidelines.md` — document `plan_edit_enabled` gate.

## Gates

Expected from `./boga test for`:
`fast`, `backend`, `docs-check`
