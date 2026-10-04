# T-20260930-01 — Keep zero-contribution group boards stable

- Status: `planned`
- Depends on: M27-T13 (completed)
- Milestone: [M27 — Bodyweight load and group comparisons](../milestones/M27-bodyweight-load-and-group-comparisons.md)
- Areas: backend; UI impact: yes (existing leaderboard states)
- Issue: [#411 — Group bodyweight toggle resets zero-contribution leaderboards](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/411)
- Workstream: [#420](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/420)
- Related task: M27-T13 — Preserve certifications across rule changes (completed), implementing [#419](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/419).

## Objective

A legacy group Bodyweight calculations preference toggle cannot affect a
comparison with zero group contribution. Keep those boards ready and leave
scores, revision, history and certifications intact. Apply milestone D7/D9:
an effective rule change may rebuild a comparison, but never voids a witness
certificate solely because its calculation rules changed.

## Scope

- In: a forward backend migration for no-op preference changes, accurate rule
  metadata/history, focused group contract tests and the owning specification.
- Out: percentage scoring/units, new board UI, personal settings, reading-
  correction policy and the general certification-pin migration (T13).

## Deliverables and acceptance

1. Repeated Off → On → Off preference writes leave zero-contribution boards
   `ready`; preserve scores, effective rules revision, Certified/All entries,
   active certificate IDs/audit metadata and lead-change history. Do not queue
   needless work or emit a spurious rules-change event.
2. Use the **group** contribution, not a member's private preference or personal
   exercise contribution. Zero-contribution scoring must not query a private
   reading or omit ordinary 1RM because that reading is unavailable.
3. Preserve accurate current/past rule metadata. Resolve the coupling between
   global preference JSON and effective zero-contribution rules rather than
   merely suppressing the update loop while publishing contradictory metadata.
4. Where a legacy positive-contribution preference toggle changes scoring,
   preserve coherent rebuilding/publication. The rules-only toggle must not end
   an unchanged set's certificate. T13 owns the general lifecycle fix; do not
   retain or add a test expecting positive-contribution certificates to void
   solely on a rule revision. Build on the merged T13 lifecycle fix.
5. Preserve existing privacy, role, performance-edit/delete and reading-
   correction checks. The group switch stays: Off uses ordinary Volume/1RM;
   On uses bodyweight percentages when contribution is positive (D8/T08).
   This task covers retained legacy writes as well as current UI.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Conventional leaderboard | Owner/admin changes legacy group preference → opens zero-contribution comparison | Ready podium/All/Certified scores, certificates and history are unchanged | No transient rebuilding or private-reading dependency |
| Affected legacy comparison | Change an effective positive-contribution calculation rule | Publish one coherent revision; unchanged witnessed set retains certification after T13 | Ineligible score omitted; certificate remains active; no fake performed PR |

## Specs to update

- `docs/specs/tech/groups-contract.md` §11 — effective no-op preference changes.
  T13 owns general certification persistence; T08/T09 own %BW compatibility.

## Gates and closeout

Read test-directory READMEs; extend real backend tests for both comparison
categories and repeated writes. Add/update Jest if mobile/shared code changes.
Use `./boga test for` and propose `fast`, `backend` (including groups-leaderboards
and groups-api-live), and `ios-groups-e2e`; run the operator-agreed set and the
required quality targets before the PR. No new Maestro scenario without
justification/approval. The implementation PR deletes this card, updates its
M27 row and closes #411 once its full acceptance is satisfied. T14 closes #420.
