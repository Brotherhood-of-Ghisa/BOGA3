---
task_id: M27-T09-Evaluate_group_scores_and_certify_bodyweight_sets
milestone_id: M27
status: in_progress
ui_impact: "no"
areas: "cross-stack"
runtimes: "node|deno|supabase|sql"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test ios-groups-e2e"
docs_touched: "docs/specs/03-technical-architecture.md, docs/specs/tech/groups-contract.md, docs/specs/tech/bodyweight-load-contract.md, docs/specs/06-testing-strategy.md"
---

# M27-T09 — Evaluate group scores and certify bodyweight sets

- Status: `in_progress`
- Depends on: M27-T06, M27-T08.
- Milestone spec: `docs/plans/milestones/M27-bodyweight-load-and-group-comparisons.md`
- Governing decisions: D7–D10.

## Objective and scope

Rank actual performances under each target group's rules and keep corrections,
recalculation and certification coherent. Read AGENTS.md, specs 02/03/05/09/10,
groups/bodyweight contracts and `supabase/README.md`. Refresh evaluator queue,
facts, SQL apply and fingerprint paths; read test-directory READMEs.

## Deliverables and acceptance

1. Carry group-independent performance facts (entered amount/mode, reps,
   performed state and session B/provenance) into target-specific scoring.
   Resolve effective load using the target group's coefficient, not personal
   coefficient or a precomputed personal 1RM. Reuse T03's TS mathematics.
2. Materialize best-per-member entries for all three boards with eligibility,
   correct units, deterministic ties and Certified/All scope. Reps requires
   unassisted zero external load but no B; strength requires valid B. Do not
   let assistance sets count as unweighted reps. Conventional boards regress cleanly.
3. Body-weight corrections/backfill, load-mode/amount edits, deletes/undeletes,
   links, rule changes and membership changes enqueue the appropriate work.
   Personal coefficient changes cannot rescore a group performance.
4. Rebuild and publish a rule revision coherently using T08's frozen-entry
   policy. Identify rules changes separately; do not generate performed-record
   cards from them. Preserve old historic event meanings and existing valid
   link/void/provisional-record behaviour.
5. Pin the inputs the certified metrics depend on, including B/provenance for
   strength and actual external mode. Corrections invalidate affected
   attestations; new weigh-ins and rule-only edits do not falsify the old raw
   performance. No automatic migration of an unpinned B into a certified score.
6. Group stream/friend session calculations use shared effective-load semantics
   and explicit scope: linked group comparisons use group rules; personal/as-
   logged summaries are labelled as such and cannot be passed off as board scores.
7. Preserve failure isolation, generation guards, retries, locks and cache
   refresh behaviour. A broken group evaluation never aborts personal sync.

## Verification and closeout

Use real backend vectors for two members, two different groups linked to one
personal exercise, all metrics/scopes, no B and estimated B, personal coefficient
edits, B corrections, rule rebuilding, archived/former entries, link/unlink,
provisional/final records and certification edits/deletions/re-certification.
Assert the 60+20 versus 90+20 equal-rep ranking reversal and stable historic
scores after a new weigh-in. Inject queue/evaluator failures as existing lanes do.

Run `./boga test fast`, `./boga test backend` (including `groups-leaderboards`
and `sync-infra`) and `./boga test ios-groups-e2e`; resolve additional lanes
with `./boga test for`. T12 owns deployed Edge Function smoke/rollout.
Graduate evaluator/certification rules, attach evidence, mark the milestone
entry complete and delete this card when shipped.

## Execution checkpoint (2026-09-27)

The shared target-specific scorer and full-graph score adapter are integrated. Tests cover the two-member ranking reversal, group coefficient/distribution authority, assistance, missing/invalid B, dependency-pin propagation and unlinked observations. Database queue/publication, event reconciliation, certification and group readers remain pending.

Full fast and backend gates passed at `19fc54d`: 181 mobile suites / 2,150
mobile tests, all backend contracts, 6 real-sync suites / 15 tests and real
OAuth/MCP smoke. Logs: `/tmp/boga-m27-group-score-verified-fast.log` and
`/tmp/boga-m27-group-score-verified-backend.log`. `./boga timings` and
`./boga test for` ran. Device gates remain in progress. No new server RPC,
publisher, certification behavior or group UI is claimed shipped.


### Integrated backend checkpoint (2026-09-27)

The migration, Deno evaluator, atomic versioned publication, legacy compatibility,
metric-specific certification, readers and client decoders are integrated.
`./boga test backend` passed in full with the expanded `groups-bodyweight.sh`
body, including actual SQL responses decoded by the mobile guards, paged mixed
streams, UTF-16 validation, role/privacy checks, generation/lease fencing,
rollback/retry, legacy activation, archived/former entries and correction pins.
Evidence: `/tmp/boga-m27-group-integration-backend-3.log`.
The earlier fast run passed before UI integration; the later full fast gate
passed with 184 mobile suites / 2,214 tests at this working checkpoint:
`/tmp/boga-m27-comparison-ui-fast-2.log`. Timings and trigger rules ran.

T10 native rendering and new two-user device
proof remain in progress. Hosted rollout and final frontend acceptance are
pending; neither task is shipped.
