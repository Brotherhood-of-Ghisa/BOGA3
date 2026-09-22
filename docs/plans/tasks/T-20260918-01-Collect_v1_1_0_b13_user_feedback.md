---
task_id: T-20260918-01-Collect_v1_1_0_b13_user_feedback
milestone_id: "release-v1.1.0-b13"
status: in_progress
ui_impact: "no"
areas: "docs|frontend|cross-stack"
runtimes: "docs"
gates_fast: "N/A while this card only records and triages feedback"
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

| ID | Area / flow | Summary | Severity | Reports | Reproduced? | Decision | Follow-up |
| --- | --- | --- | --- | ---: | --- | --- | --- |
| `FB-001` | Session History | Open the read-oriented summary before details/edit | S3 | 1 | Source-confirmed | accept | `ACT-001` |
| `FB-002` | Active session insights | Match the useful exercise/muscle completion summary instead of relative muscle-load bars | S3 | 1 | Source-confirmed | accept | `ACT-002` |
| `FB-003` | Train → new empty workout | Restore GPS gym preselection on the canonical session-entry path | S2 | 1 | Source-confirmed | accept | `ACT-003` |
| `FB-004` | Group exercise links | Make unlinking a personal exercise discoverable from the linked group exercise | S2 | 1 | Source-confirmed | accept | `ACT-004` |

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
  - `apps/mobile/app/sessions.tsx` routes both a completed-row tap and the
    explicit Edit action to completed-edit mode.
  - `apps/mobile/app/completed-session/[sessionId].tsx` already supports a
    read-only `presentation=summary`, but its Edit action assumes the summary
    was opened from the editor and calls `router.back()`.

#### Reproduction

1. Open Progress, then the Sessions History list.
2. Tap a completed-session row.
3. Observe that completed-edit opens first; Summary is a secondary action from
   that editor.

- Expected: the row opens a read-oriented summary first, with unambiguous
  `View details` and `Edit session` actions available from that summary.
- Actual: the row opens completed-edit mode first.
- Reproduced on tagged build?: `not_yet` on device; confirmed in the exact
  tagged source.
- Reproduced on current `main`?: `not_yet` on device; confirmed in source.
- Existing workaround: open Summary from the completed-session editor.
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
  3. Add explicit bottom actions to historical Summary: `View details` opens
     the existing read-only detail presentation, and `Edit session` opens
     completed-edit by session ID. Do not rely on stack history for Edit.
  4. Keep back/History deterministic: it returns to `/sessions` without
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
- Follow-up owner/task/PR: not yet assigned; create from `ACT-001` before this
  feedback round closes.

### FB-002 — Align live session insights with the completion summary

- Status: `decided`
- First reported: `2026-09-18`
- Source/context: build 13 feedback relayed by the product owner
- Report count: `1`
- Area / screen / flow: active session recorder → Session muscle load
- User impact: the relative bar chart and `weighted kg·reps` values require
  interpretation but do not clearly answer what has been trained or how the
  current exercises are going; users receive a clearer model only after ending
  the session.
- Frequency: `every time` an active session has mapped performed sets
- Severity: `S3`
- Device and iOS version: not provided
- Confirmed app version/build: `1.1.0 (13)` feedback round
- Network/account/data preconditions: an active session with at least one valid
  confirmed set and available exercise/muscle mappings
- User wording, paraphrased: the in-session muscle graphic and data are not very
  informative; simplify by matching the end-of-session exercise and muscle
  group summary.
- Evidence links or local artifact paths:
  - `apps/mobile/components/session-recorder/session-muscle-load.tsx` presents
    exact weighted volume and bars normalised only against the largest muscle
    value in the current session.
  - `apps/mobile/components/session-recorder/session-completion-presentation.tsx`
    instead presents working sets by muscle and per-exercise volume comparisons.
  - `CurrentSessionMuscleSummary.workingSetsByMuscle` already supplies the same
    muscle-count model used by completion.

#### Reproduction

1. Start a session and confirm valid sets for mapped exercises.
2. Open Session muscle load.
3. Observe session-relative bars and weighted-volume units that do not match
   the end-of-session exercise/muscle summary.

- Expected: a concise `Session so far` view using the same muscle and exercise
  summary language as completion, updated as confirmed sets change.
- Actual: a separate muscle-only sheet uses relative bars and technical
  weighted-volume values.
- Reproduced on tagged build?: `not_yet` on device; confirmed in the exact
  tagged source.
