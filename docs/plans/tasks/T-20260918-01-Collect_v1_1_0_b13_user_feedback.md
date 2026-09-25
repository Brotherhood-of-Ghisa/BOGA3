---
task_id: T-20260918-01-Collect_v1_1_0_b13_user_feedback
milestone_id: "release-v1.1.0-b13"
status: in_progress
ui_impact: "no"
areas: "docs|frontend|cross-stack"
runtimes: "docs"
gates_fast: "docs-check while this card only records and triages feedback"
gates_slow: "N/A while this card only records and triages feedback"
docs_touched: "none until an accepted action changes a durable contract"
---

# Collect user feedback for production iOS v1.1.0 build 13

## Task metadata

- Task ID: `T-20260918-01-Collect_v1_1_0_b13_user_feedback`
- Status: `in_progress`
- Release tag: `prod-ios-v1.1.0-b13`
- Release commit: `cd65dfd6e9f8f5b7bb744e90a0c8227341fdf644`
- iOS identity: `com.phano.boga3`, version `1.1.0`, build `13`
- Release artifact at tagging time: `artifacts/builds/boga3-prod.ipa`
- Opened: `2026-09-18`
- Last reviewed: `2026-09-25`
- Reviewed main: `e5e3736e9b49b5b81f79344dac6b44074e13ff95`

## Objective

Collect feedback from people using production iOS version `1.1.0` build `13`,
turn each report into a reproducible and prioritised finding, and propose a
specific fix, improvement, investigation, or no-action decision.

This card is an intake and triage record. Accepted implementation work should
be scoped in a dedicated follow-up task or PR when it is more than a trivial
fix.

## Release baseline and versioning rule

- `prod-ios-v1.1.0-b13` is immutable and always identifies the commit and
  binary above. Do not move or replace the tag.
- A changed production binary must use a build number greater than `13`, even
  when the marketing version remains `1.1.0`.
- Tag a later production build separately, for example
  `prod-ios-v1.1.0-b14`.
- The older `v1.1.0` tag is not the baseline for this feedback round; it points
  to an earlier commit.

## Scope

### In scope

- Bugs, crashes, confusing behaviour, usability friction, accessibility gaps,
  performance problems, and improvement requests observed on build `13`.
- Reproduction and comparison against the tagged build and current `main`.
- Severity, frequency, affected flow, workaround, and user impact.
- Proposed actions with rationale, priority, verification expectations, and
  release target.
- Duplicate reports and evidence that strengthens or changes an existing
  finding.

### Out of scope

- Treating an unverified report as an implementation requirement.
- Moving or rewriting the build `13` tag.
- Implementing unrelated roadmap work in this card.
- Storing names, email addresses, authentication details, health information,
  or other unnecessary personal data. Redact identifying material from notes,
  screenshots, and logs.

## Feedback summary

Use one stable ID per distinct finding. Merge duplicates into the original ID
and increase its report count.

