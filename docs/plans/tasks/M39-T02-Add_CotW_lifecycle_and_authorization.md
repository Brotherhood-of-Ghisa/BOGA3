# M39-T02 — Add CotW lifecycle and authorization

- Status: `planned`
- Depends on: `M39-T01-Define_CotW_rules_and_scoring`
- Milestone: `docs/plans/milestones/M39-group-challenge-of-the-week.md`
- Areas: backend, frontend API; UI impact: no

## Objective

Persist an admin's weekly challenge and enforce its agreed lifecycle entirely
on the server. Provide the typed mobile write/read-definition boundary that
the later rankings and UI consume, with existing group authorization intact.

## Scope

- In: additive group-domain schema; definition get/list and create/update/
  cancel operations required by T01; exact wire guards and typed API methods.
- Out: ranking aggregation, public score reads, screens, new sync entities,
  recurring jobs and hosted deployment.

## Decided

Milestone D1–D5 and the merged T01 contract. Only an active owner/admin may
manage a challenge; active members can read it. Use existing group exercise
identities and protocol conventions. Group tables stay outside Sync v2.

## Open — resolve at session start

- Choose concrete table/RPC names, constraints and indexes from the settled
  lifecycle, not a generic competition framework.
- Check T01 freshness against main, including how expected revision and
  cancellation/recreation make a timed-out or repeated write safe to retry.
  Use existing RPC return/error conventions; no client offline write queue.

## Deliverables and acceptance

1. Store exactly the definition state T01 requires: group/exercise identity,
   selected metrics, authoritative week bounds/zone and the revision/state
   necessary for concurrency. Validate on the server; reject foreign or
   ineligible exercises and invalid windows/metric selections.
2. Serialize mutations with the group authorization lock and enforce
   uniqueness/overlap and lifecycle transitions under concurrent admin writes.
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
   table denial, invalid inputs, stale/concurrent changes and idempotent
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
