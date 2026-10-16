# M34 — iOS group workout notifications

- Status: `in-progress`
- Created: 2026-10-07, planning baseline `39cd6f8f9576aad248e984d2f93058bc59fbbded` on `origin/main`

## Objective

Make group training visible through native iOS notifications: announce a
workout's start, then deliver one combined completion summary of its group
exercise bests and leaderboard movement. Preserve offline logging, personal
sync, group authorization and competition disclosure.

## Scope

- In: durable server delivery, installation registration, notification
  preferences, group workout producers, full-rank-change detection, native iOS
  permissions, themed expanded notification content, group muting,
  authenticated tap navigation and local verification.
- Out: Android push, private personal-record derivation, a new notification
  inbox, a new workout Achievements section, followers, digests, quiet-hours
  scheduling, and automatic hosted deployment or release. No change to scoring
  or the private sync protocol.

## Agreed design direction

### D1. Product authority

The product owner's decisions live in `docs/product/notifications.md`:
[[notifications.platform]], [[notifications.audience]],
[[notifications.defaults]], [[notifications.workout-delivery]],
[[notifications.achievements]], [[notifications.freshness]],
[[notifications.theme]] and [[notifications.preview]]. Task sessions do not
reopen them. Resolve [[notifications.non-workout-ranks]] with the owner
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
payloads directly into push bodies or routing data. Preview content follows
[[notifications.preview]]; D6 holds the accepted visual target.

Keep private reading details, gym coordinates, private personal records and
disallowed absolute scores out of notification payloads and logs.

### D5. Task-level UI acceptance

The iOS task pins an accepted target under `docs/specs/ui/ai-design-policy.md`
before implementing controls. The proposed direction composes existing
Settings and group-management rows, toggles and inline error states; it is not
an accepted screenshot. Follow [[copy.no-subtitles]] and
[[copy.no-inline-explanation]] rather than adding explanatory screen copy.

### D6. Accepted notification visual target

On 2026-10-14 the owner selected **Record band** (the third completion concept)
and approved its full notification family. This repo-native brief governs
expanded notification content; the Settings/group controls still need D5's
task-level target. It is a build input under
`docs/specs/ui/ai-design-policy.md`, not a specification of shipped pixels.

When implementing T03, inspect the selected
[completion reference](https://github.com/user-attachments/assets/476a3630-c5a3-4432-94d9-9da663b1bd2b)
and [full family](https://github.com/user-attachments/assets/a47b6ac2-4df0-401f-ae84-35fb0d79ffcb),
preserved in [planning PR #734](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/734).
Download local copies into the gitignored
`apps/mobile/artifacts/design/m34-notifications/` directory before implementation;
do not infer the images from their filenames or commit them as runtime assets.

- A flat surface, warm hairline and small card corners compose the existing
  app language; there are no shadows, decorative badges or extra actions.
- Identity and event heading precede compact achievement rows. Bests use a
  full-width record band; leaderboard movement uses a neutral row. Missing
  rows disappear and short notifications shrink to their content.
- Use the app's tokens and typography: Archivo headings, Source Sans 3 prose,
  IBM Plex Mono figures, and existing spacing/type scales. The Warm references
  illustrate the structure; [[notifications.theme]] governs other themes.
- The family covers start, plain completion, completion with either/both
  achievement categories, Activity-off variants and overlapping groups.
  [[notifications.preview]] owns the permitted preview content.

Reference copy for this build input:

| State | Heading |
| --- | --- |
| Start, Activity enabled | `Started a workout at <gym name>` |
| Completion, Activity enabled | `Finished a workout at <gym name>` |
| Activity off, bests only | Group exercise bests |
| Activity off, ranks only | Leaderboard changes |
| Activity off, both | Workout achievements |

The gym label and fallback follow [[notifications.preview]]. The reference
rows read `N new group bests` and `N leaderboard changes`, with
singular wording for one. [[notifications.preview]] governs their visibility.

iOS controls the abbreviated banner; the themed expanded view requires a
native notification content extension, preserving a readable plain-text
fallback. T03 must include its build/signing integration, local theme access,
accessibility and device verification. No server-created image of protected
workout data is part of this target.

M34 notification taps open the existing authorized shared-session page. Adding
an Achievements section is explicitly deferred; the current Group records
section still covers first-place records only. When implementing that separate
follow-up, [issue #733](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/733)
holds the proposal and the reminder to point achievement-bearing notification
cards to the new section. M34 does not depend on that issue being implemented.

## Task breakdown

One card = one session = one local worktree = one PR. Merge this planning PR
before task execution; execute the cards in dependency order.

| Task | Summary | Depends on | Status |
| --- | --- | --- | --- |
| M34-T01-Backend_push_delivery | Installation/preferences RPCs, durable queue, worker and receipts | none | completed |
| [M34-T02-Workout_notification_events](../tasks/M34-T02-Workout_notification_events.md) | Start/completion producers, group bests, all rank movement and overlap deduplication | T01 | completed ([#746](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/746)) |
| [M34-T03-iOS_notification_controls](../tasks/M34-T03-iOS_notification_controls.md) | Native registration, themed content, controls, lifecycle, tap navigation and device acceptance | T01, T02 | in-progress |

## Risks and task-start decisions

- Non-workout rank delivery is deferred under the accepted
  [[notifications.non-workout-ranks]] decision.
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
