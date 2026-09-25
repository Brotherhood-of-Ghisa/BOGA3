---
task_id: M27-T12-Verify_roll_out_and_close_bodyweight_milestone
milestone_id: M27
status: planned
ui_impact: "yes"
areas: "cross-stack"
runtimes: "node|expo|maestro|supabase|deno|sql"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test frontend; ./boga test mcp-smoke"
docs_touched: "docs/specs/00-product.md, docs/specs/03-technical-architecture.md, docs/specs/05-data-model.md, docs/specs/06-testing-strategy.md, docs/specs/tech/bodyweight-load-contract.md, docs/specs/tech/sync-v2-server-contract.md, docs/specs/tech/groups-contract.md, docs/specs/ui/README.md, RUNBOOK.md"
---

# M27-T12 — Verify, roll out and close the bodyweight milestone

- Status: `planned`
- Depends on: M27-T01 through M27-T11.
- Milestone spec: `docs/plans/milestones/M27-bodyweight-load-and-group-comparisons.md`
- Governing decisions: all M27 decisions and milestone acceptance criteria.
- Owner of hosted/deployed smoke validation: this task, before client activation.

## Objective and scope

Prove the complete feature across app, sync, group evaluator and coaching API,
then perform the documented server-first rollout and graduate the plan.
Read AGENTS.md, specs 01/02/03/05/06/08/09/10/11/12, the bodyweight/sync/groups
contracts, UI policy/index, `README-maestro.md` and RUNBOOK. Refresh every task's
delivered PR evidence and current HEAD; read test-directory READMEs before edits.
This task supplements, never defers, each implementation task's required gates.

## Integration acceptance

1. Settings saves B=80 offline; a new session captures 80; a later reading of 82
   affects the next session only. Reopen, sign out, wipe/re-sign-in and restore
   both snapshots on another client without leaking across owners.
2. Backfill a session before the first reading → estimated earliest value;
   between readings → preceding value; already-filled session → unchanged.
   Preview cancellation, stale inputs, repeat apply and partial retry are safe.
3. Log unweighted, added and assisted pull-ups plus standard push-ups. Check
   volume, per-side muscle attribution, PRs, history, loading estimates and share
   preview against T03 vectors. Conventional lifts remain unchanged; missing B
   preserves counts but makes dependent metrics unavailable/incomplete.
4. Two members at different weights reverse order between relative and absolute
   boards; unweighted reps rank directly. A personal coefficient edit has no
   group effect. Two groups can apply different declared standards independently.
5. Certify a score with its B/provenance; correct the saved B → affected
   certification invalidated. Add a new current reading → old certification
   unchanged. Test rule revision rebuild, archived/former entries and no fake PRs.
6. Coaching API/MCP values match app values and expose incomplete/estimated
   context through the existing owner-scoped access boundary.
7. Upgrade a populated pre-feature database and exercise an older client writer.
   Verify populated new fields survive unrelated edits or enforce the specified
   minimum-client policy. Ambiguous historical entered loads are never guessed.

## UX Contract and evidence

Target: T01's accepted bodyweight brief and each UI task's reference states.

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Weight through workout lifecycle | Save reading → start/log/complete → save new reading → reopen old workout | Stable snapshots and consistent numbers | Missing/invalid/offline paths remain usable |
| Historical correction through group score | Preview backfill → apply → inspect board → certify → correct snapshot | Honest provenance and coherent ranking/certification transitions | Cancel/stale preview/failure never silently rewrites unrelated sessions |
| Compare rules and members | Link same personal exercise in two groups → inspect three boards | Each group's standard governs its own scores | Incompatible movement/rebuild/frozen history explained |

Recheck shared UI tokens/recipes and accessibility, then capture new rendered
happy, missing, estimated, offline and failure states at the target phone sizes.
Compare against targets and document material deviations in the PR. No new
visual style or raw-token exception is planned at closeout.

## Gates and rollout

- Run `./boga test for` on the delivered change set and `./boga test fast`,
  `./boga test backend`, `./boga test frontend`, `./boga test mcp-smoke` to green.
  Verify evidence includes `sync-infra`, `ios-sync-e2e`, `groups-leaderboards`
  and `ios-groups-e2e`; do not substitute backend-only checks for device proof.
- Run `handles` if async lifecycle/teardown changed. Native iOS changes, if any,
  require the spec 02 rebuild before frontend. Run `./boga doctor` and repair
  bootstrap gaps if infrastructure fails. Quote durations only from measured
  `./boga timings` output.
- Prepare production migration, compatible API/evaluator deployment, backfill
  activation and client-release order; obey the session's deployment authority.
  No automatic historical weight mutation as part of deployment. Run the
  authorised deployed smoke before enabling the client feature; record exact
  versions, results and rollback/disable behaviour in RUNBOOK/PR evidence.
- List every lane in the PR Tests table with evidence or path-trigger N/A;
  validate via `./boga pr check --body <file>` before opening the PR.

## Closeout

Check that owning product/architecture/data/auth/sync/groups/UI specs describe
the shipped behaviour, not merely this plan. Update testing docs if coverage
or lane responsibilities changed (02/registry too if lane definitions changed).
Mark delivered task entries completed as their cards are deleted; then delete
this milestone and remaining shipped cards in the closing PR. Evidence remains
in those PRs and history. Follow AGENTS.md worktree/PR lifecycle to merge/release.
