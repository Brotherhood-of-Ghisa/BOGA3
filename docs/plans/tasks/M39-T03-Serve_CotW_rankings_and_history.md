# M39-T03 — Serve CoW rankings, finalization and history

- Status: `planned`
- Depends on: `M39-T02-Add_CotW_lifecycle_and_authorization`
- Milestone: `docs/plans/milestones/M39-group-challenge-of-the-week.md`
- Areas: backend, frontend domain/API; UI impact: no

## Objective

Return one authoritative result per selected challenge metric, with weekly
best 1RM, pre-week shared baseline and summed weekly Volume implementing T01.
Automatically finalize and store ended CoW results; serve live and final
results through privacy-safe, exact public shapes the mobile UI can use.

## Scope

- In: start-time roster capture, authorized candidate selection, shared pure
  aggregation, coherent live reads, automatic/retryable finalization, durable
  immutable results, exact wire/API/cache boundary and local-Supabase integration.
- Out: changing existing lifetime boards, copying private workout graphs,
  public private-reading context, screens, notifications and hosted deployment.

## Decided

Milestone D1–D5, D7–D9 and the merged T01 contract. Never use the lifetime winning
board row as the weekly source. Sum eligible per-set Volume once per set.
The improvement denominator is group-shared and strictly pre-week; missing
baseline excludes only that metric. Preserve normalized disclosure across
definition, current results, history and linked session reads.

## Open — resolve at session start

- Trace source/projection freshness fences and choose how to retain the
  deadline's eligible source versions before later mutations. Finalizing on
  first history read from mutable rows is insufficient. Reuse/extend existing
  backend evaluation/scheduling, with no separate service. SQL may aggregate
  published values but never mirror TS load, effort or 1RM rules.
- Define automatic start/close discovery, coherent draining of work accepted
  before the agreed deadline, retry/backoff and exactly-once final publication
  using T02's storage. The passage of time needs no open app or new workout.
- Choose pagination/indexing and unavailable/rebuilding envelopes. Account for
  an all-time baseline without an unbounded raw graph in a mobile payload.
- Decide which score/baseline details are safe and useful to return. A weekly
  total has no single certifiable witness; do not add aggregate Certify.

## Deliverables and acceptance

1. Read exactly the qualifying shared/linked source prescribed by T01, with
   identical bounds for every viewer. Handle late sync, completed-state
   changes, edits/deletes/restores, link changes, leave/rejoin, archive and
   revision changes according to that contract. Rebuilding must not expose
   an apparently final partial sum or mix generations. Capture the roster as
   of the start even if the job runs late; keep leavers' qualifying results and
   prevent later joins/rejoins from entering that CoW.
2. Reuse the pure T01 boundary / existing scorer, retaining precision. Return
   metric-specific rank, unit and missing/unavailable state; deterministic
   ties and overflow follow the contract. Missing source/baseline never
   produces a fabricated percentage. Zero attained 1RM/Volume never ranks;
   eligibility of a genuine 0% improvement follows T01's signed/gains rule.
3. Apply current authorization/disclosure on every current/history read,
   even for saved or archived rules. Reject OAuth and outsiders; never expose
   private B, its provenance, digests, or suppressed absolute counterparts.
   Test totals and baseline-plus-other-endpoint joins, not only field names.
4. Add exact guards, API methods and account/group/week/revision-bound cache
   keys through the existing group modules. Do not cache full result pages
   where the existing online-paged pattern suffices. Evict incompatible new
   payload generations and drop stale account/group responses. Provide the
   small current-CoW summary Today consumes, using the authoritative group
   week; never return upcoming or previous-week data as its current result.
5. Extend the existing group backend and real-client API suites with at least
   two members, several sessions, pre-week and boundary sets, several selected
   metrics, missing baseline/reading, ordinary and normalized exercises, and
   source/revision/role races. Run real responses through the mobile guards.
   Read each test directory's README before modifying its tests.
6. At the agreed deadline, finalize all selected metrics as one coherent,
   durable outcome with original units, ranks and scoring context. Publish
   once, including an empty outcome; a retry cannot replace final results.
   Expose finalizing until complete. Afterwards serve the stored outcome:
   later edits/deletes/restores, links, membership or formula changes cannot
   rerank it. Current disclosure can hide unsafe figures without rescoring.
   Test delayed/crashed/retried jobs, no app reads, evaluator backlog and
   mutations on both sides of the cutoff; distinguish a late upload from
   timely data whose evaluation finishes late.

## Specs to update

- The T01 challenge contract — publication/read consistency and result lifecycle.
- `docs/specs/tech/groups-contract.md` and `docs/specs/tech/group-competition-contract.md` — changed shared boundaries only.
- `docs/product/groups.md` — highlight any product decision added beyond T01.
- If shared rules change, load `docs/procedures/rule-upgrade.md`; do not bump
  unrelated personal/coaching rules for a new aggregation alone.

## Gates and closeout

Expected: `./boga test fast`, `backend` (including `groups-competitions` and
`groups-api-live`), `jest-coverage`, `complexity`, `dependencies`. Run the
applicable `ios-groups-e2e` default unless the reviewer agrees a documented
`covered-by-jest` lowering for untouched device paths. Add `ios-sync-e2e` if
the actual diff changes sync/boot paths or their wiring.

Agree the final set from `./boga test for`. Run independent code, security and
product review; delete this card and mark T03 completed. This PR neither
changes existing all-time boards nor closes #927.
