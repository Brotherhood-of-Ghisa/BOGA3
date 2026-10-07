# M34-T02-Workout_notification_events — Starts and completion summaries

- Status: `planned`
- Depends on: [M34-T01-Backend_push_delivery](M34-T01-Backend_push_delivery.md)
- Milestone: [M34](../milestones/M34-group-workout-notifications.md)
- Areas: backend, group domain; UI impact: no

## Objective

Produce start alerts and completion summaries from accepted shared workouts
and coherent group competition publication. Collect group bests and every
eligible rank movement without making autosave, replay, overlapping groups or
worker retries create additional logical notifications.

## Scope

- In: failure-isolated event intake/recovery, workout lifecycle, completion
  readiness, group-best collection, full-rank differences, recipient-specific
  overlap batching and authorization-safe queue payloads.
- Out: new scoring rules, private personal-record calculations, mobile UI,
  private sync protocol changes, deployment and production notifications.

## Decided

M34 D1–D4 apply; [[notifications.audience]],
[[notifications.workout-delivery]], [[notifications.achievements]] and
[[notifications.freshness]] are authoritative. Records/eligibility and public
units remain the existing competition contract and [[set.eligibility]]. Do not
turn personal device facts into shared notification authority.

## Open — resolve with the user at session start

Resolve [[notifications.non-workout-ranks]] with concrete cases: a witness
changes Certified rank, a correction/deletion changes old-workout rank, and a
link/membership/rule change moves a board. Decide how those changes are batched
and expired without violating the workout limit. Write the approved fact before
coding that path. No builder may silently skip these cases or manufacture a
third workout notification.

## Technical design before coding

Inspect current protocol-4 publication, the share ledger, provisional record
lifecycle and the FK-ordered sync batches. Write a brief source/intake design
in the owning notification technical contract before adding producers:

- Where start/completion identities are persisted and how an isolated missed
  trigger is recovered without replaying old history.
- How completion readiness binds the session plus its evaluated source graph;
  pending generations invalidate an unsent summary. A completed row, an empty
  current queue or a timer alone cannot prove all future rows have arrived.
  State the late-row limitation or design a compatible completeness boundary;
  changing private sync requires explicit scope agreement first.
- Where before/after ranks are captured under the same coherent publication
  locks, and how already-ranked unaffected entries moving downward are found.
  Existing `lead_change` history only identifies changes of first place.
- How source activity time, deployment cutover, historical catch-up and expiry
  are distinguished; no fresh deadline from event backfill or new retry time.

## Deliverables and acceptance

1. A newly shared active workout produces one start intent per eligible
   recipient. Every accepted autosave, same-clock LWW replay and additional
   sharing group reuses that identity. An already completed late upload produces
   no start intent. Deleted or no-longer-shared sources cannot dispatch.
2. Completing the workout schedules one summary. Before dispatch, wait for the
   designed readiness boundary and validate the current source generation,
   relevant evaluated targets and disclosure. Late rows arriving before send
   rebuild it; a stalled evaluator remains pending/recoverable rather than
   claiming zero achievements. After acknowledged summary delivery, replay or
   reopen/re-complete cannot emit another lifecycle summary.
   Fence logical dispatch order across concurrent workers: supersede an unsent
   or retrying start once completion makes it misleading, and never hand off a
   start after the summary. Resolve an in-flight start claim before summary
   handoff without blocking indefinitely. External provider display order is
   best effort and is not guaranteed by this sequencing.
3. Collect current non-voided per-member group exercise bests using existing
   group record meaning and units; a best need not take group-wide first place.
   A provisional record retracted before completion is absent.
   Do not relabel a rule/link/certification recompute as a newly performed best.
   Include a fixture where a member improves their own best while remaining
   below first place; the achievement must still appear in their summary.
4. Compare full authoritative rank order for every affected group comparison,
   metric and board scope. Include non-first moves, downward moves of other
   members, tied-score ordering, initial placement and loss of placement where
   the approved cause policy allows them. Preserve all eligible movement when
   batching; the owner settles non-workout cases above. Test movements that the
   current leader-change event cannot represent.
5. Identity includes recipient and the lifter's composite workout identity;
   several common groups share the lifecycle budget. Content is assembled from
   only that recipient's enabled, currently authorized groups. Muting one group
   does not silence another eligible group or leak the muted group's results.
6. Activity determines start/plain completion visibility; enabled best/rank
   categories determine summary achievements. If Activity is disabled and no
   enabled achievement remains, send no empty summary. Default preferences are
   read from the server, not inferred from a newly installed device.
7. Producer/intake failures are sanitized and failure-isolated from `sync_push`.
   A recovery pass and deduplication repair missed work. Expired historical
   sources and initial backfill do not masquerade as newly started training.
8. Notification bodies/data use a current authorized public projection. Include
   no private bodyweight tuple/digest, gym GPS, personal PR history or forbidden
   absolute score, including after a disclosure switch while a job waits.

## Canonical proof allocation

- Jest: rank-difference/batching decisions, category combinations, overlapping
  group recipients, deadline and lifecycle matrices.
- Local group contracts: accepted active/completed sync writes into intents,
  failure isolation/recovery, source-generation races, provisional retraction,
  full-rank publication and privacy/membership/preferences changes before send.
- Provider sink: emitted start then one summary for a finished fixture, and
  completion-only for a fresh offline-completed fixture. Use direct fixture
  state for rule matrices; reserve full sync for intake/ordering assertions.
  Exercise both intents queued together, a start awaiting retry, and a claimed
  start racing completion on another worker. Assert no start handoff after the
  summary, no stale claim revival, and progress after a failed/expired claim.
- Keep protocol-4 upgrade/activation assertions in `groups-protocol4` when
  touched; do not duplicate rank arithmetic in Maestro or change scoring to
  make notification tests pass.

## Specs to update

- `docs/specs/tech/groups-contract.md` — failure-isolated notification hooks and
  the removal of push notifications from its Not built list when implemented.
- `docs/specs/tech/group-competition-contract.md` — publication/rank hooks only,
  preserving calculation, authorization and representation rules.
- The owning notification technical contract created by T01 — intake,
  readiness, source time, batching and late-row semantics.
- `docs/product/notifications.md` — approved open-fact resolution and satisfied
  Pending lines; do not change accepted scoring facts.

## Gates

Proposed: `fast`, `backend`, `groups-api-live`, `ios-groups-e2e`, plus
`groups-protocol4` if competition publication/migrations change. `groups-api-live`
already belongs to `backend`; record its evidence rather than running twice.
Use `./boga test for` and agree any lowering for this server-only diff before
running beyond `fast`. If private sync is explicitly expanded, add the sync
defaults including `ios-sync-e2e`. Run the three quality targets before the PR.
No new Maestro scenario is approved by this card.

Review code/security and product facts. Delete this card and mark T02 completed
in M34 in the implementing PR; follow the task protocol's stack and worktree
cleanup rules.
