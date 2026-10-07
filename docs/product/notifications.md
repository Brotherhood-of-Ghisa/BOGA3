# Notifications

The product owner accepted these rules on 2026-10-07. They describe the first
notification release; runtime implementation is pending.

### notifications.platform · definition · accepted

The first release delivers native iOS push notifications. Android delivery is
outside this release.

Why: ship and verify the platform the app currently exercises locally first.
Pending: native notification registration and delivery are not implemented.

### notifications.audience · definition · accepted

Group workout notifications go to every other current member of the groups
sharing the workout, subject to that recipient's permission and notification
preferences. They are not limited to the person overtaken on a leaderboard.
The lifter does not receive their own workout alert.

Why: the group follows its members' training and competition together.
Pending: recipient selection and preference checks are not implemented.

### notifications.defaults · definition · accepted

After the user opts in, Activity, Group exercise bests and Leaderboard changes
are all enabled by default. Each category can be disabled, and a group can be
muted. Enabling app preferences never bypasses the iOS notification permission.

Why: activity is part of the requested experience alongside achievements.
Pending: app controls and server preferences are not implemented.

### notifications.workout-delivery · definition · accepted

| Workout moment | Notification |
| --- | --- |
| Starts and reaches the server while still active | One start alert |
| Completes | One combined completion summary, including enabled group exercise bests and leaderboard changes |
| First reaches the server already completed | Completion summary only; no misleading start alert |

A recipient gets at most two logical notifications for the same lifter's
workout. Sharing through several groups does not multiply that recipient's
alerts; each summary contains only information from groups they can access.
Achievements during training are collected for the completion summary, not
sent as separate alerts.

Why: announce training immediately, then collect its results without a series
of achievement alerts. Logical notification limits do not promise exactly-once
display by the external push providers.
Pending: workout notification lifecycle and deduplication are not implemented.

### notifications.achievements · definition · accepted

The summary's bests are improvements to a member's own best on a linked group
exercise under the existing group competition rules. They are not restricted
to group-wide first place or derived from private personal history/device
preferences. Leaderboard notification eligibility includes every position
change, upward or downward, not just a change of leader.

Why: group achievements and movement should be visible to the whole group.
Code: current scoring and disclosure are owned by
`docs/specs/tech/group-competition-contract.md`; notification detection is pending.
Pending: best and full-rank-change collection for completion summaries.

### notifications.freshness · definition · accepted

Activity older than 24 hours does not generate a notification. Delayed sync does
not restart that window. Retries and provider expiry must retain the event's
original deadline.

Why: old offline history should not produce a burst of current activity alerts.
Pending: event-time filtering and delivery expiry are not implemented.

### notifications.non-workout-ranks · definition · open

Rank movements can also result from certification, corrections, links,
membership changes or competition-rule changes, without a new workout starting
or completing. How those movements are delivered and batched under the workout
notification limit is undecided. A builder adding that path must ask the
product owner; they must not silently narrow position-change eligibility to
first place or introduce extra workout alerts.

Why: the accepted start/completion sequence does not define a notification
moment for these changes.
Code: `supabase/functions/group-eval/index.ts` and the group competition
publication migrations already process these causes.