- Reproduced on current `main`?: `not_yet` on device; confirmed in source.
- Existing workaround: finish the session and review the completion summary.
- Suspected component or path:
  `apps/mobile/components/session-recorder/session-muscle-load.tsx`,
  `apps/mobile/components/session-recorder/session-completion-presentation.tsx`,
  `apps/mobile/app/(tabs)/session-recorder.tsx`,
  `apps/mobile/src/session-insights/`
- Related feedback IDs, issues, tasks, or PRs: `ACT-002`

#### Proposed action

- Decision: `accept`
- Proposal:
  1. Replace the live weighted-volume bar presentation with a `Session so far`
     summary that shares the completion presentation's core content and visual
     language.
  2. Show physical performed/working-set totals, `Working sets by muscle`
     chips, and current per-exercise volume rows. Add historical comparison
     markers only when their data is ready; loading or failure must never block
     logging.
  3. Extract shared muscle and exercise summary sections rather than maintaining
     visually similar copies. Live mode updates from confirmed sets and omits
     final-only Share/Done behaviour.
  4. Remove session-relative weighted-volume bars and `weighted kg·reps` from
     the user-facing live view. Keep or remove the pure calculation only after
     checking whether another analytics consumer needs it.
- Why this action: one vocabulary before and after submission reduces cognitive
  load, makes the live view actionable, and prevents two presentations of the
  same session from drifting.
- Accepted design target for the implementation follow-up: a repo-native brief
  using the build 13 completion Summary as the internal visual reference, with
  explicit live loading, partial-mapping, empty, and error states.
- Smallest safe scope: reuse/extract the existing completion muscle chips and
  exercise-volume rows for active-session data; do not change persistence,
  sync, or the underlying confirmed-set semantics.
- Risks and edge cases: repeated history reads while sets change, stale async
  comparisons, unconfirmed/planned sets leaking into metrics, exercises without
  history or mappings, partial catalog failure, vertical density, and regressions
  in completion/share rendering.
- Verification needed: pure calculation coverage, live-update and reversal
  component tests, loading/error/unmapped states, completion regression tests,
  a Maestro active-session interaction, and before/after screenshots on the
  supported small/large phone targets.
- Required gates: `./boga test fast` and `./boga test frontend` because this
  changes recorder UI/components; derive any additional lane from
  `./boga test for` if implementation touches data, sync, or backend paths.
- Docs/spec updates needed: `docs/specs/ui/screen-map.md`,
  `docs/specs/ui/ux-rules.md`, and `docs/specs/ui/components-catalog.md` if a
  reusable insight-summary component is introduced.
- Target: later `1.1.0` build (`14+`)
- Follow-up owner/task/PR: not yet assigned; create from `ACT-002` before this
  feedback round closes.

### FB-003 — Restore GPS gym preselection through Train

- Status: `decided`
- First reported: `2026-09-19`
- Source/context: post-merge review of the build 13 navigation changes
- Report count: `1`
- Area / screen / flow: Today → Train → Start empty workout → recorder
- User impact: a new workout opens with no gym even when foreground location
  permission, a confident saved-gym coordinate match, and the existing automatic
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
- Evidence links or local artifact paths:
  - PR `#295` made Train the canonical new-session entry and its coordinator
    persists an empty draft with `gymId: null` before opening the recorder.
  - `apps/mobile/app/(tabs)/session-recorder.tsx` still performs the bounded GPS
    match only in its legacy empty-state `Start Session` handler. Hydrating the
    draft created by Train intentionally skips that startup detector.
  - The matcher, foreground-location service, permission configuration, and
    manual long-press retry remain present. Five focused suites covering those
    units and both screens passed on current `main` (56 tests); the missing
    coverage is the canonical Train → coordinator → recorder integration.

#### Reproduction

1. Save coordinates for a gym and use a matching device or simulator location.
2. Ensure no active workout draft exists, then open Today → Train.
3. Choose `Start empty workout` and observe the gym field in the recorder.

- Expected: creation of the brand-new active session performs one bounded
  foreground-location read and preselects the single confident saved-gym match.
- Actual: the entry coordinator persists the draft with `gymId: null`; the
  recorder restores that draft and therefore never runs startup detection.
- Reproduced on tagged build?: `not_yet` on device; confirmed in the exact
  tagged source because PR `#295` is an ancestor of `prod-ios-v1.1.0-b13`.
- Reproduced on current `main`?: `not_yet` on device; confirmed in source at
  `b1a175e7`.
- Existing workaround: long-press the gym field to retry GPS detection, or
  select the gym manually.
- Suspected component or path:
  `apps/mobile/src/session-entry/coordinator.ts`,
  `apps/mobile/app/(tabs)/train.tsx`,
  `apps/mobile/app/(tabs)/session-recorder.tsx`
