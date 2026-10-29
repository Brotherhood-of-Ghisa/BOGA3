# M39-T04 — Deliver CoW mobile flows

- Status: `planned`
- Depends on: `M39-T03-Serve_CotW_rankings_and_history`
- Milestone: `docs/plans/milestones/M39-group-challenge-of-the-week.md`
- Areas: frontend, integration, docs; UI impact: yes

## Objective

Let admins set the weekly challenge and members find its independent metric
rankings in the existing group experience. Complete the feature with real
two-member results, usable unavailable/offline states and visual evidence.

## Scope

- In: compact current/last-week-final CoW card on Today / Groups, detailed current/next/prior
  browser reached from Groups, admin next-week scheduling/management,
  group-zone setup where needed, live/finalizing/final results,
  permission/state/error handling, targeted integration and issue closeout.
- Out: a new top-level tab, combined winner, recurring creation, notifications,
  manual submissions, rewards, aggregate certification and hosted deployment.

## Decided

Milestone D1–D9 and the merged T01 contract. Reuse the API/guards/cache from
T02/T03, existing group resource/action hooks, exercise picker and rank/UI
primitives. A missing improvement baseline does not hide a valid 1RM or
Volume result. Group %BW 1RM and personal improvement % need distinct labels.

The operator clarified: Today / Groups shows a small card for this week's CoW
when one exists, otherwise last week's stored final CoW labelled Last week ·
Final with actual dates; hide the card when neither is available. The detailed secondary
browser is accessible from Groups. The earlier
At a glance summary placement is replaced by this distinction. The Today card
shows the first three places and supports in-card switching between enabled
1RM / Improvement / Volume leaderboards. Its header opens that group's displayed
CoW with the selected metric; switching metrics never navigates. Scheduling starts on the
individual group page and opens secondary creation/editing for owners/admins;
members view/browse. No admin scheduling controls on Today.

The member browser direction is selected: chronological This week, Next week
and Past CoWs sections, with the current metric's top-three preview and Full
standings. The operator requested a horizontal current-CoW banner, preserving
existing formatting: exercise/status left, dates/zone right. The revised
mockup is attached to the brief; no browser tabs or week stepper. The browser,
Today top-three card and scheduling form are approved design targets.
The fallback is also agreed: a current CoW with no scores still takes priority;
never substitute older, upcoming or non-final results as fallback. The header opens the
displayed week's CoW and selected metric. No placeholder or reserved space
when the card is hidden.

## Open — resolve with the operator at session start

- Use the three approved mockups in the [CoW UX brief](../M39-cow-ux.md).
  Review its companion group-entry, empty and error targets and state tables;
  editing reuses that form with Edit CoW / Save changes, subject to T01.
  Apply `docs/specs/ui/ai-design-policy.md`; accepted targets are build
  inputs, never a replacement for the merged T01 contract.
- Capture current group references before implementation. The brief proposes
  one Groups CoWs link, a group-page browse row/outlined scheduling action,
  state recovery and a Time zone field in group Edit. Finalize rule-dependent
  results/history and zone controls against T01; settled approvals stand.
  Scheduling always targets next week; no date picker or later-week
  queue. Retain group/CoW identity, its shared zone and Back to the origin.
- Settle copy using `docs/product/copy.md`. Only a stored final outcome says
  Final; a week whose deadline passed can still be Finalizing. Push result
  announcements remain out of scope; in-app reporting is part of this task.

## Deliverables and acceptance

1. Build the flows below with existing components. Render every selected
   metric independently; use explicit unit/metric labels and generic safe
   unavailable copy. Do not calculate competitive results from local workouts.
2. Admin controls follow live role/state, show near-field validation, retain
   form inputs on failure and re-read after confirmed success. Offline writes
   are refused visibly; handle an uncertain transport outcome by refreshing
   before retry so a successful create cannot duplicate the challenge.
