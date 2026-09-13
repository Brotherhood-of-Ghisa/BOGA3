---
task_id: M25-T01-Group_exercises_server
milestone_id: "M25"
status: planned
ui_impact: "no"
areas: "backend"
runtimes: "supabase|sql|node"
gates: "./boga test fast, ./boga test backend, ./boga test ios-groups-e2e"
docs_touched: "docs/specs/tech/groups-contract.md, docs/specs/10-api-authn-authz-guidelines.md"
---

# M25-T01 — Group exercises (server)

- Depends on: none. Milestone: `docs/plans/milestones/M25-group-exercises-and-leaderboards.md`
- Read: product P1, D8, E0.4; design §1 (T1); `groups-contract.md` §2–§4 (posture and error tokens to copy).

## Objective

A group owns a catalogue of group exercises that owner/admins manage and any
member reads.

## Scope

- Migration: `app_public.group_exercises` per design §1 (`id`, `group_id`,
  `name`, `load_input_mode`, `source_exercise_id`, `archived_at`,
  `created_by`, timestamps), following `groups-contract` §2 ground rules
  (no `owner_user_id`, no FK into Sync v2 tables, RLS on with no policies,
  CHECKs on name and load mode).
- RPCs (§3 posture, §4 error tokens): list for a group (members; archived
  flagged), create custom, copy from a standard id (`source_exercise_id` +
  name + load mode supplied by the client from its seed data), rename /
  change load mode, archive, unarchive (owner/admin).
- Shared TS core type `ExerciseCore = { name, loadInputMode }` and its
  validator in `apps/mobile/src/…` (design §1), used by the RPC client types;
  API wrappers in `src/groups/api.ts` + wire types. No screens.

Out of scope: links, evaluator, any UI.

## Acceptance criteria

1. Members list a group's exercises; non-members get `NOT_FOUND`; members
   calling writes get `FORBIDDEN`; agent tokens `AGENT_FORBIDDEN`.
2. Name and load-mode validation mirrors the personal exercise rules through
   the shared validator (jest) and CHECKs (SQL).
3. Archive/unarchive round-trips; archived exercises are flagged in the list.
4. Direct table access is denied (catalog assertion like the M22 tables).
5. `groups-contract` covers all of the above; `sync-drift --strict` stays green.

## Docs touched

`groups-contract.md` (new table + RPCs as-built), spec `10` if a new authz
rule is introduced.