- Related feedback IDs, issues, tasks, or PRs: PR `#295`, PR `#303`, `ACT-003`

#### Proposed action

- Decision: `accept`
- Proposal:
  1. Move GPS-aware blank-draft creation behind one shared session-entry
     operation used by the canonical Train path and any retained legacy start
     affordance.
  2. Preserve the existing contract: one foreground read, a `1,500 ms` bound,
     pure saved-gym matching, best-effort coordinate refresh, and immediate
     fallback to `gymId: null` on permission denial, timeout, no match, or
     location failure.
  3. Preserve the one-active-draft lock so location work cannot create a second
     session or overwrite an active one.
  4. Keep resume and planned-workout materialisation behaviour unchanged unless
     their gym-selection contract is separately reviewed.
- Why this action: it restores the documented automatic gym-selection behaviour
  at the point that now owns new-session creation, while avoiding duplicate GPS
  implementations and keeping workout start non-blocking.
- Smallest safe scope: centralise GPS-aware creation for brand-new empty drafts
  and route Train through it; do not change matching thresholds, permission
  configuration, gym-coordinate management, sync, or planned workouts.
- Risks and edge cases: permission prompts, slow or stale fixes, no match,
  multiple nearby matches, archived gyms, coordinate-refresh failure, duplicate
  location reads, and races with an existing active draft.
- Verification needed: coordinator coverage for matched and every fallback
  result; a Train integration test that does not mock the detection behaviour
  away; retained recorder-start regression coverage; and a production-navigation
  Maestro flow using a saved gym plus simulator location to assert preselection.
- Required gates: `./boga test fast` and `./boga test frontend` because the fix
  changes mobile session-entry logic and the canonical UI flow; derive any
  additional lane from `./boga test for` when the implementation paths are
  final.
- Docs/spec updates needed: none if the implementation only restores the
  existing contract in `docs/specs/ui/ux-rules.md`; update ownership wording if
  the shared session-entry boundary changes the durable architecture.
- Target: later `1.1.0` build (`14+`)
- Follow-up owner/task/PR: not yet assigned; create from `ACT-003` before this
  feedback round closes.

### FB-004 — Make personal-to-group exercise links removable where they are shown

- Status: `decided`
- First reported: `2026-09-22`
- Source/context: product-owner observation during the build 13 feedback round
- Report count: `1`
- Area / screen / flow: Groups → group → Exercises → linked exercise
- User impact: a member can see that a personal exercise is linked to a group
  exercise, but that group-facing row offers no way to remove the link. The
  existing unlink control is hidden behind the personal Exercise Catalog's
  overflow menu and an action labelled `Link to group exercise…`, so a member
  may reasonably conclude that links cannot be removed.
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
- Evidence links or local artifact paths:
  - `apps/mobile/components/groups/group-exercises-page.tsx` shows `Linked: …`
    on the group exercise row, but only passes an action when the row is
    unlinked (`Link your exercise`); a linked member row has no link-management
    action.
  - `apps/mobile/app/exercise-link.tsx` already supports confirmed, offline
    unlinking of an individual personal exercise.
  - `apps/mobile/app/(tabs)/exercise-catalog.tsx` is the only route into that
    screen from the catalogue, and its action remains labelled
    `Link to group exercise…` even when the exercise has existing links.

#### Reproduction

1. Link one of your personal exercises to a group exercise.
2. Open that group's Exercises segment and find the row showing
   `Linked: <personal exercise>`.
3. Try to remove the displayed link from that row.

- Expected: the linked group-exercise row exposes a clear way to manage its
  personal links and unlink one after confirmation.
- Actual: the row exposes neither an unlink nor a manage-links action; unlink
  is available only after navigating from the personal catalogue through an
  action whose label describes linking, not managing or unlinking.
- Reproduced on tagged build?: `not_yet` on device; reported against the build
  13 feedback round
- Reproduced on current `main`?: `not_yet` on device; source-confirmed
- Existing workaround: open the personal Exercise Catalog, open the exercise's
  overflow menu, choose `Link to group exercise…`, then use `Unlink` in the
  Linked section.
- Suspected component or path:
  `apps/mobile/components/groups/group-exercises-page.tsx`,
  `apps/mobile/components/groups/group-exercise-row.tsx`,
  `apps/mobile/app/exercise-link.tsx`,
  `apps/mobile/app/(tabs)/exercise-catalog.tsx`
- Related feedback IDs, issues, tasks, or PRs: `ACT-004`

#### Proposed action

