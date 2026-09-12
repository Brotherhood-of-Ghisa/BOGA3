---
task_id: T-20260912-01-Groups_mobile_sync_isolation_test
milestone_id: "M22-followup"
status: planned
ui_impact: "no"
areas: "frontend"
runtimes: "node"
gates_fast: "./boga test fast; ./boga test handles"
gates_slow: "N/A"
docs_touched: "docs/specs/06-testing-strategy.md (only if a new coverage policy is added)"
---

# T-20260912-01 — Mobile proof that group failures leave personal sync alone

## Task metadata

- Task ID: `T-20260912-01-Groups_mobile_sync_isolation_test`
- Status: `planned`
- Origin: the M22-T07 acceptance matrix
  (`docs/plans/milestones/M22-groups-and-foundations.md`, completion
  note, AC13).

## Parent references (required)

- Contract: `docs/specs/tech/groups-contract.md` §6 (mobile client) and §2.5
  (trigger failure isolation)
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Sync tests policy: `apps/mobile/app/__tests__/sync/README.md` (read before
  adding tests there)

## Objective

M22 AC13 says personal logging and sync behave exactly as before when group
features fail or are unreachable. The server half is proven by
`supabase/tests/groups-contract.sh` ("share trigger failure isolation":
a forced share failure still returns `sync_push ok:true`). The mobile half has
no targeted test. Today it rests only on `src/sync` and `src/groups` not
importing each other and on the existing sync lanes staying green.

## Scope / acceptance criteria

1. A jest test proves that a group RPC failure (transport failure, `NOT_FOUND`,
   `FORBIDDEN`, a thrown call) leaves these unchanged: the sync scheduler, the
   sync status snapshot, and local session logging (draft autosave and
   completion writes).
2. A guard fails if `apps/mobile/src/sync/**` imports
   `apps/mobile/src/groups/**`, or the reverse. Either a lint rule or a jest
   import-graph check will do.
3. No app behaviour change. If the test finds a real coupling, fix it
   minimally and record it as a deviation.

## Evidence

## Completion note

- What changed:
- What tests ran:
- What remains:
