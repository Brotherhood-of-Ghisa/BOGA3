# Added-load display consistency

Approved target: the existing mobile screens and the user's supplied leaderboard,
Stream and history screenshots, retaining the current typography and layout.

## UX Contract

- Personal 1RM and Weight remain added absolute load. Group normalized 1RM and
  set Weight show added load as %BW; Volume remains total work as %BW·reps.
- Names remain the exercise's name, without a generated `(% BW)` suffix.
- Units use the existing small-label typography beside their figures, including
  group summaries, full sessions, boards, history, records, certification and CoW.
- Valid added zero displays numerically. Absent projections stay unavailable.
- Published scores, ranks, eligibility, witnesses, Volume and CoW improvement
  arithmetic do not change. Reader projections use original historical rules and
  frozen CoW scoring context, without disclosing private absolute values.
- Existing set-card, board-row and record-sheet patterns are reused.

## Verification

Pure and component coverage for zero, partial contributions, per-side sources,
ordinary values, exact safe wire shapes, cache eviction and unavailable states;
backend checks for opt-in reader compatibility, history and frozen CoW projections;
native screenshots at phone widths and in light/dark appearance.

Required gates and reviewer agreement will be recorded with the finished diff.
