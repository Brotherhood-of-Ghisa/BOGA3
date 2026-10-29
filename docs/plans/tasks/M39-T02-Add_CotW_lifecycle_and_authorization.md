# M39-T02 — Add CoW lifecycle and authorization

- Status: `planned`
- Depends on: `M39-T01-Define_CotW_rules_and_scoring`
- Milestone: `docs/plans/milestones/M39-group-challenge-of-the-week.md`
- Areas: backend, frontend API; UI impact: no

## Objective

Persist an admin's weekly challenge and enforce its agreed lifecycle entirely
on the server. Provide the typed mobile write/read-definition boundary that
the later rankings and UI consume, with existing group authorization intact.

## Scope

- In: group time-zone default/storage, additive group-domain schema, participant
  and final-result lifecycle storage; definition get/list and next-week
  create/update/cancel operations; exact wire guards and typed API methods.
- Out: scoring and automatic finalization implementation (T03), public score
  reads, screens, new sync entities, recurring CoW creation and hosted deployment.

## Decided

Milestone D1–D5, D7–D9 and the merged T01 contract. Only an active owner/admin may
manage a challenge; active members can read it. Use existing group exercise
identities and protocol conventions. Group tables stay outside Sync v2.

## Open — resolve at session start

- Choose concrete table/RPC names, constraints and indexes from the settled
  lifecycle, not a generic competition framework.
- Check T01 freshness against main, including how expected revision and
  cancellation/recreation make a timed-out or repeated write safe to retry.
  Use existing RPC return/error conventions; no client offline write queue.
- Decide existing-group zone initialization without guessing a creator's zone
  from the current viewer. A missing zone needs an explicit admin choice
  before scheduling; create-group defaults must receive the creator's zone.
- Provide the lifecycle/claim/fencing storage T03 needs for scheduled roster
  capture and retry-safe finalization. Finalization must not depend on a mobile
  read. Handle membership changes at start and source writes at the cutoff.

## Deliverables and acceptance

1. Store the group's validated IANA zone and T01's definition, participant and
   result lifecycle state: identity, metrics, immutable week bounds/zone and
   scoring context/revision. Validate next-week-only creation on the server;
   reject already-started/further-future weeks, foreign exercises and invalid
   inputs. Capture the creator's zone through the existing group-creation
   boundary compatibly with old clients; do not change published CoW bounds.
2. Serialize mutations with the group authorization lock and enforce
   one published CoW per group/week, no overlapping windows (including zone
   changes), and lifecycle transitions under concurrent admin writes.
   A stale edit must fail predictably without losing the mobile form input.
3. New tables have RLS, no direct client grants, no `owner_user_id`, and no
   FK into a private mirror entity. Every privileged helper/RPC independently
   denies OAuth agents. Auth, membership, role and input check order follows
   `docs/specs/10-api-authn-authz-guidelines.md` and the group contract.
4. Add exact definition/write decoders and API methods through
   `apps/mobile/src/groups/api.ts`, updating its RPC-name union and required
   exports. Use new RPCs/shapes rather than adding fields that existing exact
   readers reject; keep protocol-4 request headers local to each call.
5. Extend existing backend group suites and Jest API/guard tests. Prove
   owner/admin success, member write denial, anonymous/OAuth denial,
   outsider/nonexistent equivalence, cross-group exercise rejection, direct
   table denial, next-week-only/deadline inputs, DST and zone defaults/changes,
   stale/concurrent changes and idempotent
   behavior required by the contract. New schema must not enter sync drift.

## Specs to update

- The challenge contract introduced by T01 — server lifecycle invariants.
- `docs/specs/05-data-model.md` only if its server-group classification needs clarification.
- `docs/specs/10-api-authn-authz-guidelines.md` only if the authorization model gains a rule.
- Owning product facts only for decisions beyond the merged T01 contract.

## Gates and closeout

Expected: `./boga test fast`, `backend` (including `groups-contract`,
`groups-competitions`, `groups-api-live`), `jest-coverage`, `complexity`,
`dependencies`. Default group paths also select `ios-groups-e2e`; propose
`covered-by-jest` lowering only if the reviewer agrees this additive API/schema
change leaves device paths untouched. Otherwise run it. No sync-code changes
are planned; if they become necessary, apply the auth/sync gate defaults too.

Run `./boga test for`; agree lanes with the reviewer. Run independent code,
security and product review. Delete this card, mark T02 completed and stop
local Supabase when opening the PR. Do not deploy or close #927.
