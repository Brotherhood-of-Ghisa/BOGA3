# M41-T01 — Permission and atomic workout logging API

- Status: `planned`
- Depends on: none
- Milestone: [M41](../milestones/M41-mcp-workout-logging.md)
- Areas: backend, auth; UI impact: no (permission UI is T02)

## Objective and scope

Provide the authenticated operations behind conversational ad-hoc workout
logging. Deliver active-state reads, start, batch set logging, active-set
update/soft-delete and finish through the existing agent API boundary.
This task adds no MCP tools, mobile toggle, plan execution or completed-history
editing. Follow milestone D1–D5; logging is separately opt-in.

## Baseline to verify

Load `docs/specs/10-api-authn-authz-guidelines.md`, `supabase/README.md` and
`supabase/functions/agent-api/README.md` for the API boundary; load
`docs/specs/05-data-model.md` and
`docs/specs/tech/sync-v2-server-contract.md` for mirrored rows. Inspect current
permission/receipt RPCs before introducing another mechanism. Load
`docs/specs/tech/training-metrics-contract.md` for finalization semantics.

## Open — resolve before coding

- Permission representation, main-switch dependence, live-grant binding and
  revocation; how to gate active-state reads and distinguish denial/conflict.
- Atomic operation schemas, bounded pagination/batches, revision tokens,
  idempotency-key scope and durable replay after a lost response. Preserve
  receipts without retaining private set payloads unnecessarily.
- How start/resume behaves with zero, one or multiple server-visible active
  workouts; serialize concurrent starts without claiming visibility of
  unsynced phone data. Decide empty-session finish behavior and clock defaults.
- Concurrent correction/finish behavior; exercise-block reuse and ordering;
  exercise deletion/merge during logging. Do not infer performed values from
  plan targets. Honor [[set.performed]] and [[set.eligibility]].
- Agree the T02 compatibility strategy before choosing API concurrency fields:
  narrow mutations, conflict detection and any server fence or protocol cutoff
  needed to protect accepted writes from older/stale mobile snapshots. Load
  `docs/procedures/rule-upgrade.md` if the sync protocol must change.

## Deliverables and acceptance

1. Every operation derives ownership from validated identity, checks the new
   permission/live grant, validates canonical values and runs atomically.
   Base OAuth, existing write switches, foreign IDs and revoked grants cannot
   authorize logging; OAuth direct-table/sync denial remains intact.
2. A replay returns original IDs/results; a key reused with changed input
   conflicts. An intentional identical set with a new key creates a new row.
   Mid-batch failure commits neither partial data nor a success receipt.
3. Reads expose explicit active lifecycle state and bounded blocks/sets with
   stable IDs and required concurrency tokens. Missing/conflicting state is
   actionable; a new chat can recover from server state.
4. Mutations require an active, non-deleted session. Concurrent finish/log and
   stale update/delete calls cannot silently modify completed history, lose
   an accepted set or resurrect a session. Finish is retry-safe and stores
   completion time/duration consistently with existing app semantics.
5. Local API/DB contracts and Jest boundary tests prove validation, replay,
   races, ownership, permission/revocation and no completed-history writes.
   Identify group/notification trigger effects before changing write order.
6. No permission enablement path or public MCP tool ships here. Document the
   T02 compatibility/rollout contract and update later cards if it changes.

## Owning docs to update when implementing

- **[[agents.write-access]]** in `docs/product/agents.md`: planned authority
  change, with accurate staged-implementation notes.
- `docs/specs/10-api-authn-authz-guidelines.md`,
  `supabase/functions/agent-api/README.md`, `supabase/README.md`: permission,
  routes, errors, replay and lifecycle contracts.
- `docs/specs/05-data-model.md` and the sync contract above if storage/sync
  invariants change; update the architecture register if its boundary changes.

## Gates

Recompute with `./boga test for`; settle lanes with an independent reviewer.
Expected: `fast`, `backend`, `jest-coverage`, `complexity`, `dependencies`.
`backend` includes `agent-api` and `mcp-smoke`; preserve existing tool behavior.
Add `ios-sync-e2e` if sync/schema changes trigger it on macOS. Obtain independent
code, security and product reviews before opening the implementation PR.
