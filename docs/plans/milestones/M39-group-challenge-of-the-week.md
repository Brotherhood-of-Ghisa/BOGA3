# M39 — Group Challenge of the Week (CoW)

- Status: `in progress`
- Created: 2026-10-27, planning baseline `e08bec5c897d0eefb697721a25fbcb5e7f339ceb` on `origin/main`
- Source: [Groups: weekly challenge, issue #927](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/927)
- Execution: one task, session, local worktree and PR at a time, following `docs/plans/README.md`.

## Objective

A group owner or admin picks an exercise and one or more weekly challenges:
highest 1RM, greatest personal 1RM improvement %, and total Volume. Members
see a separate ranking for each selected metric, over the same shared week
and group exercise, using their normally logged and shared workouts.

## Scope

- In: weekly challenge definition and admin management, the group time zone,
  shared week boundaries, server-authorized rankings, the group's existing
  exercise links and scoring units, automatic finalization and stored final
  results, mobile discovery, scheduling and previous challenge reads.
- Out: combined scores or overall winners across metrics, prizes, automatic
  recurring creation, notifications, enrolment or manual result submission,
  new workout logging, a new certification system, and new sync entities.
- Agreed: manually schedule next week only; never create an already-started
  CoW. One published CoW per group/week, with several independent metrics.
  Use the name CoW throughout the feature; existing task filenames are kept
  stable.

## Agreed design direction

### D1. One exercise, independent rankings

Confirmed by the operator during planning: one group exercise per challenge;
one or more selected metrics; a separate ranking per metric. There is no
weighted blend, points conversion or implicit overall winner. The exercise is
an existing group comparison identity, not a personal exercise name.

### D2. Improvement uses the pre-week shared best

Confirmed by the operator: compare the member's best qualifying 1RM in the
challenge week with their best qualifying **group-shared** 1RM strictly before
the challenge week. Members without a positive baseline are unranked for this
metric; their other rankings remain available. Private unshared history must
not supply the baseline. This is a lifetime baseline, not a Settings period.
MVP choice under the operator's delegation: freeze it at week start, using
completed pre-week sessions and eligible shared/link/source versions accepted
before that start. Late historical uploads or corrections wait for later
CoWs; they cannot move this week's denominator. Resolve the latest accepted
pre-start state of each dependency first, including tombstones/ineligibility;
never resurrect an older qualifying version to fill the baseline.

Confirmed by the operator: improvement is signed `(weekly / baseline - 1) ×
100`, ordered descending. Negative and zero improvements rank normally when
both positive qualifying 1RM values exist: −2% beats −5%. Missing weekly
results or a nonpositive/missing baseline remain unranked, never invented 0%.

### D3. Follow the group's units and disclosure

Confirmed by the operator: use the group's current scoring units, including
%BW for enabled bodyweight comparisons. The issue's "absolute 1RM" therefore
means the attained 1RM value, as distinct from its improvement %, rather than
a promise to publish kg for every exercise. Labels must make those two
percentages distinguishable. No challenge endpoint or cached history may
reveal an absolute counterpart that existing group disclosure suppresses.

### D4. Reuse the group scoring boundary

Use `apps/mobile/src/groups/competition-score.ts` and the shared calculation
kernel. New challenge arithmetic only selects a weekly best, sums eligible
set volumes, and compares the best with its baseline. Total Volume is a sum
over the week, **not** the current board's best single-set Volume. Work from
authorized shared source sets / coherent published per-set scores, never the
lifetime winning board row or the viewer's local database.

Keep the existing ordinary/normalized distinction, source-to-target load
conversion, full-precision values, and fixed group effort policy
([[set.performed]], [[set.eligibility]], [[1rm.formula]]). No new formula or
personal preference can change a group's result.

### D5. Extend the server group domain

Challenge definitions belong to the server-only group domain. Preserve its
role checks, OAuth denial, no direct table access, request-local protocol-4
header, non-member/nonexistent equivalence, isolated sync triggers, and exact
public allowlists. New group tables have neither `owner_user_id` nor an FK
into Sync v2. Existing RPC payloads must remain compatible with old clients.

Reuse coherent set projections and the existing backend evaluation/scheduling
machinery. Final results require durable snapshots and automatic closure even
when nobody opens the app. T02 owns lifecycle storage and concurrency; T03
owns finalization, retry and publication. Preserve the deadline's eligible
source versions despite later writes or evaluator lag; a live query after the
deadline cannot prove that. Choose the smallest design that meets this
contract, without another service or copies of private workout graphs.

### D6. Reuse the mobile group experience

Use `src/groups/api.ts` as the sole RPC caller, the existing cache/resource
and action hooks, group picker, rank rows, notices and UI primitives. Reads
follow existing refresh/offline behavior; admin writes require a connection.
The [CoW UX brief](../M39-cow-ux.md) is attached to this milestone and
T04. The operator clarified: the detailed browser is reached from Groups;
Today / Groups gets a separate compact card showing this week's CoW when one
exists, else exactly last week's stored final CoW, clearly labelled Last week ·
Final with its dates; hide the card if neither is available. It is
a top-three preview with in-card switching across enabled metric leaderboards;
its header opens the detailed view. It has no upcoming/history rows or scheduling controls; the
previous At a glance summary placement was a misunderstanding. Admins schedule
via the individual group page's View CoWs link into the secondary browser's
management actions and creation/editing form. The operator selected the
chronological browser (This week / Next week / Past CoWs) with the exercise
and status left, dates/zone right, preserving the mockup's formatting. Both
attached browser and Today-card mockups and the last-week-final fallback are
approved. A current CoW takes priority even without scores; no older-week,
upcoming or non-final fallback. The individual group page
must show at least Today's current-CoW information: exercise, dates/status,
top three and in-card metric browsing, plus a link to view/manage CoWs on the
successive page. The revised group preview is approved, with View CoWs versus
View/Edit CoWs copy left for later. Scheduling option 1 is selected as the
compact base; its searchable group-exercise sheet is approved. Empty/error
targets still await review.
It includes offline, uncertain-publication and access-loss recovery. No new main tab.

### D7. Shared calendar and scheduling

Confirmed by the operator on 2026-10-29: use the group's time zone, defaulting
to its creator's time zone. Schedule next week only, before that week starts;
there is no midweek creation or queue of later weeks. Store a validated IANA
zone and immutable UTC Monday-to-Monday `[start, end)` bounds per published
CoW, respecting DST. Later group-zone changes cannot move published CoWs.
Prevent duplicate group/week definitions and overlapping published windows
under concurrent admin writes, including across zone changes. A pre-start
cancellation releases the next-week slot; keep its audit and allow a replacement,
with only one non-cancelled published definition occupying that slot. One current
CoW and one next CoW may coexist; past CoWs remain history.

### D8. Final results are stored

Confirmed by the operator: ended CoWs are final and stored. Persist the
rankings, selected metrics, score units and scoring context needed to read
the outcome without recalculating it from mutable workouts. Subsequent source
edits, deletion, linking or scoring changes never rerank a finalized CoW.
Current access/disclosure still applies to history; suppress unsafe figures
without recalculating or promoting a different winner. Distinguish finalizing
from final: never publish an incomplete evaluator pass as the final outcome.

Confirmed by the operator: a valid submission must sync within the time limits.
For the MVP, the server must accept the completed session and every dependency
needed for its eligible contribution before the exclusive end. No grace
period, client-clock exception or late offline submission. The last accepted
pre-cutoff state remains authoritative if another correction arrives afterwards.
Processing may finish later; evaluator time cannot change eligibility or tie
priority. A rolled-back/rejected write is not a submission. D10 defines the
weekly and membership boundaries; D2 freezes the baseline separately.

### D9. Simple participation

The operator delegated this choice: fix the participant roster at the start,
with automatic participation by every then-current member. Midweek joins or
rejoins wait for the next CoW. Leaving or removal ends further contributions
for that CoW; qualifying results already earned while a member stay in the
standings and final snapshot. Rejoining does not resume participation that
week. Former members lose group access under existing authorization.

### D10. Minimal submission, ordering and lifecycle rules

The operator confirmed timely sync, earlier-submission tie priority and signed
improvement, and delegated the easiest remaining MVP choices. Use these defaults:

| Area | MVP rule |
| --- | --- |
| Session placement | Completed sessions belong wholly to the week containing `started_at`; no splitting sets across weeks. A session started before the week cannot enter it by finishing later. One started this week but completed/synced after the end misses that CoW. |
| Membership cutoff | A qualifying weekly submission must be accepted in `[start, min(end, membership_end))` for a member on D9's starting roster. Completion and all required eligible data must arrive while that membership is active. Leaving freezes previously accepted contributions; later sync or rejoin cannot add to them. |
| Live corrections | Accepted edits, deletion/restoration and link changes can change live results until the member/week cutoff. Retain the latest accepted state before that cutoff, including tombstones, ineligibility and removals; never resurrect an older qualifying version. Later corrections never rewrite it. Deduplicate each member's source set across links. |
| Equal scores | Sort full-precision score descending, then authoritative submission time ascending, then member UUID for an identical time. Unique ordinal places; no shared ranks. For 1RM/improvement, use the earliest receipt of a currently qualifying winning set version. For Volume, use the latest receipt that adds, revises or removes a counting contribution to the current total. Include the time completion/link dependencies make the contribution eligible. Scoring-input edits are revised submissions, even if the displayed value stays equal; identical retries and unrelated writes do not reset priority. Never use client logging or worker time. |
| Edit/cancel | Owners/admins may change exercise/metrics or cancel before start only. No editing or cancellation of active or ended CoWs. Cancel confirms, releases the next-week slot and retains audit. |
| Scoring context | Bind one coherent comparison revision, scorer version and unit context at start, for baseline and weekly scores. A scoring-context change or comparison archive during that CoW makes its rankings unavailable; do not migrate, rescore or mix contexts. Store an unavailable final outcome at end. Before start, use the context current at start; if no eligible comparison exists then, the outcome is unavailable. |
| Certification | One All ranking per selected metric. Existing set certification is context only, never an eligibility filter or weekly certification action. |
| Invalid numbers | Use finite unrounded scores. Genuine 0% improvement is valid; nonpositive attained 1RM/Volume is unranked. Overflow/non-finite totals or percentages make only that member's affected metric unavailable; no clamping, partial total or fake zero. |

Current privacy/disclosure still applies immediately, including when a context
change makes results unavailable. Previously finalized snapshots keep D8's
original outcome and current safe disclosure, never a new rules-driven result.
A stored unavailable final is not a Today fallback podium: hide the card if
no current CoW exists, while retaining that outcome in the browser. A valid
final with zero qualifying results remains eligible for the dated fallback.

## T01 implementation handoff

These MVP product questions are settled; T01 formalizes D1–D5 and D7–D10 in
the owning facts/contract and executable vectors. Choose implementation details
autonomously within those rules. Define the coherent server-acceptance point
for completion, source/link versions and score changes: starting a sync request
or transaction before cutoff is insufficient. Do not blindly use a transaction-
start timestamp as proof that all required writes arrived in time.

Preserve receipt ordering and versions through evaluator backlog/coalescing,
including identical retries, scoring-input edits and removed contributions.
T02 must provide the intake/context/priority storage T03 needs, without new
sync entities, private workout graph copies or a historical scoring framework.

## Product changes to highlight

This plan changes no accepted runtime fact. New planned product choices are
the group calendar, next-week-only scheduling, fixed participation and stored
finality (D7–D9), signed improvement and frozen baseline (D2), D10's receipt-
ordered ties, boundaries, lifecycle and context-change outcome, plus D6's
Today summary and Groups/group-page navigation. Group-entry and empty/error
handling are proposed design extensions, not shipped behavior. The
implementation introduces weekly rules affecting server and mobile readers. T01 must
apply `docs/procedures/product-facts-authoring.md` and record qualifying
cross-surface decisions in `docs/product/groups.md`; extend its index trigger
beyond certification. Baseline scope, participation, correction/finality,
window and metric meanings must each have one owner, with executable tests
for arithmetic. Cite existing facts instead of restating them.

Preserve [[groups.certification]]: a witness attests one set, never a weekly
total or an improvement denominator. Keep [[comparison.allowed-periods]];
document the authoritative shared competition week explicitly if it needs an
exception to the viewer-local presentation in [[comparison.window]].

## Task breakdown

| Task | Summary | Depends on | Status |
| --- | --- | --- | --- |
| M39-T01 | Formalize MVP rules; shared scoring, cutoff/tie vectors and owning facts/contract | none | completed |
| M39-T02 | Group calendar, scheduling, roster and snapshot lifecycle storage; authorized RPCs | T01 | completed |
| M39-T03 | Live rankings, automatic finalization, stored final results and safe history | T02 | completed |
| [M39-T04](../tasks/M39-T04-Deliver_CotW_mobile_flows.md) | Reviewed UX target, scheduling/results UI, integration evidence and issue closeout | T03 | planned |

The implementation PRs are sequential because each consumes the previous
contract. Review the attached UX brief now; add visual references and settle
the remaining rule-dependent states before UI implementation. Design work
needs no separate implementation PR. T01 defines the durable
`docs/specs/tech/group-cow-contract.md` and pure `cow-scoring.ts` boundary;
T02 supplies the server lifecycle/intake and typed definition API;
T03 supplies publication and result readers; T04 is ready after its PR merges. Delete each card in its shipping PR;
delete this milestone, its UX brief and attached mockups with the last card.
Evidence belongs in the PRs.

## Risks and completion

- Existing boards retain only a member's winning set; baseline/weekly reads
  need the complete eligible shared source, coherent with rules publication.
- Totals and baseline details extend the disclosure surface. Test paired
  endpoints and historical reads, including policy changes and missing B.
- Automatic finalization needs an authoritative cutoff, coherent source
  versions and retry-safe snapshot publication. A worker delay or a later
  source deletion must not produce a different final outcome. Implement the
  agreed strict sync deadline and receipt-based tie priority, never worker timing.
- Additive migrations only; no changes to personal records, sync protocol,
  stored workout values or existing board/certification history.
- Every code task adds behavior coverage and runs `./boga test fast`; every
  task runs the three quality-target lanes before its PR. Agree its final
  lane set with the reviewer using `./boga test for`; the card lists expected
  defaults. No thresholds or baselines are relaxed.
- Close #927 only when T04 proves admin creation through two-member results
  against local Supabase, all selected metrics, missing baseline, offline
  reads, scheduled start, automatic finalization without an app read, frozen
  history after source changes, authorization loss and applicable disclosure. Hosted deployment
  remains a separately authorized operation; local tests do not deploy it.
