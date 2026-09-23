# File-based training policy

Edit [`training.ts`](./training.ts); these defaults are embedded in the app,
not stored as user preferences or exposed through Settings.

- `EFFORT_LOGGING_POLICY.maxSelectableRir` controls the picker and tap cycle.
  Set it to `4` for Warm-up → blank → RIR-4 → RIR-3 → RIR-2 → RIR-1 → RIR-0;
  set it to `2` to start at RIR-2 instead. The next tap after RIR-0 is Warm-up.
  Labels and optional import enrichment use this same range automatically.
- `WORKING_SET_POLICY.maxRir` independently controls working-set classification.
  `3` means valid confirmed RIR-0 through RIR-3 count. Warm-up, blank, invalid,
  and unconfirmed rows never count as working sets. Changing this threshold
  reinterprets derived analytics for existing records; it does not edit them.

Both values accept non-negative safe integers. The default is `3` for each.

Persisted/imported effort accepts canonical `rir_<n>` values independently of the
current picker range. Reducing the range preserves older values and their labels;
new sets still inherit the previous RIR. Tapping an effort outside the current
range starts again at Warm-up. There is no database migration when changing the
range: actual and planned effort already use nullable text fields.
