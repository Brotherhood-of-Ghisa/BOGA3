# Set

### set.performed · definition · accepted

A set counts only when **confirmed performed**: exactly one valid measurement
(reps or hold seconds), valid nonnegative Weight, and no performance status.
Blank Weight is zero. Planned, unperformed and skipped rows never count.
Holds use whole seconds within the shared parser's bound; reps are never
fabricated from time.

Why: one validity rule; the reps cap keeps counts exact on every device and server.
Code: `isConfirmedPerformedSet` in `apps/mobile/src/exercise-calculations/set-semantics.ts`; the parser and `MAX_SET_REPS` in `apps/mobile/src/exercise-calculations/parse.ts`.

### set.eligibility · definition · accepted

Which confirmed performed sets feed which figure. A **working set** feeds set
and session counts. Repetition working sets also feed 1RM and Weight records;
repetition **volume-included sets** feed Volume and its records independently.
Holds follow normal Effort eligibility for counts and muscle credit, but never
feed Volume, 1RM, Weight records, RM observations or strength scores.

Personal figures follow the account's effort policy (Settings → Effort:
Working set and Volume, chosen independently); the table gives its defaults.
Groups and coaching use those fixed defaults.

<!-- fact-table: set.eligibility -->

| Effort label | Personal working set (default) | Personal volume-included (default) | Groups and coaching (fixed) |
| --- | --- | --- | --- |
| Warm-up | no | no | no |
| Unspecified (no label) | yes | yes | yes |
| RIR 4, 3, 2, 1, 0 | yes | yes | yes |
| Stored RIR above 4 | as RIR 4 | as RIR 4 | yes |
| Technique | no | no | no |
| Cooldown | no | no | no |
| Rehab | no | no | no |
| Unknown stored label | as Unspecified | as Unspecified | yes |

A session counts when it holds at least one working set.

Why: warm-ups, technique, cooldown, and rehab work is logged but is not training
stimulus; groups compare people, so they use one rule nobody can tune.
Code: `isWorkingSet`, `isVolumeSet` in `apps/mobile/src/exercise-calculations/set-semantics.ts`; defaults and the fixed group and coaching rule (`SHARED_EFFORT_POLICY`) in `apps/mobile/src/exercise-calculations/effort-policy.ts`; groups read the `working` flag from `apps/mobile/src/groups/set-facts.ts`.

### set.count-display · presentation · accepted

An unqualified `Sets` is the working-set count ([[set.eligibility]]) on every
screen and in the share image. All-sets and working-sets counts are never
shown side by side. Only plain row counts count every row: `n of m sets done`
the remove-exercise alert's `its N sets`, and a merge confirmation's affected live set rows (including warm-ups and drafts).

Why: one number per idea.
Code: the aggregators' `workingSetCount` (`apps/mobile/src/session-insights/calculations.ts`).
Signature: `n of m sets done`

### set.row-figures · presentation · accepted

Repetition rows show every computable figure (Weight, reps, 1RM, Volume),
planned and warm-up rows included; unrealised figures are faded. A warm-up
row's 1RM and Volume describe that row only; [[set.eligibility]] decides
which sets can be records, never what a row shows. The only highlights on a set
list are the session's record sets (`docs/specs/tech/training-metrics-contract.md`
§3). The group session view highlights sets that took #1 on a group
1RM or Seconds board: one `GR` band per set.
Hold rows show entered Weight and seconds, with no derived columns or hold
record panel. Group rankings follow [[groups.hold-ranking]]. Hold-only aggregates report unavailable Volume. Shared normalized
holds show seconds without hidden Weight.
In a shared group repetition row, normalized Weight is added load as `%BW`;
ordinary and personal Weight retain their existing meaning.

Why: the row is a record of what was lifted; eligibility decides what counts,
not what is shown.
Code: `calculateSetMetrics` in `apps/mobile/src/exercise-calculations/load-metrics.ts`; record band words in `apps/mobile/src/session-insights/record-band.ts`; the group band in `buildSessionRecordBands`, `apps/mobile/src/groups/competition-session-records-view-model.ts`.
