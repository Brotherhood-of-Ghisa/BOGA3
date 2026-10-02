# M29-T04-Today_group_card_and_closeout — The Group activity card

- Status: `planned`
- Depends on: `M29-T02-Today_progress_card`, `M29-T03-Group_week_summary_RPC`
- Milestone: `docs/plans/milestones/M29-today-landing-page.md`
- Areas: frontend; UI impact: yes

## Objective

Replace Today's group stream snapshot with the Group activity card of
`today-landing.md`: the switcher (only with more than one group), this week's
top three by working sets with PRs and the `You · <rank>` line, and the latest
activity row (one training now, several training now, or the latest completed
session). Then capture every accepted state, get gallery acceptance, and close
the milestone.

## Scope

- In: the group card component(s) on `app/(tabs)/today.tsx`, T03's client,
  the group list for the switcher, empty/signed-out/offline/error states, Jest,
  the Maestro capture of the group states, docs, milestone closeout.
- Out: the Groups tab; the stream cards' own design.

## Decided

- The target and brief (`today-landing.md`, group card); D2, D4, D6, D7.
- Switcher only with more than one group; the selected group is per device.
- Several training now collapses into one row that opens the Groups tab; one
  training now or the latest completed session opens the group session.
- The exercise-linking suggestion is not on Today.

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
4. `today-train.md` reduced to Train; the M29 milestone deleted (last card).

## UX contract (UI tasks only)

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Switch group | Tap another chip | Board + latest activity for that group | Load error → inline `Notice` + `Retry` |
| Open groups | Tap `View groups`, or the several-training row | Groups tab | — |
| Open session | Tap the latest-activity row (one person) | Group session view | Lost access → existing state |
| No group | Signed in, no group | `Train with friends`, `Find a group` → My groups | — |

## Specs to update

- `docs/specs/ui/screen-map.md`, `navigation-contract.md`, `ux-rules.md`
  (Today group card), `design-targets/today-landing.md` (states, lanes),
  `design-targets/today-train.md`, `design-targets/groups.md` (the retired
  `groups-07c-0-today-record` state).

## Gates

Expected from `./boga test for`: `fast` + `frontend-ui` + `ios-groups-e2e`
(+ `groups-api-live` if T03's client changes); agree with the operator. Before
the PR: `jest-coverage`, `complexity`; suggest `./boga sweep` (shared UI).
