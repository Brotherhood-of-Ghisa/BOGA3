# M34-T03-iOS_notification_controls — iOS opt-in, controls and tap navigation

- Status: `in-progress`
- Depends on: M34-T01-Backend_push_delivery (completed; backend delivery contract), [M34-T02-Workout_notification_events](M34-T02-Workout_notification_events.md)
- Milestone: [M34](../milestones/M34-group-workout-notifications.md)
- Areas: frontend, auth lifecycle, cross-stack; UI impact: yes

## Objective

Let an authenticated iOS user enable group notifications, control categories
and mute groups, and open the authorized workout/group from an alert. Verify
the complete start/completion experience on a signed device and preserve the
root authentication/first-sync gates.

## Scope

- In: `expo-notifications` native configuration, themed native notification
  content extension, installation registration, account/permission lifecycle,
  preferences UI, group muting, validated tap intents, error/offline states,
  screenshots and device delivery acceptance.
- Out: Android integration, a notification inbox, live activities, followers,
  digests, a new workout Achievements section, new scoring, hosted deployment
  and an automatic release.

## Decided

M34 D1–D6 and all accepted notification facts apply. Permission is requested
after a user action, not merely because the app cold-launches. An OS refusal
does not block the app, logging or sync. Reuse existing server preferences and
the failure-isolated sender; do not create a mobile group-push path.

## Accepted task target and checks

The owner selected controls option 2 on 2026-10-16: a Notifications section on
Settings opens a scrollable in-route `Sheet`, like Appearance. The fixed handle
and title sit above a scrolling status/action and category body. Group details
reuse a mute switch below Members. The selected mock and its refinement are
preserved in the task conversation; local comparison inputs are under the
gitignored `apps/mobile/artifacts/design/m34-notifications/` directory. The
refined `controls-reference.png` governs controls; D6's completion and family
references govern expanded notifications. Existing tokens and primitives govern
production integration; mock spacing or icons do not replace them.

The owner subsequently approved both displayed mockups: `controls-reference.png`
and `family-reference.png`. Actual small/large controls comparisons are now
recorded below; signed-device notification acceptance remains pending.

