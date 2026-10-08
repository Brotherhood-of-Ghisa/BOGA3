# Set

### set.performed · definition · accepted

A set counts for any figure only when it is **confirmed performed**: valid
reps (a positive integer, at most 999), valid Weight (digits with an optional
decimal point; blank Weight with valid reps is `0`), and no performance status.
Planned, unperformed and skipped rows never count for any figure.

Why: one validity rule means a value is valid everywhere or nowhere. The reps
cap keeps every count exact on every device and server; no real set comes
near it.
Code: `isConfirmedPerformedSet` in `apps/mobile/src/exercise-calculations/set-semantics.ts`; the parser and `MAX_SET_REPS` in `apps/mobile/src/exercise-calculations/parse.ts`.

### set.eligibility · definition · accepted

Which confirmed performed sets feed which figure. A **working set** feeds set
and session counts and 1RM and Weight records. A **volume-included set** feeds
Volume and Volume records. The two are independent.

Personal figures follow the account's effort policy (Settings → efforts:
independent Working set and Volume columns). The table gives its defaults.
Group and coaching figures use one fixed rule, the same as the personal
defaults, and never read a device's policy.

<!-- fact-table: set.eligibility -->

| Effort label | Personal working set (default) | Personal volume-included (default) | Groups and coaching (fixed) |
| --- | --- | --- | --- |
| Warm-up | no | no | no |
| Unspecified (no label) | yes | yes | yes |
| RIR 4, 3, 2, 1, 0 | yes | yes | yes |
| Stored RIR above 4 | as RIR 4 | as RIR 4 | yes |
| Technique | no | no | no |
| Cooldown | no | no | no |
| Unknown stored label | as Unspecified | as Unspecified | yes |

A session counts toward a figure when it holds at least one working set.

Why: warm-ups, technique and cooldown work is logged but is not training
stimulus; groups compare people, so they use one rule nobody can tune.
Code: `isWorkingSet`, `isVolumeSet` in `apps/mobile/src/exercise-calculations/set-semantics.ts`; defaults and the fixed group and coaching rule (`SHARED_EFFORT_POLICY`) in `apps/mobile/src/exercise-calculations/effort-policy.ts`; groups read the `working` flag from `apps/mobile/src/groups/set-facts.ts`.

### set.count-display · presentation · accepted

An unqualified `Sets` is the working-set count ([[set.eligibility]]) on every
screen and in the share image. All-sets and working-sets counts are never
shown side by side. Only plain row counts count every row: `n of m sets done`
and the remove-exercise alert's `its N sets`.

Why: one number per idea, so the reader never has to pick which count
matters.
Code: the aggregators' `workingSetCount`.
Signature: `n of m sets done`

### set.row-figures · presentation · accepted

Every set row shows every figure it can compute (Weight, reps, 1RM, Volume),
planned and warm-up rows included. Figures not yet realised (planned rows)
are faded. A warm-up row shows its real 1RM and Volume, which describe that
row only. A set feeds records only as [[set.eligibility]] allows: a working
set can make a 1RM or Weight record, a volume-included set a Volume record,
and a set that is neither is never a record, PR or best. The only highlights
on a set list are the exercise's record sets: the set that took the 1RM record
and the set that took the Weight record (one set may take both). The group
session view highlights instead the set that took #1 on a group board, 1RM or
Volume: one `#1 in group` band per set, its boards joined (decided 2026-10-08).

Why: the row is a record of what was lifted; eligibility decides what counts,
not what is shown.
Code: `calculateSetMetrics` in `apps/mobile/src/exercise-calculations/load-metrics.ts`; record band words in `apps/mobile/src/session-insights/record-band.ts`; the group band in `buildSessionRecordBands`, `apps/mobile/src/groups/competition-session-records-view-model.ts`.