3. Jest covers happy and failure flows, current/next/prior CoW, multi-metric
   choice, no baseline/no result, normalized labels, stale responses, lost
   role/access, offline cached/no-cache states, finalizing/final outcomes,
   fixed next-week dates, membership eligibility and revision conflicts. Prove
   the Today card uses the group's current week, then exactly last week's
   stored final result with Last week · Final/dates, else no card or gap. Prove
   current/no-scores precedence and no older/upcoming/non-final fallback,
   group-zone rollover, and that group switching cannot retain stale CoW
   context, in-card metric switching shows the proper server top three and units
   without opening detail, and the header opens the same metric/group/CoW.
   Cover fewer/no qualifying rows, only enabled metrics and no substitution of
   the viewer for a top-three place. Groups opens the detailed browser; group-page admin scheduling opens the
   secondary form, members can browse without edit controls, and Back retains
   the originating group/page. Prove empty sections stay distinct from failed
   reads, Today does not infer absence from loading/errors, partial failures
   retain safe loaded sections, and an uncertain publish disables another
   create until Check status resolves the authoritative slot. Verify missing
   zone/exercise return paths retain the form and revalidate next week's bounds. Use
   existing test fixtures and read `apps/mobile/__tests__/README.md` first.
4. Prove next-week scheduling through two-member results and stored final
   history against local Supabase and the production client. Reuse existing
   group device coverage when possible.
   Before adding a Maestro scenario, write why Jest/API tests cannot prove
   its device-only behavior and state exactly what the flow proves.
5. Capture the running app at small and large phone sizes and compare against
   the agreed target, including create, rankings and unavailable/error states;
   add any size required by the current competition contract. Include Today
   with its full weekly board, CoW preview and training-now/recent content:
   preserve usable internal scrolling and the tab bar on small screens. Check accessible
   labels, touch targets, scrolling/keyboard and non-colour state cues. Link
   screenshots and material deviations in the PR.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Find challenge | Read the Today card or open the detailed browser from Groups | Current CoW first, otherwise exactly last week's stored final with explicit label/dates; detail matches displayed context | A successful read establishing no eligible current/fallback means no card or gap; loading/errors remain distinct; no older/upcoming/non-final fallback or admin controls |
| Browse Today rankings | Tap an enabled metric inside the CoW card; read its first three places | Correct server ranks/units update in place; header opens the same metric in detail | Fewer/no results and unavailable metrics stay explicit; controls never trigger navigation |
| Set challenge | Owner/admin opens Schedule next CoW from the individual group page; reviews fixed dates/zone on the secondary form, picks exercise/metrics and publishes | One upcoming CoW is visible to all members | Missing zone/eligible exercise, offline, validation or conflict preserves input; members cannot write |
| Read results | Choose a metric; inspect live standings or stored final rank | Values/units and finality match the server CoW | Missing baseline is unranked only for improvement; finalizing is never shown as final |
| Manage challenge | Admin opens Edit next CoW from the group page and edits/cancels on the secondary page | Server lifecycle is reflected immediately; Back returns to the originating group | State/role changed: refresh with input retained; destructive actions confirm |
| Reopen/history | Open the secondary CoW page from the group page or summary, then browse stored results; or reopen offline | Authorized final outcome or permitted cached context; Back preserves origin | Full rankings/history stay online-only; no cache, lost membership and suppressed history expose no stale private value |

Interaction/appearance: reuse group selector, cards, rank rows, sheets,
notices, tokens and refresh patterns. No cross-metric overall winner. Evidence
and flow-to-test mapping belong in the shipping PR.

## Specs to update

- `docs/specs/ui/screen-map.md` — screen entry, exits and states.
- `docs/specs/ui/navigation-contract.md` — changed routes, params or transitions.
- `docs/specs/ui/components-catalog.md` only if discoverable component ownership changes.
- `docs/product/groups.md` / `docs/product/copy.md` — qualifying new decisions only.
- The challenge contract — final durable behavior, with no design target copied into specs.

## Gates and closeout

Expected on macOS: `./boga test fast`, `groups-api-live`, `ios-smoke`,
`ios-groups-e2e`, `jest-coverage`, `complexity`, `dependencies`. The group
screen/component trigger narrows the general `frontend-ui` default to launch
smoke plus groups e2e; choose lanes from the actual diff and explain any
lowering with the reviewer. Adding root-stack registration triggers the full
`frontend` default; agree any change to that set explicitly. Backend changes
also require `backend` / `groups-competitions`. On Linux the group UI trigger
selects `android-smoke`; use any broader Android lanes the actual diff requires.

Use `./boga test for`, obtain lane agreement and independent code/product
review. Delete this card, the attached UX brief/mockups and the milestone in the shipping PR, link the
feature's evidence there, and close #927 only when its complete acceptance
holds. After the human merges, confirm the remote merge and release this
task's worktree/slot in the same session.