| ID | Area / flow | Summary | Severity | Reports | Original reproduction | Decision | Implementation at review | Follow-up / evidence |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- |
| `FB-001` | Session History | Open the read-oriented summary before details/edit | S3 | 1 | Source-confirmed | accept | Outstanding on main; PR open | `ACT-001`, [#336][pr-336] |
| `FB-002` | Session insights | Align live and completed summaries; toggle exercise/muscle percentile load | S3 | 1 | Source-confirmed | accept | Outstanding on main; PR open | `ACT-002`, [#336][pr-336] |
| `FB-003` | Train → new empty workout | Restore GPS gym preselection on the canonical session-entry path | S2 | 1 | Source-confirmed | no_action | Original proposal superseded by suggestion-only contract | `ACT-003`, [#329][pr-329] |
| `FB-004` | Group exercise links | Make unlinking a personal exercise discoverable from the linked group exercise | S2 | 1 | Source-confirmed | accept | Group-row fix merged; catalogue wording outstanding | `ACT-004`, [#332][pr-332], [evidence][unlink-evidence] |

### Implementation and release checkpoint — 2026-09-25

- This is a source/PR review at the main commit above, not a new device test.
  Original reports remain below; current behavior is identified separately.
- [PR #336][pr-336] implements `ACT-001` and `ACT-002` on its branch, but is
  still open at `76ed66d4d2eae78a29a0d6596adb9853b4dd2578` with merge conflicts.
  Reconcile it with the completion redesign in `components/session-complete/`.
  The [failing CI run][summary-ci] stopped at PR-body validation because the
  required `## Tests` section was missing; this is not an application-test
  failure. Full local `fast` (including backend-fast) and `frontend` evidence,
  plus the requested visual/flow evidence, remain outstanding before merge.
  The PR reports passing typecheck, focused Jest and docs checks on its branch;
  retain and revalidate that coverage when reconciling the implementation.
- [PR #332][pr-332] merged the group-row unlink flow and records local gates,
  two-user e2e, offline/reconnect checks, and small/large-phone screenshots in
  the [accepted target and evidence][unlink-evidence]. The catalogue label
  change in `ACT-004` remains unimplemented.
- Remote production tags still contain only `prod-ios-v1.1.0-b13`. No
  replacement build/tag or replacement-build verification was established by
  this review. A merged fix is not yet `shipped` or `verified` for this card.

Severity definitions:

- `S0 — release blocker`: data loss, security/privacy exposure, or the primary
  product flow is unusable with no reasonable workaround.
- `S1 — high`: a major flow fails or produces materially wrong results; a
  workaround may exist.
- `S2 — medium`: meaningful friction or incorrect behaviour with limited
  impact and a usable workaround.
- `S3 — low`: polish, clarity, or an enhancement request.

Decision values: `investigate`, `accept`, `defer`, `duplicate`, `cannot_reproduce`,
or `no_action`.

## Detailed feedback items

### FB-001 — Make completed-session History summary-first

- Status: `decided`
- First reported: `2026-09-18`
- Source/context: build 13 feedback relayed by the product owner
- Report count: `1`
- Area / screen / flow: Progress → Sessions → completed-session History
- User impact: reviewing a completed workout opens the mutable editor before
  showing the more useful read-only summary, adding navigation friction and
  making review and modification feel like the same action.
- Frequency: `every time`
- Severity: `S3`
- Device and iOS version: not provided
- Confirmed app version/build: `1.1.0 (13)` feedback round
- Network/account/data preconditions: at least one completed local session
- User wording, paraphrased: show Summary first from History; make details and
  editing explicit follow-up actions or place them after the summary.
- Evidence links or local artifact paths:
  - `apps/mobile/app/sessions.tsx` currently routes both a completed-row tap
    and the explicit Edit action directly to the completed session view's edit
    mode.
  - `apps/mobile/app/completed-session/[sessionId].tsx` still owns the
    read-only set-detail and completion-summary presentations. The historical
    `presentation=summary` entry was removed during the session-view redesign,
    so it must be restored deliberately rather than relying on old stack
    behavior.
- Implementation at review: outstanding on main; [PR #336][pr-336] is open.
  Merge/verification blockers are recorded in the implementation checkpoint.

#### Reproduction

1. Open Progress, then the Sessions History list.
2. Tap a completed-session row.
3. Observe that completed-edit opens first. On reviewed main, the former
   editor → Summary action is also retired.

- Expected: the row opens a read-oriented summary first, with unambiguous
  `View details` and `Edit session` actions available from that summary.
- Actual: the row opens completed-edit mode first.
- Reproduced on tagged build?: `not_yet` on device; confirmed in the exact
  tagged source.
- Reproduced on current `main`?: `not_yet` on device; confirmed in source.
- Existing workaround: none for Summary-first review on current main; do not
  use the retired editor → Summary action as a current workaround.
- Suspected component or path: `apps/mobile/app/sessions.tsx`,
  `apps/mobile/components/session-list/history-list.tsx`,
  `apps/mobile/app/completed-session/[sessionId].tsx`
- Related feedback IDs, issues, tasks, or PRs: `ACT-001`

#### Proposed action

- Decision: `accept`
- Proposal:
  1. Route a completed History row to
     `/completed-session/<sessionId>?presentation=summary`.
  2. Keep Edit in the row's overflow menu for direct expert access.
  3. Make historical Summary the same read-only summary surface used after
     completion, including the exercise/muscle insight toggle defined by
     `ACT-002`.
  4. Add explicit actions to historical Summary: `View individual sets` opens
     the existing read-only set-detail presentation, and `Edit session` opens
     the session view's completed-edit mode by session ID. Do not rely on
     stack history for either action.
  5. Keep back/History deterministic: it returns to `/sessions` without
     creating an editor copy.
- Why this action: it follows progressive disclosure, makes the common review
  path one tap, and separates reading from mutation while retaining fast access
  to both details and editing.
- Accepted design target for the implementation follow-up: a repo-native brief
  using the existing completion Summary as the visual target, plus before/after
  screenshots of the History → Summary → Details/Edit states.
- Smallest safe scope: change the History row destination and historical
  Summary actions; reuse the existing summary, detail, and completed-edit
  routes rather than introducing a new screen.
- Risks and edge cases: deleted sessions, load/not-found exits, Android back,
  iOS swipe-back suppression, duplicate Edit affordances, and losing valid
  pending edits in the existing editor → Summary flow.
- Verification needed: navigation assertions for row tap and both Summary
  actions, loading/error/deleted-target exits, one History-to-Summary Maestro
  flow, and screenshots on the supported small/large phone targets.
- Required gates: `./boga test fast` and `./boga test frontend` because this
  changes mobile UI and navigation; confirm with `./boga test for` once the
  exact changed paths are known.
- Docs/spec updates needed: `docs/specs/ui/navigation-contract.md`,
  `docs/specs/ui/screen-map.md`, and `docs/specs/ui/ux-rules.md`.
- Target: later `1.1.0` build (`14+`)
- Follow-up owner/task/PR:
  `docs/plans/tasks/T-20260924-01-Implement_session_summary_feedback.md`
  (shared with `ACT-002`); implementation [PR #336][pr-336], open at review.

### FB-002 — Align live and completed session insights

- Status: `decided`
- First reported: `2026-09-18`
- Source/context: build 13 feedback relayed by the product owner
- Report count: `1`
- Area / screen / flow: active session view → in-line session summary; session
  completion and historical Summary
- User impact: users value the per-exercise P5–P95 comparison but cannot use
  the same model to understand muscle load. The live and completed views also
  diverge, forcing users to learn different presentations for the same session.
- Frequency: `every time` an active session has mapped performed sets
- Severity: `S3`
- Device and iOS version: not provided
- Confirmed app version/build: `1.1.0 (13)` feedback round
- Network/account/data preconditions: an active session with at least one valid
  confirmed set and available exercise/muscle mappings
- User wording, paraphrased: bring the live and completed session summaries in
  line; retain the useful exercise percentile bar; offer the same kind of load
  view by muscle behind a toggle; when sharing, always share the exercise view.
- Evidence links or local artifact paths:
  - `apps/mobile/components/session-complete/session-completion-screen.tsx`
    presents muscle working-set chips and per-exercise historical volume
    comparisons, including descriptive P5–P95 bars.
  - `apps/mobile/components/session-complete/exercise-volume-card.tsx`
    owns the useful exercise distribution/baseline/no-history states that the
    aligned presentation should preserve.
  - `CurrentSessionMuscleSummary.muscles` already calculates mapped weighted
    muscle volume, but no current calculation derives a muscle's historical
    P5/median/P95 distribution.
  - The old recorder muscle-load sheet was removed during the session-view
    redesign; the implementation must attach the live summary affordance to
    the current `/session/<sessionId>` surface, not restore the retired route.
- Implementation at review: outstanding on main; [PR #336][pr-336] contains
  the shared presentation and muscle comparisons, but has not merged. Its
  older recorder-component integration must be reconciled with the current
  completion components.

#### Reproduction

1. Start a session and confirm valid sets for mapped exercises.
2. Inspect the current session view: it has no aligned live insight summary
   or exercise/muscle comparison toggle.
3. Complete the session and compare the completion summary.
4. Observe that the views do not offer one consistent, toggleable exercise and
   muscle load model.

- Expected: live, completion, and historical summaries share the same load
  presentation; `By exercise` and `By muscle` switch the grouping while
  retaining descriptive history comparisons.
- Actual: completion has the useful per-exercise percentile comparison while
  the live flow does not expose an aligned summary or equivalent muscle
  comparison.
- Reproduced on tagged build?: `not_yet` on device; confirmed in the exact
  tagged source.
- Reproduced on current `main`?: `not_yet` on device; confirmed in source.
- Existing workaround: finish the session and review the completion summary.
- Suspected component or path:
  `apps/mobile/components/session-complete/session-completion-screen.tsx`,
  `apps/mobile/components/session-complete/exercise-volume-card.tsx`,
  `apps/mobile/components/session-view/`,
  `apps/mobile/app/session/[sessionId]/index.tsx`,
  `apps/mobile/src/session-insights/`
- Related feedback IDs, issues, tasks, or PRs: `ACT-002`

#### Proposed action

- Decision: `accept`
- Proposal:
  1. Create one shared session-insight presentation used by live `Session so
     far`, post-completion Summary, and historical Summary. Keep context-specific
     actions outside it: live has no Share/Done, completion has Share/Done, and
     history has Share plus `View individual sets` / `Edit session`.
  2. Default the presentation to `By exercise`. Preserve each exercise's raw
     session volume, median comparison, and P5–P95 percentile bar (with the
     existing baseline and no-history states).
  3. Add a two-option `By exercise` / `By muscle` toggle. `By muscle` groups
     mapped weighted session volume by muscle and compares each muscle against
     that same muscle's weighted volume in prior eligible completed sessions,
     using equivalent P5/median/P95, single/equal-baseline, and no-history
     states. It is not a bar normalised to the largest muscle in this session.
  4. Define historical eligibility identically for both groupings: earlier,
     non-deleted completed sessions and confirmed performed sets only. Preserve
     the canonical exercise-to-muscle contribution weights and load-input-mode
     handling; do not reinterpret a compound exercise as one full set for every
     mapped muscle.
  5. Treat the toggle as local presentation state, defaulting to `By exercise`
     whenever a summary opens. Live results update from confirmed sets without
     blocking logging; stale async reads cannot overwrite a newer set state.
  6. Sharing is intentionally invariant: `Share session` always previews and
     exports the `By exercise` summary, regardless of the visible toggle. The
     share image never includes the muscle view or stores the toggle choice.
- Why this action: one component and one comparison vocabulary before and after
  submission prevent drift; the toggle adds the requested muscle perspective
  without sacrificing the exercise percentile view users already understand.
- Accepted design target for the implementation follow-up: a repo-native brief
  using the build 13 completion Summary as the internal visual reference, with
  explicit live loading, partial-mapping, empty, and error states.
- Smallest safe scope: extract the existing exercise comparison UI, add the
  analogous pure muscle-history calculation and grouped rows, and host that
  shared view in the current session view plus both completed-summary modes.
  Do not change persistence, sync, or confirmed-set semantics.
- Risks and edge cases: repeated history reads while sets change, stale async
  comparisons, unconfirmed/planned sets leaking into metrics, exercises without
  history or mappings, partial catalog failure, vertical density, and regressions
  in completion/share rendering.
- Verification needed: pure calculation coverage for mapped/unmapped,
  contribution weights, distributions, equal/single baselines and no history;
  toggle/default/live-update and reversal component tests; loading/error states;
  an assertion that Share stays exercise-only after selecting `By muscle`;
  History → Summary → individual sets/Edit navigation tests; a Maestro live and
  historical interaction; and screenshots on supported small/large phones.
- Required gates: `./boga test fast` and `./boga test frontend` because this
  changes session UI/components; derive any additional lane from
  `./boga test for` if implementation touches data, sync, or backend paths.
- Docs/spec updates needed: `docs/specs/ui/screen-map.md`,
  `docs/specs/ui/ux-rules.md`, and `docs/specs/ui/components-catalog.md` if a
  reusable insight-summary component is introduced.
- Target: later `1.1.0` build (`14+`)
- Follow-up owner/task/PR:
  `docs/plans/tasks/T-20260924-01-Implement_session_summary_feedback.md`
  (shared with `ACT-001`); implementation [PR #336][pr-336], open at review.

### FB-003 — Restore GPS gym preselection through Train

- Status: `decided`
- Implementation at review: the original automatic-selection proposal is
  superseded, not implemented as requested. [PR #329][pr-329] deliberately
  introduced suggestion-only GPS assistance on `2026-09-23`.
- First reported: `2026-09-19`
- Source/context: post-merge review of the build 13 navigation changes
- Report count: `1`
- Area / screen / flow: Today → Train → Start empty workout → recorder
- Original user impact: a new workout opens with no gym even when foreground
  location permission, a confident saved-gym coordinate match, and the existing automatic
  detector are all available. The workout remains usable, but the user must
  retry detection or select the gym manually.
- Frequency: `every time` a brand-new empty workout starts through Train
- Severity: `S2`
- Device and iOS version: not applicable to the source review; device
  verification is pending
- Confirmed app version/build: `1.1.0 (13)` source at
  `prod-ios-v1.1.0-b13`
- Network/account/data preconditions: no active draft; at least one saved gym
  with coordinates; foreground location permission and an accurate current
  position
- User wording, paraphrased: post-merge review requested a check that recent
  merges had not broken the GPS gym detector.
- Original evidence (`2026-09-19`, before the recorder was retired):
  - PR `#295` made Train the canonical new-session entry and its coordinator
    persists an empty draft with `gymId: null` before opening the recorder.
  - `apps/mobile/app/(tabs)/session-recorder.tsx` performed the bounded GPS
    match only in its legacy empty-state `Start Session` handler. Hydrating the
    draft created by Train intentionally skips that startup detector.
  - The matcher, foreground-location service, permission configuration, and
    manual long-press retry were present. The original review recorded five
    focused suites passing (56 tests) at `b1a175e7`; these are historical
    results, not verification of reviewed main.

#### Original build-13 reproduction

1. Save coordinates for a gym and use a matching device or simulator location.
2. Ensure no active workout draft exists, then open Today → Train.
3. Choose `Start empty workout` and observe the gym field in the recorder.

- Expected: creation of the brand-new active session performs one bounded
  foreground-location read and preselects the single confident saved-gym match.
- Actual: the entry coordinator persists the draft with `gymId: null`; the
  recorder restores that draft and therefore never runs startup detection.
- Reproduced on tagged build?: `not_yet` on device; confirmed in the exact
  tagged source because PR `#295` is an ancestor of `prod-ios-v1.1.0-b13`.
- Source reproduction at intake: confirmed at `b1a175e7`; not device-tested.
- Original workaround: long-press the recorder gym field to retry detection,
  or select manually. The recorder and long-press retry are now retired.
- Original suspected component or path:
  `apps/mobile/src/session-entry/coordinator.ts`,
  `apps/mobile/app/(tabs)/train.tsx`,
  `apps/mobile/app/(tabs)/session-recorder.tsx`
- Related feedback IDs, issues, tasks, or PRs: PR `#295`, PR `#303`,
  [PR #329][pr-329], `ACT-003`

#### Current behavior and disposition

- Decision: `no_action`; `ACT-003` is `rejected` because the original proposal
  was superseded by the explicit `2026-09-23` product decision, not because
  automatic preselection was restored.
- Original accepted proposal: centralise bounded GPS-aware blank-draft
  creation behind the session-entry coordinator, preserving the one-active-draft
  lock and null-gym fallbacks. Do not implement that proposal under this card:
  it now conflicts with the [authoritative suggestion-only contract][gps-contract].
- Current main: `src/session-entry/coordinator.ts` still starts with
  `gymId: null`. Opening the session view's `Gym` sheet performs one bounded
  foreground read and offers `Nearby · <gym>` for a single confident match.
  Only a user tap selects it; no startup selection or long-press retry exists.
- Current path: Today → Train → Start empty workout → session view → Gym →
  tap the nearby suggestion or select a gym manually.
- Current evidence: [PR #329][pr-329], `apps/mobile/app/session/[sessionId]/index.tsx`,
  `apps/mobile/components/session-view/session-gym-sheet.tsx`, and
  `apps/mobile/src/session-entry/coordinator.ts`. Source-reviewed only in this
  checkpoint; no replacement-build device verification is claimed.
- Follow-up: none for the superseded proposal. Restoring automatic selection
  would require a new product decision and a corresponding contract update.
- Target: `none` for `ACT-003`.

### FB-004 — Make personal-to-group exercise links removable where they are shown

- Status: `decided`
- Implementation at review: partially implemented. [PR #332][pr-332] merged
  group-row unlinking on `2026-09-24`; the catalogue wording in proposal item 4
  remains outstanding. Keep `ACT-004` in progress until that remainder is
  completed or explicitly deferred.
- First reported: `2026-09-22`
- Source/context: product-owner observation during the build 13 feedback round
- Report count: `1`
- Area / screen / flow: Groups → group → Exercises → linked exercise
- Original user impact: a member can see that a personal exercise is linked to
  a group exercise, but that group-facing row offers no way to remove the link.
  The existing unlink control is reached through `Link to group exercise…` in
  either the personal Exercise Catalog's overflow menu or the recorder's
  exercise `•••` menu, so a member may reasonably conclude that links cannot
  be removed.
- Frequency: `every time` a member tries to manage an existing link from the
  group exercise that displays it
- Severity: `S2`
- Device and iOS version: not provided
- Confirmed app version/build: reported during the `1.1.0 (13)` feedback round;
  current-source comparison completed
- Network/account/data preconditions: signed-in group member with at least one
  live personal-exercise link to a group exercise
- User wording, paraphrased: allow personal exercises to be de-linked from group
  exercises.
- Original evidence at intake:
  - `apps/mobile/components/groups/group-exercises-page.tsx` showed `Linked: …`
    on the group exercise row, but only passed an action when the row was
    unlinked (`Link your exercise`); a linked member row had no link-management
    action.
  - `apps/mobile/app/exercise-link.tsx` already supported confirmed, offline
    unlinking of an individual personal exercise.
  - `apps/mobile/app/(tabs)/exercise-catalog.tsx` and
    `apps/mobile/app/(tabs)/session-recorder.tsx` both opened that screen from
    their exercise menus. Both actions were labelled
    `Link to group exercise…` even when the exercise has existing links.
- Current evidence:
  - [PR #332][pr-332] added a separate `Unlink…` control to linked group rows.
    One link opens confirmation directly; several links open a chooser for
    one personal exercise, then confirmation. Local writes and status reload
    use the shared unlink hook, including offline and failure handling.
  - The [accepted target and evidence][unlink-evidence] records local fast,
    backend, frontend and groups-e2e gates, offline/reconnect checks and
    small/large-phone screenshots. These are implementation evidence, not
    replacement-production-build verification.
  - The catalogue menu still says `Link to group exercise…` on reviewed main.
    The replacement exercise-page menu uses the same wording; the recorder
    menu no longer exists.

#### Original reproduction and current result

1. Link one of your personal exercises to a group exercise.
2. Open that group's Exercises segment and find the row showing
   `Linked: <personal exercise>`.
3. Try to remove the displayed link from that row.

- Expected: the linked group-exercise row exposes a clear way to manage its
  personal links and unlink one after confirmation.
- Actual at intake: the row exposed neither an unlink nor a manage-links
  action; unlink was available through the personal catalogue or the recorder's
  exercise menu, but both entry points were labelled for linking rather than
  managing or unlinking.
- Reproduced on tagged build?: `not_yet` on device; reported against the build
  13 feedback round
- Current main: the missing group-row action is fixed in source and covered
  by #332's device evidence; catalogue wording is still source-confirmed.
  Current Exercises lives on the group management page, not an Exercises
  segment. This review did not rerun device tests.
- Current alternate entry: the personal Exercise Catalog or exercise-page
  overflow → `Link to group exercise…` → `Unlink` in the Linked section.
  Group-row unlinking no longer requires this detour.
- Suspected component or path:
  `apps/mobile/components/groups/group-exercises-page.tsx`,
  `apps/mobile/components/groups/group-exercise-row.tsx`,
  `apps/mobile/app/exercise-link.tsx`,
  `apps/mobile/app/(tabs)/exercise-catalog.tsx`
- Related feedback IDs, issues, tasks, or PRs: `ACT-004`, [PR #332][pr-332]

#### Delivered scope and remaining action

- Decision: `accept`
- Proposal:
  1. Delivered: linked group-exercise rows expose `Unlink…`, the accepted
     implementation of the originally proposed `Manage links` affordance.
  2. Delivered: remove one personal link after confirmation, with an individual
     chooser when several personal exercises link to the same group exercise.
  3. Delivered: reuse the local tombstone write and shared link reload/error
     handling; unlink remains offline-capable, retroactive, and sync-backed.
  4. Outstanding: rename the personal catalogue action to `Manage group links…`
     when links exist (or use wording that covers both link and unlink) so the
     existing route remains discoverable from the personal side.
- Why this action: management should be available where link status is visible,
  while retaining the existing personal-exercise route. Reusing the proven
  tombstone write avoids creating a second unlink contract.
- Remaining scope: clarify the catalogue action label and its accessible name;
  retain the merged group-row interaction and existing persistence semantics.
- Risks and edge cases: several personal exercises linked to one target,
  archived group exercises, soft-deleted or locally missing personal exercises,
  an inactive link after leaving a group, offline operation, rapid repeated
  taps, unlink failure, and status refresh after the tombstone write.
- Verification completed for the merged scope: see the [flow-to-test mapping
  and local gate evidence][unlink-evidence].
- Verification remaining: catalogue wording and navigation assertions after
  the label change; verify the reported flow on the replacement production
  build before marking the finding `verified`.
- Required gates for remaining catalogue UI work: `./boga test fast` and
  `./boga test frontend`; derive any additional requirements with
  `./boga test for` once its implementation paths are final.
- Docs/spec updates: #332 updated the groups contract and UI docs; update
  documented catalogue wording with the remaining label change.
- Target: later `1.1.0` build (`14+`)
- Follow-up owner/task/PR: [PR #332][pr-332] for the merged group-row fix;
  catalogue wording follow-up remains unassigned.

## UI impact checkpoint

- This feedback card changes documentation only, so its own `ui_impact` remains
  `no`.
- `ACT-001` and `ACT-002` are significant UI follow-ups. Their open PR still
  needs to satisfy the UX Contract, accepted-target, and visual-evidence rules
  required by `docs/specs/08-ux-delivery-standard.md` and
  `docs/specs/ui/ai-design-policy.md`.
- `ACT-003` is superseded by the suggestion-only contract; it is not an
  outstanding automatic-selection UI fix.
- `ACT-004`'s merged group-row scope has an [accepted brief and visual
  evidence][unlink-evidence]. Only its catalogue wording follow-up remains;
  retain the existing unlink interaction and verify the revised label.
- The proposals above reuse current repository screens as internal design
  references; they do not make those proposals authoritative product behaviour
  until the follow-up is approved and implemented.

## Template for the next feedback item

Copy this section for each new finding.

### FB-___ — Short finding title

- Status: `new | investigating | reproduced | decided | fixed | verified`
- First reported:
- Source/context: use a non-identifying label such as `TestFlight tester 2`
- Report count: `1`
- Area / screen / flow:
- User impact:
- Frequency: `once | intermittent | every time | unknown`
- Severity: `S0 | S1 | S2 | S3`
- Device and iOS version:
- Confirmed app version/build: `1.1.0 (13) | unknown`
- Network/account/data preconditions:
- User wording, paraphrased:
- Evidence links or local artifact paths:

#### Reproduction

1. _Step_
2. _Step_
3. _Step_

- Expected:
- Actual:
- Reproduced on tagged build?: `yes | no | not_yet`
- Reproduced on current `main`?: `yes | no | not_yet`
- Existing workaround:
- Suspected component or path:
- Related feedback IDs, issues, tasks, or PRs:

#### Proposed action

- Decision: `investigate | accept | defer | duplicate | cannot_reproduce | no_action`
- Proposal:
- Why this action:
- Smallest safe scope:
- Risks and edge cases:
- Verification needed:
- Required gates: derive from `./boga test for <changed paths>` when the change
  is scoped.
- Docs/spec updates needed:
- Target: `hotfix build 14+ | later 1.1.0 build | future version | none`
- Follow-up owner/task/PR:

## Proposed actions register

Add an entry only after the corresponding feedback has enough evidence for a
decision.

| Action ID | Feedback IDs | Proposed action | Priority | Target build/version | Owner | Status | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ACT-001` | `FB-001` | Open History on Summary; expose deterministic individual-sets/Edit actions | High | `1.1.0` build `14+` | `T-20260924-01-Implement_session_summary_feedback`; [PR #336][pr-336] | in_progress | Resolve conflicts and PR-body CI failure; full local fast/frontend and History-flow screenshots outstanding |
| `ACT-002` | `FB-002` | Share one live/completed Summary with exercise/muscle percentile toggle; export exercise only | Medium | `1.1.0` build `14+` | Same task; [PR #336][pr-336] | in_progress | Reconcile completion redesign and revalidate calculation/component/share coverage; full local fast/frontend and live/completion/history screenshots outstanding |
| `ACT-003` | `FB-003` | Original automatic GPS preselection proposal, superseded by suggestion-only behavior | — | none | [PR #329][pr-329]; [current contract][gps-contract] | rejected | No restoration claimed; startup remains null-gym by design; no implementation follow-up |
| `ACT-004` | `FB-004` | Group-row `Unlink…` delivered; clarify catalogue action wording | High | `1.1.0` build `14+` | [PR #332][pr-332] merged; label follow-up unassigned | in_progress | [Merged-scope gate and visual evidence][unlink-evidence]; catalogue wording and replacement-build verification outstanding |

Action status values: `proposed`, `approved`, `in_progress`, `shipped`,
`verified`, `deferred`, or `rejected`.

`in_progress` includes an open implementation PR or a partly merged action.
Record merged scope separately from `shipped` (replacement build/tag recorded)
and `verified` (reported flow checked on that replacement build).

## Triage rules

1. Confirm that the report concerns `1.1.0 (13)` where possible. Record
   `unknown` instead of assuming.
2. Preserve the user's meaning, but redact personal or secret information.
3. Search this card for duplicates before assigning a new feedback ID.
4. Separate observed behaviour from diagnosis and proposed action.
5. Reproduce on the tagged build first when practical, then check current
   `main` so already-fixed behaviour is not scheduled twice.
6. Prioritise user harm and frequency over implementation convenience.
7. Give every decided item a rationale, including deferred and no-action items.
8. Scope accepted work against the repository's source-of-truth specs and gate
   rules; do not let this working note override them.
9. For a shipped fix, record the PR, the verifying evidence, and the new build
   tag. Never mark an item verified from code review alone.

## Acceptance criteria

1. Every received report is represented by a feedback ID or linked as a
   duplicate.
2. Each report records build confidence, user impact, severity, reproduction
   state, and evidence where available.
3. Each triaged report has an explicit decision and rationale.
4. Every accepted action has a bounded scope, verification expectation, target
   build/version, and follow-up owner or task.
5. Any replacement binary increments the iOS build number and receives a new
   immutable production tag.
6. No unnecessary personal information or credentials are retained.

## Testing and verification approach

- Feedback-only edits to this task card require `./boga test docs-check`. In the
  PR gate table, mark the `fast` row ✅ with the required `docs-check` lane
  evidence because that lane belongs to the fast gate; do not mark the row N/A
  for a Markdown change.
- Once an action changes product code, use `./boga test for <changed paths>` to
  determine the required gates and record measured results in the implementing
  PR, not here.
- User-facing fixes must be verified against the reported flow on the actual
  replacement build before the related finding becomes `verified`.

## Completion note

- What feedback was collected: four distinct reports, `FB-001` through `FB-004`.
- Decisions made: retain the summary improvements and catalogue wording;
  record the delivered group-row unlink fix; reject automatic gym preselection
  as superseded by the documented suggestion-only decision.
- Follow-up tasks/PRs: summary implementation [#336][pr-336] remains open;
  group-row unlink [#332][pr-332] merged; suggestion-only GPS [#329][pr-329]
  merged. Catalogue wording still needs an owner/follow-up.
- Replacement build/tag: none established by this review; only build 13 is
  production-tagged. No finding is marked replacement-build verified.
- What remains: resolve and validate #336 against current main, complete or
  explicitly defer catalogue wording, then record the replacement build/tag
  and verify the accepted fixes on that build.

This card remains `in_progress` while build `13` feedback is being collected.
Delete it when the feedback round is closed and all accepted actions have been
handed off or completed; git history retains the record.

[pr-329]: https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/329
[pr-332]: https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/332
[pr-336]: https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/336
[summary-ci]: https://github.com/Brotherhood-of-Ghisa/BOGA3/actions/runs/35990888717/job/107604424807
[gps-contract]: https://github.com/Brotherhood-of-Ghisa/BOGA3/blob/e5e3736e9b49b5b81f79344dac6b44074e13ff95/docs/specs/ui/ux-rules.md#L175-L189
[unlink-evidence]: https://github.com/Brotherhood-of-Ghisa/BOGA3/blob/ca80b99ed5b08002c88ce1c0faae252ad84e533c/docs/specs/ui/design-targets/group-exercise-unlink.md
