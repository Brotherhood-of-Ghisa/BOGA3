# Training defaults

The static range in [`training.ts`](./training.ts) supplies default set-type
constants and optional import enrichment. Runtime logging choices use the saved
account-local visible grades from `src/preferences/`, default RIR 0–3.

- `EFFORT_LOGGING_POLICY.maxSelectableRir` controls the static default range.
  Set it to `4` for Warm-up → blank → RIR-4 → RIR-3 → RIR-2 → RIR-1 → RIR-0;
  set it to `2` to start at RIR-2 instead. The next tap after RIR-0 is Warm-up.
  Optional import enrichment uses this default range; labels accept every valid stored RIR.

The value accepts a non-negative safe integer; the default is `3`.

Working-set classification is not configurable: every valid performed set that
is not a warm-up counts (`isWorkingSet` in
`src/exercise-calculations/set-semantics.ts`;
`docs/specs/tech/training-metrics-contract.md` §1).

Persisted/imported effort accepts canonical `rir_<n>` values independently of the
saved visible grades. Hiding a grade preserves older values and their labels;
new sets inherit a visible previous RIR. A hidden inherited RIR advances to the next lower visible grade; if none exists it stays unchanged. Tapping an effort outside the visible
grades starts again at Warm-up. There is no database migration when changing the
range: actual and planned effort already use nullable text fields.
