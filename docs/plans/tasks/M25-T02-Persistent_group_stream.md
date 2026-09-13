---
task_id: M25-T02-Persistent_group_stream
milestone_id: "M25"
status: planned
ui_impact: "no"
areas: "backend"
runtimes: "supabase|sql|node"
gates: "./boga test fast, ./boga test backend, ./boga test ios-groups-e2e"
docs_touched: "docs/specs/tech/groups-contract.md, docs/specs/03-technical-architecture.md"
---

# M25-T02 — Persistent group stream (server)

- Depends on: none. Milestone: `docs/plans/milestones/M25-group-exercises-and-leaderboards.md`
- Read: design §4 (T5, T6); `groups-contract.md` §2.4–§2.5 (share trigger),
  §4.2 (`group_stream` contract and cursor).

## Objective

Replace read-time stream assembly with one persistent `group_events` table,
with **no visible change** to the stream today.

## Scope

- Migration: `app_public.group_events` (design §4 columns; kinds `session`,
  `joined`, `left`, `removed` now; `record`, `record_voided`, `link`,
  `unlink`, `lead_change` reserved by CHECK for T05), indexes for the stream
  order and keyset cursor.
- Writers: the share trigger inserts a `session` event when a session is
  first shared into a group (idempotent, failure-isolated as §2.5); the
  membership RPCs insert `joined` / `left` / `removed`.
- Backfill from `group_session_shares` and `group_memberships`.
- `group_stream` reads `group_events` only. The wire shape, ordering, keys,
  dedupe across groups in All, and cursor stay byte-compatible with §4.2;
  session card content still reads live.

Out of scope: record/lead-change events (T05), any client change.

## Acceptance criteria

1. Every existing `groups-contract` stream assertion passes unchanged.
2. New assertions: backfill produces one `session` event per share and one
   event per membership edge; a newly shared session and each membership RPC
   write exactly one event; a re-push does not duplicate.
3. A forced failure in the event insert still commits `sync_push` and logs a
   sanitized diagnostic (§2.5 pattern).
4. `ios-groups-e2e` green without flow changes.

## Docs touched

`groups-contract.md` (§1 design summary, §2 new table, §4.2 as-built),
`03` decision register (persistent stream).
