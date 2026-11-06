# Routine as a property of a plan — revised plan and mock v2.1

## Operator correction

On 2026-11-06 the operator clarified that Routine is a quality of the existing
plan: effectively a recurring plan, activated with a tick inside the current
plan creation card. The operator requested planning (`/plan`).

V1 is rejected. Its separate routine framing, switch and destructive
schedule/programme conversion are superseded. This correction is accepted
direction; it is not acceptance of the new rendered mock.

The operator subsequently stated “Accepted the idea” and asked to compare the
tick with other BoGa-style controls. The concept is accepted; the exact control
and mock remain under review. Existing CheckRow, SwitchRow and SegmentRow
options are compared in `docs/plans/designs/routines-control-review.md` and
`docs/plans/designs/routines-control-options.html`. The earlier rejection was
of v1's conceptual framing, not a blanket rejection of the SwitchRow primitive.
The operator has now selected SwitchRow. Current visual target and acceptance
record: `docs/plans/designs/routines-anytime-v3.md`; the technical boundaries
below continue to apply.

## Scope clarification after mock acceptance

On 2026-11-06 the operator answered **No Routine inside a programme** and
asked to **keep existing logic (for non routine plans) wherever possible**.
These responses supersede the programme conversion examples in earlier mocks
and planning notes. The accepted v3 switch/locked-Anytime composition applies
to standalone plans. Programme forms omit Routine; persistence enforces the
restriction without detaching a child. Reuse ordinary recorder completion,
confirmed-work eligibility and history operations rather than introducing a
parallel routine completion engine.

## Revised implementation plan

1. Add a boolean Routine property to the existing session plan, default off.
   Marking an existing plan changes that property in place, including after
   completion, skip, partial use or attachment, for standalone plans only. Keep
   its identity, authoring provenance, exercises, targets, gym and schedule
   metadata. Programme membership and Routine are mutually exclusive.
2. Add the selected existing `SwitchRow` labelled **Routine** to the existing
   `PlanFormScreen` creation/edit card, beside its existing Schedule and Gym
   choices. Retain Add plan / Save, validation and failure handling. Omit Routine
   from programme child forms and refuse invalid saves at the data boundary.
   Checking does not duplicate or detach the plan. While enabled, Schedule becomes a read-only
   `ValueRow`, with a lock icon, no picker affordance, and the value Anytime;
   preserve any previous scheduled instant and restore its presentation when
   unchecked. No weekly/calendar recurrence is introduced.
3. Use the same plan route, `PlanDetailSummary`, Edit and Duplicate actions.
   Start all starts a fresh workout from the entire current prescription when
   Routine is on; an active use offers Resume. Finishing partial work or
   explicitly skipping a use keeps the flagged plan available. Unchecking only
   stops future repeat availability; an active/completed workout remains intact.
4. Reuse `PlanSection` rows. The task's Routines section is a grouping of the
   same flagged plans, each opening the same plan ID. Keep it out of the
   one-off due queues while Anytime is enabled and avoid a duplicate row in
   Sessions. Last completed / Last skipped remain metadata on the plan's row
   and existing detail. Known missing dates do not become Never used.
5. Extend the existing planner/materialization/persistence APIs internally so
   each use has fresh progress and stable retry identity. Preserve prior actuals
   and targets, ordinary-plan uniqueness, ownership and sync safety. Internal
   execution identity is an implementation concern; it creates no separate
   user-facing Routine object, authoring flow or detail route. Programme execution and progression are unchanged.
6. Add the task's real-data lifecycle and sync coverage, run agreed local gates,
   independent reviews and native screenshot comparison, then obtain running-UI
   acceptance and open the implementation PR with green CI. Behavior and verification cover the agreed standalone scope.

## Pattern and mock

- Existing parents: PlanFormScreen + its FormSection/ChoiceRow, SwitchRow,
  ValueRow, PlanDetailSummary, PlanSection and Sheet. SwitchRow provides the
  full-row on/off control; ValueRow carries the non-interactive locked value.
- Selection: custom composition of existing catalog primitives; no new coded
  family, typography, density or navigation.
- Mock source: `docs/plans/designs/routines-anytime-v2.html`.
- Rendered evidence: `apps/mobile/artifacts/routines-anytime/v2/` (gitignored).
- Historical core shows Edit on a completed programme plan; the subsequent
  standalone-only decision supersedes that example. Reuse the same form and
  detail for an eligible standalone plan. Other review sets retain the required dates,
  active/conflict/skip, partial-to-fresh, save/error, long-title and small-phone
  states. Conversion now means ticking the property, with no detach dialog.
- V2 was superseded by the explicitly accepted v3 target. Its HTML remains a
  historical planning mock and contains no production React Native.
- V2.1 clarifies the proposed Schedule lock in response to the operator's
  question: Routine checked means read-only Anytime; unchecked restores date
  editing and its retained date. Scheduled recurrence is outside this task.
  The operator's question is not recorded as mock acceptance.
- Verification: 18 rendered gallery captures across 390 × 844 and 320 × 700 pt;
  no script errors or horizontal overflow. The tick toggled off/on and retained
  the saved schedule in the mock self-check. Evidence: `render-check.json` in
  the artifact directory. These checks verify the mock only.

## Decisions and remaining technical work

The two product questions are settled: no programme Routines, and reuse of
existing non-routine logic wherever possible. Mock v3 is explicitly accepted;
its frozen artifact and acceptance record are in
`docs/plans/designs/routines-anytime-v3.md`.

