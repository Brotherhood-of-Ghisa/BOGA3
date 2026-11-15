# Training notes contract

Load when changing training notes: their table, sync, merge handling, the
app's notes pages or the coach's note tools. Product rules:
[[notes.definition]], [[notes.agent-access]].

## Storage and sync

`training_notes` is the eighteenth Sync v2 entity, in layer 1
(`apps/mobile/src/sync/topo-order.ts`): `exercise_definition_id` (nullable;
null is a general note), `body`, `noted_on`, `source` and the standard
timestamps. `noted_on` is a local calendar date stored as `YYYY-MM-DD` text,
not epoch ms: a note applies from a day, not an instant. `source` is `app` or
`agent`. Following the Sync v2 ground rules, the server has no CHECK on body
length, date shape or source; the app repository
(`apps/mobile/src/data/training-notes.ts`) and the agent API validate their own
writes. The composite FK to `exercise_definitions` cascades only on a hard
delete; exercises are soft-deleted, so a deleted exercise keeps its notes and
lists show its name.

The table shipped server first with no protocol bump: older builds skip its
rows, and the first build that knows it re-pulls layer 1 once
(`apps/mobile/src/sync/pull-layer-types.ts`).

## Lifecycle

Add and remove only. Remove is a soft delete (`deleted_at`): the row is kept so
a later restore can re-emit the same id, and every list, the app and the agent
API alike, hides it. Lists order by `noted_on` descending, then creation time
descending, then id.

## Exercise merge

`exercise_merge_execute` repoints every note on the source exercise, removed
ones included, to the destination. Notes stay out of `exercise_merge_snapshot`
(`exercise-merge-contract.md`), so the merge stamp also outruns every note
clock and the moved rows reach devices through the ordinary layer-1 pull. A
note written offline against the source after the merge keeps the source,
which stays listed under its name. Likewise, an offline removal stamped after
the merge re-pushes the whole row with the source id; that matters only to a
future restore, which must repoint such a note.

## Agent API

The service-role RPCs `agent_add_note` and `agent_remove_note`
(`supabase/migrations/20261112180000_training_notes.sql`) write with
`source = 'agent'`, take the per-owner merge lock and claim a write receipt
(operations `add_note`, `remove_note`). The Edge Function routes, validation
and responses are in `supabase/functions/agent-api/README.md`; the MCP tools
in `services/boga-mcp/README.md`.

## Proof

Jest: `apps/mobile/__tests__/training-notes-data.test.ts` (repository, wire
round trip, pull apply), `apps/mobile/__tests__/sync-cycle-wire.test.ts` and
`apps/mobile/__tests__/sync-pull-layer-types.test.ts` (the layer-1 re-pull).
Live: the merge case in `apps/mobile/__tests__/sync/exercise-merge-live.test.ts`
and the Sync v2 schema, RLS and FK suites under `supabase/tests/`.
