# M39 — Group Challenge of the Week (CoW)

- Status: `planned`
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
under concurrent admin writes, including across zone changes. One current
CoW and one next CoW may coexist; past CoWs remain history.

### D8. Final results are stored

Confirmed by the operator: ended CoWs are final and stored. Persist the
rankings, selected metrics, score units and scoring context needed to read
the outcome without recalculating it from mutable workouts. Subsequent source
edits, deletion, linking or scoring changes never rerank a finalized CoW.
Current access/disclosure still applies to history; suppress unsafe figures
without recalculating or promoting a different winner. Distinguish finalizing
from final: never publish an incomplete evaluator pass as the final outcome.

Proposed implementation rule, still to confirm in T01: no grace period;
only completed workouts and eligible source changes received before the end
count. Processing may finish later, but later arrivals cannot enter. This
means offline workouts synced after the deadline miss that CoW.

### D9. Simple participation

The operator delegated this choice: fix the participant roster at the start,
with automatic participation by every then-current member. Midweek joins or
rejoins wait for the next CoW. Leaving or removal ends further contributions
for that CoW; qualifying results already earned while a member stay in the
standings and final snapshot. Rejoining does not resume participation that
week. Former members lose group access under existing authorization.

## Decisions reserved for T01

Resolve these with the operator at that session's start, record the answer in
the owning fact/contract, and update later cards if the answer changes them:

1. Session placement: proposed default is completed sessions placed by
   `started_at`, matching existing group period reads. Settle sessions crossing
   a week or membership-end boundary, archival and late-arriving pre-week
   baseline data. D7's shared calendar and D9's roster are already settled;
   viewer-local group summaries cannot supply the CoW window.
2. Confirm the D8 no-grace/server-receipt cutoff and specify its source-version
   boundary, including completion, baseline, edits and link writes. Decide
   pre-start editing/cancellation and post-start cancellation; finality and
   next-week-only scheduling are already settled. A proposed minimum is edits
   before start only and explicit cancellation, never editing an active CoW.
3. Improvement arithmetic and ordering: signed `(weekly / baseline - 1) × 100`,
   versus positive gains only; missing weekly results; ties and zero; a
   finite-result/overflow policy for the weekly sum and percentage.
4. Rules changes: how the challenge binds its comparison revision and what
   happens when that revision or disclosure changes. Never mix kg and %BW,
   count a set twice through links, or show stale absolute history. Decide
   whether certification is merely existing context or a ranking filter;
   the proposed minimum is one All ranking with no aggregate certification.

## Product changes to highlight

This plan changes no accepted runtime fact. New planned product choices are
the group calendar, next-week-only scheduling, fixed participation and stored
finality (D7–D9), plus the D6 Today summary and Groups/group-page navigation;
deadline acceptance is explicitly still proposed. Group-entry and empty/error
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
| [M39-T01](../tasks/M39-T01-Define_CotW_rules_and_scoring.md) | Finish unresolved rules; shared scoring, cutoff vectors and owning facts/contract | none | planned |
| [M39-T02](../tasks/M39-T02-Add_CotW_lifecycle_and_authorization.md) | Group calendar, scheduling, roster and snapshot lifecycle storage; authorized RPCs | T01 | planned |
| [M39-T03](../tasks/M39-T03-Serve_CotW_rankings_and_history.md) | Live rankings, automatic finalization, stored final results and safe history | T02 | planned |
| [M39-T04](../tasks/M39-T04-Deliver_CotW_mobile_flows.md) | Reviewed UX target, scheduling/results UI, integration evidence and issue closeout | T03 | planned |

The implementation PRs are sequential because each consumes the previous
contract. Review the attached UX brief now; add visual references and settle
the remaining rule-dependent states before UI implementation. Design work
needs no separate implementation PR. Only T01 is ready
to start once the planning PR merges. Delete each card in its shipping PR;
delete this milestone, its UX brief and attached mockups with the last card.
Evidence belongs in the PRs.

## Risks and completion

- Existing boards retain only a member's winning set; baseline/weekly reads
  need the complete eligible shared source, coherent with rules publication.
- Totals and baseline details extend the disclosure surface. Test paired
  endpoints and historical reads, including policy changes and missing B.
- Automatic finalization needs an authoritative cutoff, coherent source
  versions and retry-safe snapshot publication. A worker delay or a later
  source deletion must not produce a different final outcome. Confirm the
  proposed strict sync deadline before implementing it.
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
