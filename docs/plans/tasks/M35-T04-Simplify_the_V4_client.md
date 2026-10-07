# M35-T04-Simplify_the_V4_client — Simplify the V4 client

- Status: `planned`
- Depends on: `M35-T03-Remove_pre_V4_server_code`
- Milestone: `docs/plans/milestones/M35-retire-pre-v4-group-competitions.md`
- Areas: frontend (`apps/mobile/src/groups`); UI impact: no

## Objective

`apps/mobile/src/groups` holds only V4 code: no protocol-3 types, guards,
scorers or view models, and no dead V4 surface.

## Scope

- In: protocol-3 TS T03 left behind (candidates: `metric-contract.ts`,
  `metric-wire.ts`, `metric-wire-guards.ts`, `performance-score.ts`,
  `metric-view-model.ts` — confirm each has no V4 caller); the unused
  `getCompetitionContract`; the `pending` branch of the activation-state type
  if nothing decodes it; their tests; complexity/dependency baselines that shrink.
- Out: V4 wire guards' accepted shapes (M35 D4); UI changes.

## Decided

M35 D4. Shipped 1.1.0 clients and this build must keep decoding the same V4
payloads.

## Open — resolve with the user at session start

- Whether any `metric-*` module is still the V4 scorer under an old name
  (rename in place vs leave).

## Deliverables and acceptance

1. No protocol-3 module in `apps/mobile/src/groups`; `jest-coverage`,
   `complexity` and `dependencies` green, suppression/baseline lists shrunk
   where entries went with deleted code.
2. `groups-api-live` green against the T03 schema.

## Gates

`fast` + `groups-api-live` + `ios-groups-e2e` + the three quality targets;
confirm with `./boga test for`.
