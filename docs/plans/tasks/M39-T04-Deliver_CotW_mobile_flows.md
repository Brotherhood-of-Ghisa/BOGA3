# M39-T04 — Deliver COW mobile flows

- Status: `planned`
- Depends on: `M39-T03-Serve_CotW_rankings_and_history`
- Milestone: `docs/plans/milestones/M39-group-challenge-of-the-week.md`
- Areas: frontend, integration, docs; UI impact: yes

## Objective

Let admins set the weekly challenge and members find its independent metric
rankings in the existing group experience. Complete the feature with real
two-member results, usable unavailable/offline states and visual evidence.

## Scope

- In: current/next/prior COW discovery, admin next-week scheduling/management,
  group-zone setup where needed, live/finalizing/final results,
  permission/state/error handling, targeted integration and issue closeout.
- Out: a new top-level tab, combined winner, recurring creation, notifications,
  manual submissions, rewards, aggregate certification and hosted deployment.

## Decided

Milestone D1–D9 and the merged T01 contract. Reuse the API/guards/cache from
T02/T03, existing group resource/action hooks, exercise picker and rank/UI
primitives. A missing improvement baseline does not hide a valid 1RM or
Volume result. Group %BW 1RM and personal improvement % need distinct labels.

The operator confirmed the COW summary appears immediately on At a glance.
Scheduling starts on the individual group page and opens a secondary COW page:
owners/admins create/edit; members view/browse. The summary opens that page
for reading, with no admin scheduling controls on At a glance.

## Open — resolve with the operator at session start

- Review the attached [COW UX brief](../M39-cow-ux.md), currently a draft, and
  add current group reference screenshots before accepting the design target.
  Apply `docs/specs/ui/ai-design-policy.md`; accepted directions are build
  inputs, never a replacement for the merged T01 contract.
- Refine the agreed summary and secondary-page layouts, next-COW form,
  results/history and group-zone control; placement and navigation above are
  settled. Scheduling always targets next week; no date picker or later-week
  queue. Retain group/COW identity, its shared zone and Back to the origin.
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
3. Jest covers happy and failure flows, current/next/prior COW, multi-metric
   choice, no baseline/no result, normalized labels, stale responses, lost
   role/access, offline cached/no-cache states, finalizing/final outcomes,
   fixed next-week dates, membership eligibility and revision conflicts. Prove
   the summary is immediately visible, group-page admin scheduling opens the
   secondary form, members can browse without edit controls, and Back retains
   the originating group/page. Use
   existing test fixtures and read `apps/mobile/__tests__/README.md` first.
4. Prove next-week scheduling through two-member results and stored final
   history against local Supabase and the production client. Reuse existing
   group device coverage when possible.
   Before adding a Maestro scenario, write why Jest/API tests cannot prove
   its device-only behavior and state exactly what the flow proves.
5. Capture the running app at small and large phone sizes and compare against
   the agreed target, including create, rankings and unavailable/error states;
   add any size required by the current competition contract. Check accessible
   labels, touch targets, scrolling/keyboard and non-colour state cues. Link
   screenshots and material deviations in the PR.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Find challenge | Select a group; read the immediate At a glance summary; open its COW on the secondary page | Correct shared week, exercise and selected metric rankings | No current COW stays empty; browsing remains available; no inline admin controls |
| Set challenge | Owner/admin opens Schedule next COW from the individual group page; reviews fixed dates/zone on the secondary form, picks exercise/metrics and publishes | One upcoming COW is visible to all members | Missing zone/eligible exercise, offline, validation or conflict preserves input; members cannot write |
| Read results | Choose a metric; inspect live standings or stored final rank | Values/units and finality match the server COW | Missing baseline is unranked only for improvement; finalizing is never shown as final |
| Manage challenge | Admin opens Edit next COW from the group page and edits/cancels on the secondary page | Server lifecycle is reflected immediately; Back returns to the originating group | State/role changed: refresh with input retained; destructive actions confirm |
| Reopen/history | Open the secondary COW page from the group page or summary, then browse stored results; or reopen offline | Authorized final outcome or permitted cached context; Back preserves origin | No cache, lost membership and suppressed history expose no stale private value |

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
review. Delete this card, the attached UX brief and the milestone in the shipping PR, link the
feature's evidence there, and close #927 only when its complete acceptance
holds. After the human merges, confirm the remote merge and release this
task's worktree/slot in the same session.
