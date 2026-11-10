# Agent workout logging

Load when changing conversational workout operations, their permission or app/chat handoff.
Authority is [[agents.write-access]]; performance and eligibility are [[set.performed]] and [[set.eligibility]].

## Boundary and rollout

The path is MCP → agent API → service-only atomic RPCs. Every HTTP request
validates its token and live OAuth grant as the other agent routes do. The
separate `public.agent_workout_permissions` row must enable logging and match
that grant's timestamp. Existing plan switches cannot change or revive this
permission. A missing, disabled or stale grant returns
`403 WORKOUT_PERMISSION_REQUIRED`, including for active-state reads and receipt
replay. Permission rows are non-sync security metadata; no private set payload
is stored there. SQL locks the permission through commit; revocation waits for
an already-authorized transaction to finish.

The owner app alone manages this table through owner-scoped RLS. OAuth tokens
cannot inspect or change it. Connected Agents keeps logging independent of
both plan switches; failed reads or unconfirmed saves display unavailable
until a reload confirms the value. Code integration does not authorize hosted
migration, activation or deployment.

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

## Mobile handoff

### Exclusive session control

`sessions.logging_client_id` and `logging_granted_at` are server-maintained,
nullable sync columns. Null means human control; an MCP start binds both to
the caller and its live grant. Ordinary phone inserts remain human-controlled.
Sync projects these columns but ignores incoming assignments. A separate graph
trigger enforces the control boundary even for privileged merge/recovery
writers; it does not trust the generic merge-internal flag. MCP completion
releases control so completed-history editing remains available in the app.

The app-only `workout_set_control` RPC uses the owner lock, an immutable action
ID and the loaded session epoch. Human-to-MCP assignment checks and locks the
selected client's live consent and independent logging permission, rejects
plan-backed workouts and unresolved saved input, and fences the whole graph.
Takeover needs no remaining agent permission. Both directions preserve all
workout/block/set IDs. An old receipt reports current control without reapplying
its transfer; a changed payload under its ID fails. Reauthorization never
revives control bound to an earlier grant.

The app converges sync before transferring and again before unlocking. It
persists an unconfirmed request in account-private control storage, keeps
editing locked across restart, and retries the same operation. A clean newer
terminal epoch makes an old pending active-session handoff obsolete. A stale
editor arriving after a known AI-control fence preserves only its actual
changes at the original epoch for review. Recovery Apply remains locked until
human takeover; explicitly declining saved input remains available.

The recorder's existing Finish position shows a robot while AI controls the
session. It opens the existing Session sheet, which offers Take over logging;
human control offers Let AI log this session and an authorised-client chooser
when needed. Add exercise, gym/set editing, Finish and Abandon stay locked;
the device-local timer remains independent. There is no persistent status
banner. Unavailable or unconfirmed transfers never imply a successful grant.

Every active-header/selected MCP read and mutation reports `control` with
`owner`, `client_id` and Boolean `can_edit`. A displaced client's next write
or active-session receipt replay returns `409 WORKOUT_CONTROL_REQUIRED` with
handoff guidance. No tool can claim control. This is notification on the next
workout call; the stateless MCP transport provides no unsolicited push channel.

### Revision and recovery protection

Protocol 7 extends the existing revision/snapshot/recovery contract. Every
agent write advances one session epoch across its entire graph, including
empty workouts. Factor-one contexts retain raw units. Old app writers fail
before push or pull; rollout is a coordinated server-first cutover with app
distribution, following the [sync contract](sync-v2-server-contract.md) and,
when changing activation, `docs/procedures/rule-upgrade.md`.

Canonical snapshots preserve stale dirty headers, absent offline blocks and
their children before replacement, even across split batches or future clocks.
Editors retain the graph they loaded. Independent changes rebase; unseen
remote rows survive; conflicting actual input is saved for explicit review.
A saved-for-review outcome refreshes the editor and stops stale resubmission.
Recovery metadata retains canonical lifecycle; missing parents apply before
children, and removed parents require restoration. Sessions lists every active
workout separately and opening a row retains that selected ID on return.

Protected phone headers drain their dirty graph first, then use an immutable
lifecycle action ID and loaded epoch. The server atomically commits the header,
whole-graph fence and receipt; replay cannot act as a new stale reopen/delete.
Receipt lookup verifies the original input before a lost response is recovered.
History merges and recovery commits also advance already-protected sessions'
epochs, without changing legacy revision-zero behavior. Details for shared
recovery are in [the history merge contract](exercise-merge-contract.md).
Proof: Jest validates the shared HTTP input boundary; `agent-api` runs real
OAuth/SQL contracts for permission, replay, graph writes, ownership and lifecycle.
Handoff additionally requires repository/sync regressions and `ios-sync-e2e`.