- Decision: `accept`
- Proposal:
  1. Give a linked group-exercise row a member-visible `Manage links` action,
     rather than limiting the row action to the unlinked state.
  2. Show every one of the member's personal exercises linked to that group
     exercise and allow each link to be removed independently after a clear
     destructive confirmation. Preserve support for several personal exercises
     linking to the same group exercise.
  3. Reuse the existing local `unlinkExercise` write and link reload path so
     unlink remains offline-capable, retroactive, and sync-backed; do not add a
     group RPC or change board semantics.
  4. Rename the personal catalogue action to `Manage group links…` when links
     exist (or use wording that covers both link and unlink) so the existing
     route remains discoverable from the personal side.
- Why this action: management should be available where link status is visible,
  while retaining the existing personal-exercise route. Reusing the proven
  tombstone write avoids creating a second unlink contract.
- Smallest safe scope: add group-row link management and clarify the catalogue
  action label; reuse the current confirmation, repository operation, and link
  status reload rather than changing persistence, sync, evaluator, or boards.
- Risks and edge cases: several personal exercises linked to one target,
  archived group exercises, soft-deleted or locally missing personal exercises,
  an inactive link after leaving a group, offline operation, rapid repeated
  taps, unlink failure, and status refresh after the tombstone write.
- Verification needed: component coverage for zero/one/many links, confirmation
  and cancellation, offline success, failure without stale success UI, archived
  and missing-name rows, updated catalogue wording, and a Maestro flow that
  links then unlinks from the group-facing surface.
- Required gates: `./boga test fast`, `./boga test frontend`, and
  `./boga test ios-groups-e2e` because the follow-up changes group UI and its
  two-user interaction flow; confirm exact requirements with `./boga test for`
  once implementation paths are final.
- Docs/spec updates needed: `docs/specs/tech/groups-contract.md` and, if the
  interaction changes the documented screen behavior,
  `docs/specs/ui/screen-map.md` / `docs/specs/ui/ux-rules.md`.
- Target: later `1.1.0` build (`14+`)
- Follow-up owner/task/PR: not yet assigned; create from `ACT-004` before this
  feedback round closes.

## UI impact checkpoint

- This feedback card changes documentation only, so its own `ui_impact` remains
  `no`.
- `ACT-001` and `ACT-002` are significant UI follow-ups. Before implementation,
  each needs a UX Contract, a pinned accepted target, and the visual evidence
  required by `docs/specs/08-ux-delivery-standard.md` and
  `docs/specs/ui/ai-design-policy.md`.
- `ACT-003` restores an existing documented interaction rather than introducing
  a new visual target. Its implementation still needs flow evidence showing the
  automatically selected gym and the non-blocking fallback state.
- `ACT-004` extends an existing link-management interaction to the group-facing
  row. Its follow-up needs a compact UX Contract covering zero, one, and many
  linked personal exercises, confirmation, offline, archived, and failure
  states before implementation.
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
| `ACT-001` | `FB-001` | Open History on Summary; expose deterministic Details/Edit actions | High | `1.1.0` build `14+` | Unassigned | proposed | Navigation tests, frontend gate, History-flow screenshots |
| `ACT-002` | `FB-002` | Reuse completion-style live exercise/muscle summary and retire relative bars | Medium | `1.1.0` build `14+` | Unassigned | proposed | Insight/component tests, frontend gate, live/completion screenshots |
| `ACT-003` | `FB-003` | Route canonical empty-session creation through the bounded GPS gym detector | High | `1.1.0` build `14+` | Unassigned | proposed | Entry integration tests, frontend gate, GPS-preselection flow evidence |
| `ACT-004` | `FB-004` | Expose unlink/manage-links on linked group-exercise rows and clarify the catalogue action | High | `1.1.0` build `14+` | Unassigned | proposed | Link-management tests, frontend + groups e2e gates, linked/unlinked screenshots |

Action status values: `proposed`, `approved`, `in_progress`, `shipped`,
`verified`, `deferred`, or `rejected`.

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

- Feedback-only edits to this task card require documentation validation only.
- Once an action changes product code, use `./boga test for <changed paths>` to
  determine the required gates and record measured results in the implementing
  PR, not here.
- User-facing fixes must be verified against the reported flow on the actual
  replacement build before the related finding becomes `verified`.

## Completion note

- What feedback was collected:
- Decisions made:
- Follow-up tasks/PRs created:
- Replacement build/tag, if any:
- What remains:

This card remains `in_progress` while build `13` feedback is being collected.
Delete it when the feedback round is closed and all accepted actions have been
handed off or completed; git history retains the record.