The owner approved the normal iOS banner without sound while the app is open.
Notification taps use the existing shared-session page; the Achievements section
remains deferred to [issue #733](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/733).

Agreed checks: `fast`, `backend`, `frontend`, `jest-coverage`, `complexity` and
`dependencies`, with the native dev-client force rebuild before iOS checks.
The owner declined new Maestro scenarios: use existing flows and manual device
evidence. Signed-device delivery remains separate from simulator and local-sink
proof; hosted sending and a release are not authorized.

## Deliverables and acceptance

1. Add SDK-compatible native notification dependencies/plugin and iOS signing
   configuration. Obtain per-installation Expo tokens from the current EAS
   project, preserve development/production environment separation, and rebuild
   the dev client with `./boga ios build-client --force` before device lanes.
   Push credentials stay server/build-side. Android and unsupported/local-only
   builds stay usable without attempting iOS registration.
   Integrate the native content extension for [[notifications.theme]], using
   locally available applied-theme data and the existing font assets. Preserve
   readable system-banner fallback content. Rendering must need no network
   request or private workout data beyond the authorized public projection.
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
   and navigating to the existing shared-session page. No new Achievements
   section or section-specific route target is part of this task. Repeated
   delivery/taps do not stack duplicate routes.
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
| Tap a start/summary alert | iOS opens app; validate intent; restore/sign in; complete bootstrap; check target access; open the existing shared-session page in an authorized group context | Correct member/workout overview and native Back navigation; no new Achievements section | Wrong account, deleted target or lost access opens safe unavailable state; offline cannot imply fresh authorization |
| Revoke or switch account | Revoke OS permission or sign out/switch; apply installation lifecycle; refresh status on return | No new registration/send eligibility for the revoked/previous binding; permitted account can register | Offline cleanup follows T01's documented fail-closed design; no claim that a failed unregister succeeded |

Appearance proposal: use existing Settings/group rows and shared toggles; no
explanatory subtitles, debug queue details or delivery-provider terminology.
Permission/consent copy follows [[copy.no-inline-explanation]]'s exception.
Follow [[copy.no-subtitles]]. The notification visual target is M34 D6; render
its full family, singular/plural counts and long identities using the applied
theme, and compare screenshots with the approved references. Compare enabled,
denied, failed-write and muted control states with their separate target.

## Canonical proof allocation

- Jest: adapter branches, token/account ownership, preferences and real-data
  screen states, validated pending intents and route-gating decisions. Load
  the test-directory README and writing-tests spec before editing suites.
- Local contracts/live client: actual registration/preferences RPC wire and
  unauthorized/cross-account denial through the app adapter.
- Device evidence: OS permission, actual push delivery, themed expanded
  content and system-banner fallback, cold-launch handling, native Back,
  sign-in/first-sync handoff and two-account group context.
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

### Implementation checkpoint — 2026-10-16

Branch: `codex/m34-t03-ios-notifications`. The implementation and runtime
corrections passed Ponytail and independent native Codex source review; product
review is clean. The agreed backend set passed across initial/resumed runs.
Both forced simulator builds passed with SDK module registrations, app/extension
ad-hoc entitlements and embedded fonts verified. Xcode setup and doctor are green.

Final code checks passed: lint/typecheck, 302 Jest suites / 4,134 tests,
UI guardrails and all three quality targets. Coverage is 87.10% branches and
94.62% lines; limits and dependency baselines are unchanged. Backend smoke
passed after manual capture. Repository/docs evidence accompanies the gate logs.
Evidence is under gitignored `apps/mobile/artifacts/notification-original-final-*.log`.

All eight frontend lane bodies passed across canonical runs. The original
single-process sync scenario proved upload-zero, full wipe, fresh sign-in and
the server-restored 80 kg reading; auth/profile and two-user groups passed again.
SafariViewService's password-save dialog was absent from Maestro's hierarchy.
Normal simulator AutoFill setup resolved it; the unsuccessful driver-splitting
workaround was removed. Per-new-simulator setup belongs to
`docs/specs/11-maestro-runtime-and-testing-conventions.md`. No scenario was added.

Actual preview captures at 375×667 pt and 440×956 pt prove the Settings section,
sheet, user-triggered permission prompt, denial/Allow, normal iOS Settings
permission change, category writes and group mute/restoration. Current-source
recaptures confirm fixes for a clipped switch, disappearing Retry and unbounded
token acquisition. Registration stayed truthfully unsuccessful. Content fitted
both viewports, including the native maximum-text attempt, so displacement from
overflow was not demonstrated. Combined comparisons and deviations are recorded
in gitignored `apps/mobile/artifacts/design/m34-notifications/design-qa.md`.

Prepare a draft PR with the sanitized evidence. Signed-iPhone delivery,
expanded-content comparison and cold-tap/Back acceptance remain outstanding.
Keep this card and milestone in progress until acceptance is complete. Hosted
deployment, sending enablement and release require separate authority.

Proposed: `fast`, `backend`, and `frontend` after the required native rebuild.
The full frontend gate includes `ios-sync-e2e` and `ios-groups-e2e`; do not
repeat included lanes without a new change/failure. `groups-protocol4` is
additional only if the diff touches its trigger. Agree the actual set from
`./boga test for` before running beyond `fast`; run all three quality targets.
Capture the accepted-target screenshot comparison and signed-device evidence
in the PR. Hosted smoke/release is separate and needs explicit authority;
document required APNs/Expo credentials without exposing their values. Run
the full sweep on the eventual release commit, not on this planning approval.

Review code/security and product facts. Delete this card and the M34 milestone
once their remaining acceptance is complete. Follow the task protocol through
human review, merge confirmation and owning-worktree release.
