# Notifications

### notifications.audience · definition · accepted

Group workout notifications go to every other current member of the groups
sharing the workout, subject to that recipient's permission and preferences —
not only the person overtaken on a leaderboard. The lifter never receives their
own workout alert.

Code: live recipients and handoff checks in `supabase/migrations/20261014133141_notification_workout_events.sql`
and `supabase/migrations/20261014115352_notification_delivery.sql`.

### notifications.defaults · definition · accepted

After opt-in, Activity, Group exercise bests and Leaderboard changes are all
enabled by default. Each category can be disabled and a group muted; app
preferences never bypass the iOS notification permission.

Code: `apps/mobile/src/notifications/lifecycle.ts`; `supabase/migrations/20261014115352_notification_delivery.sql`.

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

Why: limits are logical; external push providers may still show one twice.
Code: `supabase/migrations/20261014133141_notification_workout_events.sql`.

### notifications.achievements · definition · accepted

The summary's bests are improvements to a member's own best on a linked group
exercise under group competition rules, including below first place. A workout
counts one final best per group × group exercise × metric, and one net
before-to-final position change, up or down, per member × group exercise ×
metric × board scope × group.

Code: `apps/mobile/src/notifications/workout-events.ts`; scoring is owned by
`docs/specs/tech/group-competition-contract.md`.

### notifications.freshness · definition · accepted

Activity older than 24 hours does not generate a notification. Delayed sync does
not restart that window. Retries and provider expiry must retain the event's
original deadline.

Why: avoid bursts from old offline history.
Code: `supabase/migrations/20261014115352_notification_delivery.sql`.
