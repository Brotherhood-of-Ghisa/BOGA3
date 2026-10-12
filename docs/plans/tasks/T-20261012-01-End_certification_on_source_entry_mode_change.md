# T-20261012-01 — End certification on source entry-mode change

- Status: `planned`
- Depends on: T-20261011-02 — Total load and group entry modes; merge it first
- Milestone: none
- Areas: cross-stack; UI impact: certification state and calculated figures

## Objective

Treat changing a member exercise's per-side/total entry mode as a correction to
the meaning of its logged performance. Personal calculations still recalculate
historically, but certifications of affected sets must end and require a new
witness. Preserve logged values and immutable certification history.

## Scope

- In: source-mode writes through sync, server witness lifecycle and observation
  checks, coherent group publication, existing client certification consumers,
  migration/refresh paths, tests and owning product facts/contracts.
- Out: the total-load formula, logged/planned weight conversion, new controls or
  confirmation dialogs, new certification states, unrelated record rules,
  changes to bodyweight correction policy, and hosted deployment.
- This is a separate follow-up. Do not fold it into the total-load implementation
  or execute it on that worktree. Start from latest origin/main after its
  dependency merges, following the task protocol in `docs/plans/README.md`.

## Requested rule

The operator requested this boundary on 2026-10-12: changing the member/source
exercise's entry mode should invalidate certification because it retrospectively
changes what the logged weight means. For example, 10 kg per side represents
20 kg total; the same stored 10 kg in total mode represents 10 kg total.

- An actual source-mode change ends the whole set witness on both Certified
  boards in every affected group. Preserve its ID, witness, timestamp, original
  observed values/revision and performance snapshot; append terminal metadata.
- Switching back does not revive an ended witness. Another eligible member must
  certify the current performance afresh.
- A group target-mode change changes presentation/comparison units and preserves
  the witness. Kernel/formula upgrades also preserve unchanged witnessed inputs.
- Member private bodyweight switches/contributions remain separate from group
  rules and do not end certification. Keep existing reading-correction behavior.
- A no-op source-mode write does not end certification. Apply the source-mode
  boundary even when a particular score happens to remain numerically equal.
- All/personal figures continue to use the current source mode. No stored weight,
  rep count, set count or original audit is rewritten to compensate.

## Design questions — resolve with the operator before implementation

1. Existing active certifications may have survived source-mode changes under
   the old policy. Agree whether a known historical mode mismatch is ended at
   rollout or existing witnesses are grandfathered with a separate current-mode
   binding. Never silently rewrite the original observation or mass-end valid
   witnesses merely because the pin representation changes.
2. Pin the timing: the recommended boundary is a server-committed source-mode
   change, including changes on archived comparisons and departed members'
   sources. A server-observed change followed by a change back must stay terminal
   even if the evaluator has not drained. Unsynced local toggles that cancel out
   before reaching the server cannot be inferred as two observed changes.

## Deliverables and acceptance

1. Load `AGENTS.md`, all `docs/product/` facts and the area contracts below.
   Check the dependency's final merged behavior and revisions against main.
   Update [[groups.certification]] to own the agreed source-mode boundary; audit
   persistent docs for contradictory policy using `docs/product/REVIEW.md`.
2. Trace source exercise writes, certification observation pins, certify conflict
   checks, projection ending, queued evaluation and every affected group. Reuse
   the existing whole-witness ending path. Keep stale certify tokens rejected;
   neither an old token nor re-certifying one projection may bless the old mode.
3. Add a migration rather than editing applied migrations. Make the boundary
   authoritative server-side, not dependent on the client noticing a changed
   score. Cover delayed/coalesced evaluation and the agreed inactive-source
   behavior without breaking the sync failure-isolation contract. Readers must
   never treat an ended witness as Certified while a rebuild is pending.
4. Publish current All scores and remove ended witnesses from Certified boards
   coherently. Session records, record sheets, certification detail, caches and
   mounted resources must converge through existing refresh paths. Preserve
   generic terminal copy, current authorization, bodyweight non-disclosure and
   historical record/certification audits. Do not introduce new public wire
   fields unless essential and agreed at design.
5. Read each test directory's README before edits. Update the existing source
   distribution regression in `supabase/tests/groups-competitions.sh`, which
   currently asserts that the witness survives. Prove both directions, both
   metrics, ordinary and normalized rules, equal-score cases, no-op writes,
   fresh certification, switching back, queued/coalesced writes, unrelated users
   and exercises, multiple linked groups, and the agreed archived/former-member
   lifecycle. Verify exact immutable audits separately from terminal fields.
6. Retain regression coverage that group target-mode changes, formula upgrades,
   private preference/contribution changes and unrelated reading changes
   preserve witnesses. Cover applicable reading corrections under their existing
   policy. Add Jest coverage for affected client state/decoding/refresh behavior
   and backend coverage for authoritative termination and migration semantics;
   do not add artificial client logic solely to make a Jest test possible.
7. Follow `docs/procedures/rule-upgrade.md` for any affected revisions, disposable
   caches and derived refresh. Agree rollout order and populated-database
   migration tests; an upgrade must not resurrect ended witnesses or let an old
   evaluator restore their Certified entries. No hosted writes in this task
   without separate operator authority.

## Contracts and implementation entry points

When implementing this certification boundary, load:

- `docs/specs/tech/group-competition-contract.md` — witness migration/corrections,
  public privacy boundary and publication.
- `docs/specs/tech/groups-contract.md` — server lifecycle, queue failure isolation
  and client refresh; reconcile source-mode preservation language.
- `docs/specs/tech/bodyweight-load-contract.md` — source versus target modes,
  observation/dependency pins and retained reading policy.
- `docs/specs/tech/training-metrics-contract.md` — current total-load meanings.
- `docs/specs/05-data-model.md`, `docs/specs/tech/sync-v2-server-contract.md` and
  `docs/specs/10-api-authn-authz-guidelines.md` — synced source edits and API guards.

Start tracing at `group_metric_observed_set_pin` and its callers in
`supabase/migrations/20261004204709_group_certification_observations.sql`, and
whole-witness propagation/certify guards in
`supabase/migrations/20261008160000_group_competition_set_certification.sql`.
Their current separation intentionally excludes source mode from the observed
set pin and preserves source-mode-only rescores; changing that policy needs more
than an arithmetic change. Re-check later migrations before choosing the patch.

## Gates and handoff

At implementation, run `./boga test for` on the actual diff and agree slower lanes
with the operator before running them. Propose `fast`, `backend` (including
`groups-api-live` and `groups-competitions`), `ios-groups-e2e`, and
`ios-sync-e2e` if the diff touches sync/refresh. Use existing device flows; adding
a Maestro scenario needs the justification and approval required by AGENTS.md.
Run `jest-coverage`, `complexity` and `dependencies` before the implementation PR,
plus independent code review, security/privacy review for server API changes,
and product-facts review. Evidence belongs in the PR; delete this card when its
implementation ships. Commit, push and open the implementation PR after agreed
gates pass; do not merge it yourself.

## Risk

A source-mode correction can end certifications across many historical sets and
groups. The rollout decision for existing mode mismatches must be explicit;
preserving audit history does not mean keeping an affected witness active.
