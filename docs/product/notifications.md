# Notifications

Accepted 2026-10-07; theme/preview approved 2026-10-14, gym wording 2026-10-16.

### notifications.platform · definition · accepted

The first release delivers native iOS push notifications; Android is outside
it.

Why: verify the app's current platform first.
Code: `apps/mobile/src/notifications/native-adapter.ts` and
`apps/mobile/modules/boga-notifications/`.

### notifications.audience · definition · accepted

Group workout notifications go to every other current member of the groups
sharing the workout, subject to that recipient's permission and preferences —
not only the person overtaken on a leaderboard. The lifter never receives their
own workout alert.

Why: members follow group training and competition.
Code: live recipients and handoff checks in `supabase/migrations/20261014133141_notification_workout_events.sql`
and `supabase/migrations/20261014115352_notification_delivery.sql`.

### notifications.defaults · definition · accepted

After opt-in, Activity, Group exercise bests and Leaderboard changes are all
enabled by default. Each category can be disabled and a group muted; app
preferences never bypass the iOS notification permission.

Why: activity belongs alongside achievements.
Code: server category/mute RPCs in `supabase/migrations/20261014115352_notification_delivery.sql`.
Code: `apps/mobile/components/notifications/` and
`apps/mobile/src/notifications/lifecycle.ts`.

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

Why: announce training, then collect achievements. Logical notification limits
do not promise exactly-once display by external push providers.
Code: `supabase/migrations/20261014133141_notification_workout_events.sql`.

### notifications.achievements · definition · accepted

The summary's bests are improvements to a member's own best on a linked group
exercise under existing group competition rules, including below first place;
private personal history/device preferences never supply them. Count one final
best per group × group exercise × metric for the workout: Volume and 1RM count
twice, two groups separately, repeated autosaves once. Count one net
before-to-final position change per member × group exercise × metric × board
scope × group, upward or downward. Intermediate hops do not multiply it;
returning to the original position counts zero.

Why: group achievements and movement should be visible to the whole group.
Code: current scoring and disclosure are owned by
`docs/specs/tech/group-competition-contract.md`; final counting in
`apps/mobile/src/notifications/workout-events.ts`, evidence in
`supabase/migrations/20261014133141_notification_workout_events.sql`.

### notifications.freshness · definition · accepted

Activity older than 24 hours does not generate a notification. Delayed sync does
not restart that window. Retries and provider expiry must retain the event's
original deadline.

Why: avoid bursts from old offline history.
Code: immutable intent deadline and delivery expiry in `supabase/migrations/20261014115352_notification_delivery.sql`.
Code: original event-time filtering in `supabase/migrations/20261014133141_notification_workout_events.sql`.

### notifications.completion-readiness · definition · accepted

A completion summary requires a compatible app to confirm its uploaded workout
graph and the server to verify matching evaluated results. Older app versions
without confirmation produce no completion summaries.

Why: completion can arrive before final exercise and set rows.
Code: authenticated graph confirmation in `supabase/migrations/20261014133141_notification_workout_events.sql`.
Code: quiet-sync graph submission in `apps/mobile/src/notifications/completion.ts`.

### notifications.non-workout-ranks · definition · accepted

The first release delivers workout-origin rank changes. Standalone changes
from certification, corrections, links, membership or competition rules are
deferred to a separately designed board-update notification. This excludes
those causes, not non-first or downward positions within workout alerts.

Why: standalone board changes need their own batching, expiry and design.
Pending: [board-update notification proposal #737](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/737).

### notifications.theme · presentation · accepted

Expanded notification content follows the recipient's currently applied app
theme, including custom colours. The abbreviated banner retains the iOS system
appearance. Warm-theme examples do not fix the notification palette for every
user.

Why: match the app within iOS presentation constraints.
Code: `apps/mobile/modules/boga-notifications/ios/extensions/BogaNotificationContent.swift`.

### notifications.preview · presentation · accepted

An alert identifies the lifter and one contributing group, or `N groups` when
several contribute. Activity headings read `Started a workout at <gym name>` or
`Finished a workout at <gym name>`, using `a secret location` when no mapped gym
name is available. Previews show positive enabled achievement counts, without
exercise names or lifting figures. Disabled and zero-count rows are omitted.
Activity-off previews omit start/completion wording. Only enabled, currently
authorized groups contribute.

Why: keep previews compact; show details in the authorized app view.
Code: `supabase/migrations/20261016164705_notification_workout_location.sql`.
Code: `apps/mobile/modules/boga-notifications/ios/extensions/BogaNotificationContent.swift`.

### notifications.foreground · presentation · accepted

While BOGA is open, an eligible incoming notification shows the normal iOS
banner without sound. Receiving it never navigates away from the current screen;
opening its workout requires a tap.

Why: visible alerts preserve the current screen.
Code: `apps/mobile/src/notifications/native-adapter.ts`.