The internal per-use schema and concurrency implementation still need to be
chosen against the existing sync contract. A boolean alone cannot replace
provenance protection. Use recoverable historical instants, existing
confirmed-work and empty-Finish rules, and ordinary history edits/deletion/Undo.
Only repeat availability, fresh per-use identity and explicit routine Skip are
new behavior. No separate programme progression policy is needed.

## Implementation boundaries checked against source

| Boundary | Current behavior and required change |
| --- | --- |
| Plan metadata and form | `plan-repository.ts`, `plan-form-model.ts` and `plan-edit-sync.ts` under `apps/mobile/src/session-planner/` must carry the Routine flag independently of block-diff guards. Toggling the tick alone must not rewrite, resolve or tombstone any authored block/set. Save atomically retains entered fields on refusal. |
| Repeated starts | `apps/mobile/src/session-planner/materialization.ts` currently filters to unclaimed pending blocks and uses deterministic one-start IDs. Routine-on starts need the entire current definition and a distinct identity across uses, while retries within one use converge. Ordinary plan behavior stays guarded. |
| Attachments at conversion | `addPlanBlockToSession` deliberately leaves `sessions.source_plan_id` null. Resume and historical outcome discovery must inspect block/set provenance as well as whole-plan starts; checking only the session's source-plan field misses supported conversions. |
| Source uniqueness | The three existing provenance unique indexes and the cross-level parent/child guards are in both local schemas and server migrations. The read model also assumes one claim per source block (`cardsByBlockId`). Choose per-use scoped claims or isolated immutable snapshots before coding; changing only generated IDs cannot pass these constraints. |
| Future definition edits | `savePlanExerciseGraph` updates/tombstones authored targets, while performed rows already store copied names and planned targets. A future edit must not mutate existing performed snapshots or make their former source links disappear from outcome discovery. Include active-use edits that remove/replace a source block or target. |
| Recorder completion and reopen | `completeActiveSession` cleans to confirmed work, then completes the workout and resolves source blocks. `reopenCompletedSession` returns the workout to active and clears completion fields. Date reads must follow the qualifying completed state; Resume of a historical workout and Abandon cannot manufacture a completion or skip. |
| Queues and programmes | `plan-queries.ts`, `available-blocks.ts` and `apps/mobile/src/today-plan/repository.ts` share plan readers. The Routine flag must suppress one-off due commitments without duplicating list rows. Reject Routine plus programme membership on creation, conversion, attachment and sync; programme progression remains unchanged. |
| Coaching compatibility | `getUpcomingSessionPlans` in `supabase/functions/agent-api/index.ts` currently reads scheduled intent, while agent mutation RPCs protect consumed/attached blocks and coordinate provenance locks. Keep the tools/permissions unchanged, preserve unknown flag values on older writes, and do not project repeat uses as future coached commitments. |
| Sync | `apps/mobile/src/sync/cycle.ts` applies each pull page in a transaction and advances its cursor only after the page commits. A self-reference is not automatically safe across pages on fresh restore. Any new FK/entity must prove parent ordering, batch closure, account wipe/reinstall and protocol compatibility; a protocol cutover needs an operator-agreed rollout. |

## Verification checklist for the eventual implementation

These are planned assertions, not results. Existing tests have been inspected
for their scope; none currently proves Routine behavior.

| Requirement | Authoritative evidence to add or extend |
| --- | --- |
| Same plan, tick-only create/edit, conversion matrix | Real SQLite tests in `apps/mobile/__tests__/session-plan-repository.test.ts` plus rendered production form/route tests in `session-plan-screens.test.tsx`; unchanged plan ID, source history and schedule metadata across standalone source states; reject programme membership without mutation. |
| Full and partial Finish, second full fresh start | Extend `apps/mobile/__tests__/session-plan-materialization.test.ts` and recorder lifecycle coverage over the real data boundary. The existing test explicitly re-materializes only available blocks; retain that for ordinary plans and add the full-definition Routine branch. |
| Retry, two-device Start, Start/Skip race, reopen/offline persistence | Extend the real cycle/provenance coverage under `apps/mobile/__tests__/sync/`, including `session-plan-entities-round-trip.test.ts`; assert one use per action, fresh identity across uses, actual preservation, FK integrity and a wiped-client restore. |
| Dates, legacy timestamps, correction, deletion and Undo | Extend `apps/mobile/__tests__/session-plan-queries.test.ts` using real linked workouts, including block-only attachments with no whole-plan source ID and known outcomes lacking a timestamp. |
| Resume, active conflict and abandon | Existing active-conflict/same-plan retry cases remain; add converted block attachments, restart/reopen and failed action cases. The persisted active graph and previous outcome dates are the oracle. |
| Future edits and stale saves | Compare active/completed graph rows before and after changing/reordering/removing current prescribed targets; later starts must use the saved definition. Test refusal retaining typed input. |
| No analytics, group or due-queue pollution | Extend `apps/mobile/__tests__/session-plan-exclusion.test.ts`, plan query tests and `today-plan-screen.test.tsx`; plans and skips add no performed rows, figures or stream entries. |
| Migration, ownership and agent compatibility | Paired local/server migrations, strict drift, push/pull contract assertions, cross-owner/OAuth denial and unchanged coach tool/permission contracts. |
| Native and release review | After mock acceptance and implementation: small/normal native captures against frozen v3, running-UI human acceptance, independent code/product review, agreed local lanes and green PR CI. |

No production changes or implementation gate results are claimed by this plan.
