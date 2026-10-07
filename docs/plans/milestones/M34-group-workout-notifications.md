# M34 — iOS group workout notifications

- Status: `planned`
- Created: 2026-10-07, planning baseline `39cd6f8f9576aad248e984d2f93058bc59fbbded` on `origin/main`

## Objective

Make group training visible through native iOS notifications: announce a
workout's start, then deliver one combined completion summary of its group
exercise bests and leaderboard movement. Preserve offline logging, personal
sync, group authorization and competition disclosure.

## Scope

- In: durable server delivery, installation registration, notification
  preferences, group workout producers, full-rank-change detection, native iOS
  permissions, group muting, authenticated tap navigation and local verification.
- Out: Android push, private personal-record derivation, a new notification
  inbox, followers, digests, quiet-hours scheduling, and automatic hosted
  deployment or release. No change to scoring or the private sync protocol.

## Agreed design direction

### D1. Product authority

The product owner's decisions live in `docs/product/notifications.md`:
[[notifications.platform]], [[notifications.audience]],
[[notifications.defaults]], [[notifications.workout-delivery]],
[[notifications.achievements]] and [[notifications.freshness]]. Task sessions
do not reopen them. Resolve [[notifications.non-workout-ranks]] with the owner
before implementing rank delivery outside the workout lifecycle.

### D2. Reuse the server group pipeline

The share ledger and published competition results are the source boundary
(`docs/specs/tech/groups-contract.md`,
`docs/specs/tech/group-competition-contract.md`). Add a separate operational
delivery queue and worker. Keep registration, preferences and deliveries out
of private Sync v2 scope, and avoid an `owner_user_id` column on operational
tables that the drift checker would classify as sync entities.

Every producer touching a synced table is failure-isolated. No notification
request or provider outage can abort workout saving or `sync_push`. The first
two implementation PRs remain dormant until a compatible recipient has opted
in; local tests use a deterministic provider sink rather than contacting real
group members.

### D3. Completion is a graph boundary

A completed session row may arrive before its exercise/set rows. A notification
cannot assume that row means the entire workout has arrived. The event task
must design and test how it waits for a coherent evaluated graph, handles
later generations before dispatch and recovers failed intake. A quiet period
alone is not proof that all future offline rows have arrived. State the
bounded completeness guarantee and any remaining late-row limitation in the
owning technical contract before implementation review.

### D4. Notification content is a public projection

Compose per-recipient content only from currently authorized group context,
with the active competition disclosure. Never copy privileged raw event
payloads directly into push bodies or routing data. Initial examples are copy
proposals, not approved visual targets:

- Start: “Alex started a workout.”
- Summary: “Alex finished a workout · 2 new group bests · 3 leaderboard changes.”

Keep private reading details, gym coordinates, private personal records and
disallowed absolute scores out of notification payloads and logs.

### D5. Task-level UI acceptance

The iOS task pins an accepted target under `docs/specs/ui/ai-design-policy.md`
before implementing controls. The proposed direction composes existing
Settings and group-management rows, toggles and inline error states; it is not
an accepted screenshot. Follow [[copy.no-subtitles]] and
[[copy.no-inline-explanation]] rather than adding explanatory screen copy.

## Task breakdown

One card = one session = one local worktree = one PR. Merge this planning PR
before task execution; execute the cards in dependency order.

| Task | Summary | Depends on | Status |
| --- | --- | --- | --- |
| [M34-T01-Backend_push_delivery](../tasks/M34-T01-Backend_push_delivery.md) | Installation/preferences RPCs, durable queue, worker and receipts | none | planned |
| [M34-T02-Workout_notification_events](../tasks/M34-T02-Workout_notification_events.md) | Start/completion producers, group bests, all rank movement and overlap deduplication | T01 | planned |
| [M34-T03-iOS_notification_controls](../tasks/M34-T03-iOS_notification_controls.md) | Native registration, controls, lifecycle, tap navigation and device acceptance | T01, T02 | planned |

## Risks and task-start decisions

- Resolve non-workout rank delivery with the owner in T02; it remains an open
  product fact, not an exclusion inferred by this plan.
- Existing `session` events appear at first share, and existing `lead_change`
  history covers first place. Neither is a complete completion/full-rank signal.
- Active-session records are provisional. Sending a summary requires current
  authorization, coherent publication, and a decision about partial/late graphs.
- Installation reassignment, sign-out while offline, and revocation require an
  explicit fail-closed lifecycle design; best-effort unregister alone does not
  guarantee that a previous account stops receiving server-originated content.
- Provider success means accepted handoff, not proof of display. Preserve
  logical idempotency without claiming exactly-once external delivery.

## Validation and rollout

Cards propose lane sets; they are not operator agreement to run them. Before
each implementation PR, run `./boga test for`, agree any lanes beyond `fast`,
then get the agreed set and `jest-coverage`, `complexity`, `dependencies` green.
No new Maestro flow/scenario is authorized by this plan: seek approval with
the device-only claim first, per spec 06. Use Jest for decision matrices, local
SQL/Edge contracts for authorization and provider handling, and device evidence
for native permission, cold-launch navigation and actual delivery.

Hosted credentials, worker deployment and an iOS release need explicit release
authority. At T03 closeout, give the operator a concrete rollout procedure and
local evidence; do not treat planning approval as permission to deploy or
notify production members. Run the release sweep only at the release boundary.

Implementation PRs move durable architecture into the owning specs, remove
their completed cards, and mark the task completed here. The last task deletes
this milestone. Evidence remains in the PRs, not these ephemeral documents.
