# M34-T03-iOS_notification_controls — iOS opt-in, controls and tap navigation

- Status: `planned`
- Depends on: [M34-T01-Backend_push_delivery](M34-T01-Backend_push_delivery.md), [M34-T02-Workout_notification_events](M34-T02-Workout_notification_events.md)
- Milestone: [M34](../milestones/M34-group-workout-notifications.md)
- Areas: frontend, auth lifecycle, cross-stack; UI impact: yes

## Objective

Let an authenticated iOS user enable group notifications, control categories
and mute groups, and open the authorized workout/group from an alert. Verify
the complete start/completion experience on a signed device and preserve the
root authentication/first-sync gates.

## Scope

- In: `expo-notifications` native configuration, installation registration,
  account/permission lifecycle, preferences UI, group muting, validated tap
  intents, error/offline states, screenshots and device delivery acceptance.
- Out: Android integration, a notification inbox, live activities, followers,
  digests, new scoring, hosted deployment and an automatic release.

## Decided

M34 D1–D5 and all accepted notification facts apply. Permission is requested
after a user action, not merely because the app cold-launches. An OS refusal
does not block the app, logging or sync. Reuse existing server preferences and
the failure-isolated sender; do not create a mobile group-push path.

## Open — resolve with the user at session start

Pin the accepted design target per `docs/specs/ui/ai-design-policy.md`: either
approved repo-native brief plus selected reference screenshots, or named
Figma/Claude Design artifacts. The layout/copy proposals below are not accepted
visuals. Set foreground presentation (banner/sound while viewing the same
group) and preview detail with the owner if they materially affect the product.
Do not reopen the settled trigger, recipient, platform or batching choices.

## Deliverables and acceptance

1. Add SDK-compatible native notification dependencies/plugin and iOS signing
   configuration. Obtain per-installation Expo tokens from the current EAS
   project, preserve development/production environment separation, and rebuild
   the dev client with `./boga ios build-client --force` before device lanes.
   Push credentials stay server/build-side. Android and unsupported/local-only
   builds stay usable without attempting iOS registration.
2. An injectable native adapter owns permission, token rotation, listener
   cleanup and received/tap events outside route code. Registration follows the
   authenticated account and opt-in lifecycle defined by T01, including its
   offline sign-out/reassignment design. Never send an old account's protected
   notification into a new account's route or cache.
3. Preferences come from the account's server state; displays reflect denied,
   provisional/granted, disabled and failed-registration states accurately.
   Successful writes persist; failed/offline writes leave the last confirmed
   state visible with retry. Group muting requires current membership.
4. Validate a typed internal notification payload: reject malformed targets,
   arbitrary URLs and wrong account/environment. Save only the minimum pending
   tap intent; authenticate and finish bootstrap before checking group access
   and navigating. Repeated delivery/taps do not stack duplicate routes.
5. A removed member, deleted group/session or unavailable network produces an
   honest existing unavailable/offline state. A cached permission or push token
   is not membership authority. Notification routing preserves native Back and
   the existing root protected stack.
6. A signed iOS installation receives the start alert with the app in the
   background/closed, then one completion summary with verified group bests and
   non-first rank movement. Test overlapping groups, fresh offline completion,
   denied permission, muting, category switches, token invalidation and account
   switching with the local sink/adapter where native delivery is not the claim.
   Device/provider handoff evidence is separate from local unit success.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Enable notifications | Open Notifications from Settings; choose Enable; complete iOS permission; register installation | Confirmed enabled state; server defaults are reflected | Denial offers Open iOS Settings; registration/network failure has Retry without blocking the app |
| Change categories | Open Notifications; change Activity, Group exercise bests or Leaderboard changes | Confirmed account preference persists and affects the next send | Failed/offline write keeps confirmed state and offers Retry |
| Mute a group | Open a group's notification control; change its mute state | Only that group's contribution is muted for this recipient | Lost membership becomes unavailable; another authorized group's contribution still works |
| Tap a start/summary alert | iOS opens app; validate intent; restore/sign in; complete bootstrap; check target access; open group-bound workout context | Correct member/workout context and native Back navigation | Wrong account, deleted target or lost access opens safe unavailable state; offline cannot imply fresh authorization |
| Revoke or switch account | Revoke OS permission or sign out/switch; apply installation lifecycle; refresh status on return | No new registration/send eligibility for the revoked/previous binding; permitted account can register | Offline cleanup follows T01's documented fail-closed design; no claim that a failed unregister succeeded |

Appearance proposal: use existing Settings/group rows and shared toggles; no
explanatory subtitles, debug queue details or delivery-provider terminology.
Permission/consent copy follows [[copy.no-inline-explanation]]'s exception.
Follow [[copy.no-subtitles]]. Compare runtime screenshots for enabled, denied,
failed-write and muted states with the accepted target.

## Canonical proof allocation

- Jest: adapter branches, token/account ownership, preferences and real-data
  screen states, validated pending intents and route-gating decisions. Load
  the test-directory README and writing-tests spec before editing suites.
- Local contracts/live client: actual registration/preferences RPC wire and
  unauthorized/cross-account denial through the app adapter.
- Device evidence: OS permission, actual push delivery, cold-launch handling,
  native Back, sign-in/first-sync handoff and two-account group context.
  Additional Maestro coverage needs operator approval before a scenario is
  added, with why Jest cannot prove its device claim. Reuse existing lane infra.

## Specs to update

- `docs/specs/ui/screen-map.md`, `navigation-contract.md` and
  `components-catalog.md` — routes, target handling and shared controls.
- `docs/specs/08-ux-delivery-standard.md` — only if a genuinely new pattern is
  needed; otherwise compose existing patterns.
- `docs/specs/03-technical-architecture.md`, `09-project-structure.md` — native
  adapter and auth lifecycle ownership.
- Owning notification technical contract — permission/token/tap lifecycle and
  local/provider validation; supply a concrete operator rollout procedure.
- `docs/product/notifications.md` — satisfy implemented Pending lines; accepted
  decisions or other open facts change only with product-owner approval.

## Gates and release boundary

Proposed: `fast`, `backend`, and `frontend` after the required native rebuild.
The full frontend gate includes `ios-sync-e2e` and `ios-groups-e2e`; do not
repeat included lanes without a new change/failure. `groups-protocol4` is
additional only if the diff touches its trigger. Agree the actual set from
`./boga test for` before running beyond `fast`; run all three quality targets.
Capture the accepted-target screenshot comparison and signed-device evidence
in the PR. Hosted smoke/release is separate and needs explicit authority;
document required APNs/Expo credentials without exposing their values. Run
the full sweep on the eventual release commit, not on this planning approval.

Review code/security and product facts. Delete this card and the completed M34
milestone in the implementing PR. Follow the task protocol through human review,
merge confirmation and owning-worktree release.
