# M29-T05-Today_group_card_and_closeout — The Group activity card

- Status: `planned`
- Depends on: `M29-T03-Today_progress_card`, `M29-T04-Group_week_summary_RPC`
- Milestone: `docs/plans/milestones/M29-today-landing-page.md`
- Areas: frontend; UI impact: yes

## Objective

Replace Today's group stream snapshot with the Group activity card of
`today-landing.md`: the switcher (only with more than one group), this week's
top three by working sets with group records as `PRs` (D4) and the
`You · <rank>` line, and the latest
activity row (one training now, several training now, or the latest completed
session). Then capture every accepted state, get gallery acceptance, and close
the milestone.

## Scope

- In: the group card component(s) on `app/(tabs)/today.tsx`, T04's client,
  the group list for the switcher, empty/signed-out/offline/error states, Jest,
  the Maestro capture of the group states, docs, milestone closeout.
- Out: the Groups tab; the stream cards' own design.

## Decided

- The target and brief (`today-landing.md`, group card); D2, D4, D6, D7.
- Switcher only with more than one group; the selected group is per device.
- Several training now collapses into one row that opens the Groups tab; one
  training now or the latest completed session opens the group session.
- The exercise-linking suggestion is not on Today.
- Data (T04): `getGroupWeekSummary({ groupId, windowStartMs, windowEndMs })`,
  `groups-contract.md` §4.7. The window is the local week (D3); the client
  trims `members` to three and finds `You` by user id (ranks may tie).
  `training_now` drives the live row (empty, one, or several);
  `latest_completed` (any time, with its `group_records`) drives the
  completed row and opens through `group_session_detail`.

## From T03 (as built)

- `app/(tabs)/today.tsx` now renders the Progress section, then the old
  `TodaySocialSnapshot` (the stream snapshot) under `Group activity`: replace
  that function and its `TodaySocialState`; the stream read (`useGroupStream`)
  in the route goes with it.
- Today's card parts live in `components/today/` (not `components/ui/`):
  `ShareBar` (6pt, `viz0` track, `viz3` fill, `viz4` once reached) and the
  `todayText` type roles are there to reuse for the board's bars; the board
  bars are 12pt in the canvas.
- No group tags on the latest-session row (decided with the user: the device
  does not know shares). `today-landing.md` has a "Build decisions" list;
  add the group card's there.
- Maestro: Jest owns Today (user's call); no committed flow asserts Today
  beyond `today-screen` in `smoke-launch.yaml`. `session-view.yaml` no longer
  visits Today. Gallery captures came from a one-off flow
  (`scripts/maestro-ios-run-flow.sh --flow <scratch yaml>`) over the
  committed `fixture=today-progress` + `teleport=today` harness params (spec
  11 §9). The slot simulator is an iPhone 17 Pro (402pt); the user accepted
  the T03 gallery at that width.
- `today-train.md` is already reduced to Train (its Today states removed);
  `groups-07c-0-today-record` was dropped from it — `groups.md` may still
  name it.

## Open — resolve with the user at session start

1. **Default group** when there are several: last selected, most active this
   week, or the first?
2. **Offline / cached**: show the last cached summary with the offline
   `Notice`, as the stream does?
3. **Maestro**: which two-user flow captures the group states (the
   `ios-groups-e2e` lane's fixture users, one user per flow)?

## Deliverables and acceptance

1. The group card renders all four target states and the signed-out /
   auth-unavailable / no-group / offline / error states.
2. Jest covers the switcher rule, top three + `You · <rank>`, and the three
   latest-activity forms.
3. Gallery of every state at 390pt, accepted by the user;
   `today-landing.md` updated to name the lanes and screenshots and marked
   built.
4. The M29 milestone deleted (last card).

## UX contract (UI tasks only)

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Switch group | Tap another chip | Board + latest activity for that group | Load error → inline `Notice` + `Retry` |
| Open groups | Tap `View groups`, or the several-training row | Groups tab | — |
| Open session | Tap the latest-activity row (one person) | Group session view | Lost access → existing state |
| No group | Signed in, no group | `Train with friends`, `Find a group` → My groups | — |

## Specs to update

- `docs/specs/ui/screen-map.md`, `navigation-contract.md`, `ux-rules.md`
  (Today group card), `design-targets/today-landing.md` (states, lanes, and
  the brief stating the group card's `PRs` are group records, D4),
  `design-targets/groups.md` (the retired
  `groups-07c-0-today-record` state).

## Gates

Expected from `./boga test for`: `fast` + `frontend-ui` + `ios-groups-e2e`
(+ `groups-api-live` if T04's client changes); agree with the operator. Before
the PR: `jest-coverage`, `complexity`; suggest `./boga sweep` (shared UI).
