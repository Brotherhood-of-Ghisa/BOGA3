---
task_id: M25-T03-Exercise_group_links_sync_entity
milestone_id: "M25"
status: planned
ui_impact: "no"
areas: "cross-stack"
runtimes: "supabase|sql|node|expo"
gates: "./boga test fast, ./boga test backend, ./boga test ios-sync-e2e"
docs_touched: "docs/specs/tech/sync-v2-server-contract.md, docs/specs/05-data-model.md, docs/specs/03-technical-architecture.md"
---

# M25-T03 — Exercise-group links as a Sync v2 entity

- Depends on: none. Milestone: `docs/plans/milestones/M25-group-exercises-and-leaderboards.md`
- Read: design §2 (T2); `sync-v2-server-contract.md` Part A (esp. §A.1,
  §A.1.1.3, §A.2, §A.7) and Part B; spec `05` local integrity contract.

## Objective

Add `exercise_group_links` as the tenth Sync v2 entity so a member's links
back up, sync, and work offline.

## Scope

- Server: `app_public.exercise_group_links` mirroring the other entities
  (composite PK, RLS, structural triggers, `sync_push`/`sync_pull` wiring, pull
  layer after `exercise_definitions`). Columns per design §2:
  `exercise_definition_id` (FK → `exercise_definitions`), `group_id text`,
  `group_exercise_id text` (no FK), `deleted_at`.
- Client: Drizzle schema + migration, sync registry/FK graph, account wipe,
  and a small repository: `linkExercise(exerciseDefinitionId, groupId,
  groupExerciseId)` (deterministic id `<group_id>:<exercise_definition_id>`,
  undelete on relink), `unlinkExercise`, `listLinks()`.
- No server reaction yet (the evaluator trigger is T04) and no UI.

## Acceptance criteria

1. Push/pull round-trip, LWW, tombstone and undelete-by-same-id behave like
   the other entities (sync contract lanes extended).
2. The FK to `exercise_definitions` holds locally and on the server; deleting
   an exercise follows the same rule as `session_exercises`' reference.
3. `sync-drift --strict` passes with the new entity; the drift checker's
   entity set includes it.
4. Relinking the same exercise into the same group reuses the id (jest).
5. `ios-sync-e2e` green.

## Docs touched

`sync-v2-server-contract.md` (§A.2 new entity, counts "nine" → "ten"), spec
`05` (entity list, sync scope), `03` decision register (links are Sync v2).
