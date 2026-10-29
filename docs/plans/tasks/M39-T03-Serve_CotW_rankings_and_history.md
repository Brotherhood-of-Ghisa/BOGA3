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

Milestone D1–D5, D7–D10 and the merged T01 contract. Never use the lifetime winning
board row as the weekly source. Sum eligible per-set Volume once per set.
The improvement denominator is group-shared and strictly pre-week; missing
baseline excludes only that metric. Preserve normalized disclosure across
definition, current results, history and linked session reads.
Freeze the baseline's eligible pre-start versions. Signed improvement includes
zero and negatives, descending; completed sessions are placed by start time.
Equal unrounded scores prefer the earlier current-score submission accepted by
the server, then UUID, never client/performed/worker time or shared places.

## Open — resolve at session start

Load `docs/specs/tech/group-cow-contract.md` and consume `scoreCoW` from
`apps/mobile/src/groups/cow-scoring.ts`. Resolve authorized, complete intake
versions under the pinned context; its pure tests do not establish actual
transaction, authorization, scheduling or durable-finality guarantees.

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
   Resolve the latest accepted state at each cutoff, including removed or
   ineligible sources; never choose an older version merely because it qualified.
2. Reuse the pure T01 boundary / existing scorer, retaining precision. Return
   metric-specific ordinal rank, unit and missing/unavailable state. Carry
   D10's winning-set/aggregate acceptance priority independently of worker
   publication, including scoring-input revisions, removals and identical retries.
   Deterministic ties and overflow follow D10/T01. Missing source/baseline never
   produces a fabricated percentage. Zero attained 1RM/Volume never ranks;
   genuine 0% and negative improvements rank when their inputs qualify.
3. Apply current authorization/disclosure on every current/history read,
   even for saved or archived rules. Reject OAuth and outsiders; never expose
   private B, its provenance, digests, or suppressed absolute counterparts.
   Test totals and baseline-plus-other-endpoint joins, not only field names.
4. Add exact guards, API methods and account/group/week/revision-bound cache
   keys through the existing group modules. Do not cache full result pages
   where the existing online-paged pattern suffices. Evict incompatible new
   payload generations and drop stale account/group responses. Provide the
   compact CoW summary Today consumes, including up to three ordered
   public rank rows per enabled metric with explicit units and coherent scoring
   context. This bounded podium payload can use the summary cache; full result
   pages remain online. Select the current group-week CoW when it exists,
   including when it has no scores; otherwise exactly the prior group week's
   authorized stored final CoW, else explicit absence. Return the displayed
   CoW identity, actual dates and finality so the client can label the fallback
   Last week · Final and open the right detail. Preserve stored scores/units
   under current historical disclosure; never rescore finals. Never use older,
   upcoming, still-finalizing or terminal-unavailable outcomes as fallback;
   a current unavailable CoW still takes precedence. A valid empty
   final is distinct and can supply the dated fallback. Re-evaluate week-bound selection and
   cache identity at rollover. Never derive Today ranks from local logs.
5. Extend the existing group backend and real-client API suites with at least
   two members, several sessions, pre-week and boundary sets, several selected
   metrics, missing baseline/reading, ordinary and normalized exercises, and
   source/revision/role races. Prove receipt-based tie order is unchanged by
   worker delay/coalescing, including revised inputs with equal scores, removed
   Volume contributions, identical retries and equal-time UUID fallback.
   Prove Today top-three order/units independently
   for each enabled metric, including fewer entries and no improvement baseline.
   Cover current/no-scores precedence, last-week-final fallback, absent/non-final
   previous week, older/upcoming exclusion, permissions, and group-zone rollover.
   Run real responses through the mobile guards.
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
7. Use the context bound at start for baseline and weekly aggregation. An
   in-week scoring revision/version change or archive makes that CoW's rankings
   unavailable, with an unavailable stored final outcome at end; no migration
   to another scorer or mixed units. Failed processing remains retryable
   Finalizing, distinct from this terminal context failure. Previously final
   outcomes remain immutable under current disclosure. Decide failure from
   context changes accepted during the week: a post-cutoff change must not
   invalidate timely results merely because finalization is delayed. Test both
   sides of that boundary and terminal-unavailable versus valid-empty fallback.

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
