# M39-T04 — Deliver CotW mobile flows

- Status: `planned`
- Depends on: `M39-T03-Serve_CotW_rankings_and_history`
- Milestone: `docs/plans/milestones/M39-group-challenge-of-the-week.md`
- Areas: frontend, integration, docs; UI impact: yes

## Objective

Let admins set the weekly challenge and members find its independent metric
rankings in the existing group experience. Complete the feature with real
two-member results, usable unavailable/offline states and visual evidence.

## Scope

- In: current/prior challenge discovery, admin create/manage, metric rankings,
  permission/state/error handling, targeted integration and issue closeout.
- Out: a new top-level tab, combined winner, recurring creation, notifications,
  manual submissions, rewards, aggregate certification and hosted deployment.

## Decided

Milestone D1–D6 and the merged T01 contract. Reuse the API/guards/cache from
T02/T03, existing group resource/action hooks, exercise picker and rank/UI
primitives. A missing improvement baseline does not hide a valid 1RM or
Volume result. Group %BW 1RM and personal improvement % need distinct labels.

## Open — resolve with the operator at session start

- Agree the significant-UI design target before implementation: a repo-native
  brief plus current group reference screenshots is sufficient. Keep it beside
  this contract or in the PR, under `docs/specs/ui/ai-design-policy.md`.
- Choose the smallest discoverable placement in Groups and group management;
  pin current/prior week navigation, metric choice and permitted detail links.
  Every path must retain the selected group/challenge identity.
- Settle final copy using `docs/product/copy.md`; do not imply finality or
  certification the server contract does not provide.

## Deliverables and acceptance

1. Build the flows below with existing components. Render every selected
   metric independently; use explicit unit/metric labels and generic safe
   unavailable copy. Do not calculate competitive results from local workouts.
2. Admin controls follow live role/state, show near-field validation, retain
   form inputs on failure and re-read after confirmed success. Offline writes
   are refused visibly; handle an uncertain transport outcome by refreshing
   before retry so a successful create cannot duplicate the challenge.
3. Jest covers happy and failure flows, current/prior challenge, multi-metric
   choice, no baseline/no result, normalized labels, stale responses, lost
   role/access, offline cached/no-cache states and revision conflicts. Use
   existing test fixtures and read `apps/mobile/__tests__/README.md` first.
4. Prove admin creation through two-member results against local Supabase and
   the production client. Reuse existing group device coverage when possible.
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
| Find challenge | Select a group; open its challenge | Correct shared week, exercise and selected metric rankings | No challenge is an intentional empty state; admin gets a creation path |
| Set challenge | Owner/admin selects the permitted week, group exercise and metrics; saves | Server definition is shown and reads refresh | Offline/validation/conflict preserves input; members cannot invoke writes |
| Read results | Choose a metric; inspect rank and permitted detail | Server values/units match the selected group, week and metric | Missing baseline is unranked only for improvement; missing score/rebuild uses safe copy |
| Manage challenge | Admin opens an existing definition and takes an allowed edit/cancel action | Server lifecycle is reflected immediately | State/role changed: refresh with input retained; destructive actions confirm |
| Reopen/history | Reopen offline or select a prior challenge | Correct cached context and existing offline marker, or authorized historical result | No cache, lost membership and suppressed history expose no stale private value |

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
review. Delete this card and the milestone in the shipping PR, link the
feature's evidence there, and close #927 only when its complete acceptance
holds. After the human merges, confirm the remote merge and release this
task's worktree/slot in the same session.
