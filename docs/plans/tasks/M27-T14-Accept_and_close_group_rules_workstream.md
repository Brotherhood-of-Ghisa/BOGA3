# M27-T14 — Human acceptance and group workstream closeout

- Status: `in_progress`
- Depends on: existing #411 task (completed), T13 (completed), T15 (completed; milestone D4), T08 (completed), T09 (completed), T10 (completed)
- Milestone: [M27 — Bodyweight load and group comparisons](../milestones/M27-bodyweight-load-and-group-comparisons.md)
- Workstream: [#420](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/420)
- Areas: cross-stack; UI impact: yes

## Objective

Verify and close the consolidated group percentage/privacy/certification work.
This task replaces the original T12 closeout for #420; it does not restore the
old snapshot/backfill/three-board acceptance criteria. Earlier implementation
PRs still run their agreed gates before opening; this is the combined final pass.

## Human acceptance — before the combined aggregate pass

Use two actual group members with different private bodyweights. Record human
acceptance and captures against T10's accepted target for:

1. Conventional c=0 comparison across repeated legacy preference toggles: ready
   boards, history, certificate ID/audit metadata and scores remain unchanged.
2. Bodyweight comparison: Off ordinary Volume/1RM, On accepted %BW 1RM and
   chosen Volume policy, expected rank and both scopes. Verify safe enabled
   record/stream/history/full-session routes and explain D5's inference limit.
3. Rules/contribution/source/target-mode edits: coherent recalculation with the
   same certificate witness/time and eligible Certified score; no fake PR.
4. Missing/ineligible score: no private-reading disclosure, active certificate
   retained after rules-only ineligibility, correct return when eligible.
5. Set edit/delete, witness withdrawal, owner/admin cancellation and D4's
   correction decision: dependent projection ends, raw legacy witness remains,
   restore does not reopen ended rows, and public copy hides private causes.
6. Offline, old cache, old client, failed/stale write, archived/former member
   and account-switch paths: safe units/privacy and no misleading success.

A human must exercise and accept these flows before the combined aggregate
closeout suite runs. Screenshot review and automated assertions do not replace
that acceptance. Resolve rejected behavior before repeating the final pass.

## Automated acceptance

Verify the merged implementation PR evidence, then run one combined agreed
closeout pass on the finished integration. Expected proposal: `fast`, `backend`
(including groups-leaderboards and groups-api-live), `frontend-ui` and
`ios-groups-e2e`. Add `ios-sync-e2e` only if actual sync/auth changes justify it;
use `./boga test for` for the delivered diff. Run required quality targets
before the closeout PR. New Maestro flow/scenario work still needs a reason
why Jest cannot prove it and operator approval first.

Check real RPC payload privacy (including legacy/history/session totals), exact
certificate IDs/audit fields, normalized numeric vectors, stale publication
fences/failure isolation and conventional/private kg regressions. Inspect test
results and rendered captures; never reuse September logs as acceptance for
this change. Read test READMEs before any integration regression-test edits.

## Activation and completion

1. Verify T08's old-client/cache policy and documented server/evaluator/client
   order. Hosted writes require explicit deployment authority in the execution
   session. A release build additionally requires the repository full sweep.
2. Run authorized deployed smoke when a target/channel is confirmed; record
   actual versions and evidence. If deployment is not authorized, keep activation
   explicitly pending rather than claiming the milestone shipped.
3. Check that owning group/metric/data/architecture/auth/UI specs describe the
   shipped decisions and that workstream #420/#411/#419 tracking agrees.
4. Link final human and automated evidence in the PR. Delete this card and the
   milestone only after every active acceptance requirement is satisfied and
   activation/remaining original-card lifecycle is honestly resolved. Do not
   delete unrelated original personal task cards without their own evidence or
   explicit decision to abandon that scope.
5. After PR merge, follow `./boga worktree release` for this session's worktree
   and stack. Do not merge the PR without the human's instruction.

## Current execution evidence (2026-10-05)

The operator confirmed in the execution session: “The member flows are accepted.”
This accepts the six flows above; T10 runtime captures remain linked from PR #521.
The operator named hosted `boga-dev` (connected project `BOGA_DEV`,
`onluhhnvvmknqzdxgntl`) in response to the deployment request.
The operator confirmed `boga-dev` is linked to the prod build, then directed
local database testing and Preview/TestFlight first. Hosted writes and activation
are on hold; none have been performed. Combined local closeout gates and the
preview release sweep are in progress. Do not claim hosted completion.

Fresh local backend and fast aggregates passed. The persistent `BOGA-dev` local
database is activated on protocol 4 and Metro serves its LAN endpoint. An
activated database exposed the development group seeder's missing protocol
header; the header and a fetch-level Jest assertion now cover that path.
The initial release sweep exposed the live competition test's 90-second poll
being shorter than the configured five-minute sweep for rules-only rebuilds.
The poll now allows one full interval plus processing; its corrected lane
passed without weakening assertions. Fast passed 230 suites / 3043 tests;
coverage passed with 85.35% branches and 93.25% lines; complexity and dependency
checks passed. The independent review reported no findings. Preview delivery
still requires completion of the release sweep and the actual build/submission.
