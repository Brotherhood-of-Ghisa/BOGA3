# M27-T09 — Evaluate private percentage group scores

- Status: `planned` (re-scoped 2026-10-04)
- Depends on: [M27-T08](M27-T08-Add_group_bodyweight_rules_and_metric_contracts.md), M27-T13 (completed), existing #411 task (completed)
- Milestone: [M27 — Bodyweight load and group comparisons](../milestones/M27-bodyweight-load-and-group-comparisons.md)
- Workstream: [#420](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/420)
- Areas: cross-stack; UI impact: yes (server-projected scores and omissions)

## Objective and scope

Implement T08's accepted percentage representation throughout evaluation,
publication and every group reader. Preserve T13's witness certificates while
scores change and enforce milestone D5 privacy before data reaches a client.
The old snapshot/three-board/public-bodyweight implementation is not this task.

## Deliverables and acceptance

1. Resolve the same private dated reading for effective-load computation and
   normalization. Use the shared TypeScript kernel, current source/target
   distribution rules and accepted T08 formula; never duplicate Wathan in SQL
   or normalize a target-mode value with an incompatible denominator.
2. Materialize T08's chosen Volume and 1RM results in Certified/All scopes.
   Off and c=0 use ordinary Volume (kg·reps)/1RM (kg) without querying readings.
   On with c>0 uses %BW 1RM and the chosen Volume policy. Unavailable private
   input omits dependent enabled scores; never substitute zero, fall back to kg
   while On, or reveal why the dependency failed. Rank before display rounding.
3. Re-evaluate affected comparisons after effective rules/contribution/mode
   changes and publish one coherent revision using existing generation/claim/
   lease locks. Recompute Certified entries without changing original certificate
   IDs/witness/time/audit metadata or ending them solely on rules changes.
   Ineligible scores can leave a board without ending their witness certificate.
4. Apply milestone D4: changed selected private dependency ends each bound
   dependent projection; raw Weight legacy witnesses remain active. Retain pins
   while Off; detect intervening corrections on dependent reactivation. First
   binding after rules-only missing context preserves the active witness; restore
   after a terminal correction never reopens it. Retain performance edits/deletes,
   manual withdraw/cancel and archived/former-member boundaries.
   Later readings irrelevant to a session never change its selected dependency.
   Personal preference/contribution edits never rescore a group performance.
5. Enforce D5 in actual current and legacy board/podium/record/history/event/
   stream/session/summary/certification RPC responses. Retain safe raw public
   context such as reps, but suppress enabled bodyweight absolute kg/load/volume
   counterparts, including session totals and same-group cross-endpoint joins.
   Ordinary Off sharing follows D5's explicitly limited privacy claim. Keep old absolute audit data server-side.
6. Migrate public history representation/visibility and invalidate incompatible
   caches per T08. Preserve history meaning and source clocks; do not silently
   relabel kg records or rewrite observed certificate values. Old readers must
   fail safely or receive an explicitly supported safe response.
7. Keep source enqueue/apply failures isolated from personal sync and from
   certification commits. Retain retries, stale-result fences and honest
   rebuilding/archived states. No new private-reading disclosure in logs/events.

## Verification

Read test-directory READMEs. Reuse existing backend lanes, actual pushes and
Edge drains. Cover two members with different B at equal reps/external load,
relative-rank results, ordinary and chosen bodyweight Volume, c=0/positive and
switch transitions, unweighted sets, distribution
conversions, no/invalid readings, later/relevant reading edits, rules-only
changes, edits/deletions, migration, history, archive/rejoin and legacy readers.
Assert exact active certificate identity/metadata and normalized values. D4
inventories the existing assertions to retain and the new correction matrix to
prove: value/date/delete/fallback/restore/backdated/tie/equal-score/no-op cases,
initial binding, coalesced unchanged tuples, inactive pins and cutover corrections.
Use effective estimated total-load 1RM in the numerator, not the current personal
displayed added-load 1RM; recalculate numerator and denominator from the same B.

Privacy checks inspect every enabled-group RPC payload and paired responses
for disallowed absolute/relative values, including full session and aggregate
subtraction. Verify ordinary Volume/1RM while Off without reading access, On
cache/history redaction, and the documented cross-mode/cross-group limit. Anonymous/OAuth/outsider tests remain. Add Jest scorer/decoder/cache
coverage for the shared behavior; use failure injection for queue/publication.

## Specs to update

- `docs/specs/tech/groups-contract.md` — shipped scoring, privacy, lifecycle,
  publication and readers.
- `docs/specs/tech/bodyweight-load-contract.md`, `training-metrics-contract.md`
  — public normalization over private dated context.
- `docs/specs/05-data-model.md`, `03-technical-architecture.md` — changed projections.

## Gates and closeout

Use `./boga test for`; propose `fast`, `backend` (group leaderboards and API-live)
plus `ios-groups-e2e`, with sync e2e only for a real sync-path change. Obtain the
operator's lane agreement and run to green, plus required quality targets.
Do not add Maestro scenarios without justification and approval. Delete this
card and mark its M27 row completed in the implementing PR; T10 owns UI and T14
owns human acceptance/combined closeout and authorized hosted smoke.
