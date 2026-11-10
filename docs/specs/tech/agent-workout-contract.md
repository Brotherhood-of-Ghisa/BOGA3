# Agent workout logging

Load when changing conversational workout operations, their permission or app/chat handoff.
Authority is [[agents.write-access]]; performance and eligibility are [[set.performed]] and [[set.eligibility]].

## Boundary and staged rollout

The path is MCP → agent API → service-only atomic RPCs. Every HTTP request
validates its token and live OAuth grant as the other agent routes do. The
separate `public.agent_workout_permissions` row must enable logging and match
that grant's timestamp. Existing plan switches cannot change or revive this
permission. A missing, disabled or stale grant returns
`403 WORKOUT_PERMISSION_REQUIRED`, including for active-state reads and receipt
replay. Permission rows are non-sync security metadata; no private set payload
is stored there. SQL locks the permission through commit; revocation waits for
an already-authorized transaction to finish.

**Staged implementation:** authenticated app access to this table is withheld.
Only local service fixtures enable it. No mobile enablement or MCP catalogue
entry may ship before the handoff fence below is implemented and verified.
Code integration does not authorize hosted migration, activation or deployment.

## HTTP operations

All paths have prefix `/v1/agent`. Responses retain the standard agent API
envelope and no-store/audit behavior. Request timestamps are not accepted;
server time starts and finishes an ad-hoc workout. Response times are ISO 8601.

| Method/path | Input | Result |
| --- | --- | --- |
| GET `/workouts/active` | optional `session_id`, `limit` (1–100, default 50), `cursor`, `revision` | active headers, or one selected workout's lifecycle, graph revision and page of raw exercise/set rows |
| POST `/workouts/start` | optional `gym_id` | stable `session_id`, revision and active status |
| POST `/workouts/log-sets` | `session_id`, `expected_revision`, exactly one of `exercise_id`/`session_exercise_id`, `sets` | block ID, inserted set IDs and new revision |
| POST `/workouts/update-set` | `session_id`, `expected_revision`, `set_id`, `set` | corrected set ID and new revision |
| POST `/workouts/delete-set` | `session_id`, `expected_revision`, `set_id` | soft-deleted set ID and new revision |
| POST `/workouts/finish` | `session_id`, `expected_revision` | completed lifecycle, time/duration and revision |

A performed input is `{weight_kg: "80", reps: 8, set_type: "rir_2"}`.
Weight is explicit nonnegative decimal text in canonical kg; `"0"` means no
external load. It retains the definition's total/per-side input meaning.
Effort is optional (null), or one of the current selectable app efforts. Reps
use the shared parser's cap. No targets, units, owner fields or performance
status can be supplied. A batch has 1–30 sets. Corrections replace explicit
performance only; planned values/provenance remain unchanged.

Active discovery sees only synced server rows. It cannot discover an offline
phone's unsynced workout. Start refuses while any server-visible workout is
active (`409 ACTIVE_WORKOUT_CONFLICT`), including several active workouts;
the caller must read and choose a persisted ID. It never implicitly resumes,
merges or finishes another session. Each ID remains independently discoverable.
Empty workouts may finish, with no metric footprint under [[set.eligibility]].

Selecting a workout returns its current lifecycle even after completion or
deletion. Raw rows are bounded, ordered by opaque cursor key (exercise rows,
then set rows, each by stable ID), with `order_index` for presentation order.
Follow `next_cursor` with the same workout revision; a changed graph returns
`409 REVISION_CONFLICT` instead of silently skipping rows. Active-header pages
are ordered by ID. `visibility: server_synced_only` is always explicit.
Active reads return raw drafts too; they do not publish new derived metrics.

## Concurrency and retries

All operations share the existing per-owner history advisory lock, before
tuple locks; sync, direct domain writes and exercise merges use the same lock.
The opaque graph revision fingerprints session, block, set, tag and linked
definition content, including tombstones. Every non-start write compares it
before mutation. A finished/deleted session is `409 WORKOUT_NOT_ACTIVE`;
foreign/missing IDs are indistinguishable (`404 NOT_FOUND`, or
`400 FOREIGN_RESOURCE_REFERENCE` for catalogue references).

Logging an exercise reuses its sole live block; several matching blocks require
an explicit block ID (`409 AMBIGUOUS_EXERCISE_BLOCK`). No match creates an
ordinary block, without authored-plan execution or consumption. A deleted
definition cannot receive new logs. App-authored provenance is preserved.
New rows append after occupied slots, tombstones included.
An active workout carrying authored-plan provenance is readable with
`requires_app: true`; its mutations return `409 WORKOUT_REQUIRES_APP`.
Continue that workout in the app, preserving [[planner.block-completion]].
Logging neither executes nor consumes authored plans in this release.

All POSTs require `Idempotency-Key` (the existing printable 1–128-character
contract). Receipts reuse `public.agent_plan_write_receipts`, scoped by owner,
client and operation. The normalized-input hash and original result IDs/tokens
are committed in the same transaction as every row. Changed input under a key
is `409 IDEMPOTENCY_CONFLICT`. Same input replays the original result even if
the workout has since changed; read again for current state. Another intentional
identical set uses a fresh key and current revision. A stale request uses a
fresh key only after reading and confirming its intended change.

Writes stamp beyond the graph's clocks. Finish updates the session last, stores
one server completion instant and `max(0, floor((end-start)/1000))`, and retains
the existing group and notification triggers. A chat finish alone does not
fabricate the app's exact-graph completion-notification confirmation; that
remains the normal post-convergence app path.

## Required handoff protection before enablement

Extend the existing revision/snapshot/saved-change recovery contract, rather
than relying on per-row clocks. A factor-one context protects raw values without
changing exercise units. Fence the session and every block on each agent write,
including empty sessions. New offline blocks carry the session revision they
were created under, so they cannot bypass a remote finish through a later batch.
Preserve stale session and child edits for explicit recovery before replacing
them with canonical server state; force canonical lifecycle even over a future
local clock. Recovery must support blocks absent from the canonical graph.

Whole-graph autosave and narrow/lifecycle writers must carry the revision loaded
by their editor. Stale same-exercise input cannot tombstone a chat-created set.
Finished/deleted remote sessions cannot be silently reopened. Fresh intentional
app edits/removals and deliberate completed-history editing must still work.
Use a coordinated server-first protocol cutoff if older clients cannot echo
these invariants; never treat a new permission as a sync fence. When changing
that cutoff, load `docs/procedures/rule-upgrade.md` and the
[sync contract](sync-v2-server-contract.md).

Proof: Jest validates the shared HTTP input boundary; `agent-api` runs real
OAuth/SQL contracts for permission, replay, graph writes, ownership and lifecycle.
Handoff additionally requires repository/sync regressions and `ios-sync-e2e`.
