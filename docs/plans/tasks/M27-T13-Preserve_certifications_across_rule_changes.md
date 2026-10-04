# M27-T13 — Preserve certifications across rule changes

- Status: `planned`
- Depends on: none
- Milestone: [M27 — Bodyweight load and group comparisons](../milestones/M27-bodyweight-load-and-group-comparisons.md)
- Workstream: [#420](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/420)
- Issue: [#419 — Keep metric certifications active across group rule changes](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/419)
- Areas: backend; UI impact: yes (Certified boards and record state)

## Objective

Separate the witnessed performance from its calculated score. A rules-only
change may recalculate a board but must never end the certification of an
unchanged set. Implement milestone D9 without changing reading-correction policy.

## Scope

- In: a forward migration, evaluator/source-pin handling, certification RPCs,
  Certified board application, focused regression coverage and the owning specs.
- Out: percentage ranking implementation (T08/T09), a new witness flow, disputes,
  automatic reactivation of certifications already ended, and changing the
  currently tested private-reading correction outcomes.

## Deliverables and acceptance

1. Inventory `group_metric_eval_source_graph`, `group_metric_apply_member`,
   legacy certification paths and the evaluator. Separate the pin for observed
   set facts from scoring dependencies; do not simply remove every dependency
   check. Preserve queue generation/claim/revision fences and failure isolation.
2. Group preference changes, contribution changes (including zero ↔ positive),
   target load-mode changes and linked source load-mode changes alone retain
   active certification IDs, certifier, certification time and original
   observed revision/value metadata. `ended_at` and `end_reason` remain null.
3. Recalculate the score under the current rules. The same eligible set can
   appear on the Certified board at its new value; the certificate's original
   audit fields are never overwritten with that value. If the set becomes
   ineligible, retain the active certificate but omit its board entry until
   eligible again. Rebuilding never mixes revisions or emits a performed PR.
4. A changed observed set fact or its deletion/tombstone still invalidates the
   certificate. Distinguish an exercise-level distribution rule edit from a
   rewrite of the logged set. Withdraw/cancel permissions and outcomes remain.
5. Preserve the current relevant-reading correction tests: the existing e1RM
   certification is voided while the raw Weight certification stays active.
   New later readings that do not change the applicable context remain harmless.
   The new percentage metric's reading-correction policy is resolved separately
   before T09; do not infer it from the rule-change decision.
6. Migrate active legacy certificates without losing IDs or audit context.
   Document previously ended rows as ended; no silent resurrection. Preserve
   history and archived/former-member rules. Keep all private dependencies
   server-only and do not introduce bodyweight disclosures.
7. Update the group contract and any affected architecture/data descriptions
   with the shipped lifecycle rule. T10 aligns public UI wording.

## Verification

Read test-directory READMEs first. Real backend cases cover repeated preference
toggles, contribution/distribution edits, coincidentally equal scores, temporarily
ineligible sets, edits/deletes/undeletes, withdrawal/cancellation, legacy pins and
reading corrections. Assert exact certificate IDs/audit fields and both board
scopes, not just certificate counts. Add/update Jest coverage for changed shared
logic and API contracts.

## Specs to update

- `docs/specs/tech/groups-contract.md` §11.3 and legacy lifecycle descriptions.
- `docs/specs/03-technical-architecture.md` — witnessed facts versus recalculation.
- `docs/specs/05-data-model.md` — any changed server-only pin representation.

## Gates and closeout

Use `./boga test for` on the final diff. Propose `fast`, `backend` (including
`groups-leaderboards`) and `ios-groups-e2e`, then run the operator-agreed set.
The unchanged visual layout may justify a smaller device set; it requires the
operator's agreement. Required quality targets run before the PR. Evidence goes
in the implementation PR, which deletes this card and marks its milestone row
completed. T14 owns the combined human acceptance and final closeout.
