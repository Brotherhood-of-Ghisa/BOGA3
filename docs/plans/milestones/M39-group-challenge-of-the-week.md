# M39 — Group Challenge of the Week

- Status: `planned`
- Created: 2026-10-27, planning baseline `e08bec5c897d0eefb697721a25fbcb5e7f339ceb` on `origin/main`
- Source: [Groups: CotW, issue #927](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/927)
- Execution: one task, session, local worktree and PR at a time, following `docs/plans/README.md`.

## Objective

A group owner or admin picks an exercise and one or more weekly challenges:
highest 1RM, greatest personal 1RM improvement %, and total Volume. Members
see a separate ranking for each selected metric, over the same shared week
and group exercise, using their normally logged and shared workouts.

## Scope

- In: weekly challenge definition and admin management, shared week boundaries,
  server-authorized rankings, the group's existing exercise links and scoring
  units, mobile discovery and results, and previous challenge reads.
- Out: combined scores or overall winners across metrics, prizes, automatic
  recurring creation, notifications, enrolment or manual result submission,
  new workout logging, a new certification system, and new sync entities.
- Planning default: one challenge definition per group/week, manually created
  for the current or next week; it can enable several independent metrics.
  T01 settles lifecycle and boundary details before code is written.

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

Prefer reads over existing coherent set projections; add a challenge-specific
projection/job only if T03 demonstrates why a bounded authorized read is
insufficient. Do not introduce another worker or cron merely to close a week.

### D6. Reuse the mobile group experience

Use `src/groups/api.ts` as the sole RPC caller, the existing cache/resource
and action hooks, group picker, rank rows, notices and UI primitives. Reads
follow existing refresh/offline behavior; admin writes require a connection.
T04 agrees a repo-native brief with reference screenshots, or another accepted
design target, before changing UI. The plan does not prescribe a new main tab.

## Decisions reserved for T01

Resolve these with the operator at that session's start, record the answer in
the owning fact/contract, and update later cards if the answer changes them:

1. One authoritative time zone per challenge: where it comes from, validation
   of a Monday–Sunday calendar week, and stored immutable UTC `[start, end)`
   bounds. All members must compete over identical instants, including DST.
   Existing group summaries use viewer-local weeks; reusing that window
   separately for each viewer would be incorrect here.
2. Session placement and eligibility: proposed default is completed sessions
   placed by `started_at`, matching current group period reads; whether new
   members and former members participate and how archival affects results.
3. Lifecycle: creating this/next week, edits before/after start, cancellation,
   overlap/concurrent creation, and whether an ended week remains correctable
   after late sync, source edits, deletions or link changes. Do not promise
   final winners until this rule is settled.
4. Improvement arithmetic and ordering: signed `(weekly / baseline - 1) × 100`,
   versus positive gains only; missing weekly results; ties and zero; a
   finite-result/overflow policy for the weekly sum and percentage.
5. Rules changes: how the challenge binds its comparison revision and what
   happens when that revision or disclosure changes. Never mix kg and %BW,
   count a set twice through links, or show stale absolute history. Decide
   whether certification is merely existing context or a ranking filter;
   the proposed minimum is one All ranking with no aggregate certification.

## Product changes to highlight

This plan changes no accepted runtime fact. The implementation introduces
weekly challenge rules affecting both server and mobile readers. T01 must
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
| [M39-T01](../tasks/M39-T01-Define_CotW_rules_and_scoring.md) | Settle weekly rules; shared pure scoring, vectors and owning facts/contract | none | planned |
| [M39-T02](../tasks/M39-T02-Add_CotW_lifecycle_and_authorization.md) | Server challenge definitions, authorized lifecycle RPCs and client write boundary | T01 | planned |
| [M39-T03](../tasks/M39-T03-Serve_CotW_rankings_and_history.md) | Weekly scores, improvement baselines, privacy-safe readers and mobile read boundary | T02 | planned |
| [M39-T04](../tasks/M39-T04-Deliver_CotW_mobile_flows.md) | Admin and member UI, integration evidence and issue closeout | T03 | planned |

The implementation PRs are sequential because each consumes the previous
contract. UI target exploration can happen during backend work after T01
settles the rules; it needs no separate implementation PR. Only T01 is ready
to start once the planning PR merges. Delete each card in its shipping PR;
delete this milestone with the last card. Evidence belongs in the PRs.

## Risks and completion

- Existing boards retain only a member's winning set; baseline/weekly reads
  need the complete eligible shared source, coherent with rules publication.
- Totals and baseline details extend the disclosure surface. Test paired
  endpoints and historical reads, including policy changes and missing B.
- Offline logs, late links and corrections require a stated result policy;
  they must not silently create a different contest for each device.
- Additive migrations only; no changes to personal records, sync protocol,
  stored workout values or existing board/certification history.
- Every code task adds behavior coverage and runs `./boga test fast`; every
  task runs the three quality-target lanes before its PR. Agree its final
  lane set with the reviewer using `./boga test for`; the card lists expected
  defaults. No thresholds or baselines are relaxed.
- Close #927 only when T04 proves admin creation through two-member results
  against local Supabase, all selected metrics, missing baseline, offline
  reads, authorization loss and applicable disclosure. Hosted deployment
  remains a separately authorized operation; local tests do not deploy it.
