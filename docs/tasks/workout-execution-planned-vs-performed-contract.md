# Workout Execution Planned-vs-Performed Contract

## Status

This card records the final implementation contract for the
planned-vs-performed workout execution work on branch
`codex/add-planned-vs-performed-sets`. It consolidates the original task brief
with the later UX amendments that were agreed and implemented.

This is a task contract for future consultation. Current source-of-truth UI
semantics remain in `docs/specs/ui/ux-rules.md` and
`docs/specs/ui/screen-map.md`.

## Scope

Update the existing React Native workout/set logging experience so the existing
session-recorder screen supports planned-vs-performed set rows.

The same set logging screen is used when:

- a session starts empty,
- a session is appended from a past completed session,
- a session later loads from a program.

Historical imports prepare planned targets in the active session. They do not
create a separate imported-workout UI.

## Non-Negotiables

- Keep the existing session-recorder header and route chrome unchanged.
- Do not add a new custom Workout Execution header.
- Prefer existing `SessionContentLayout` and session-recorder patterns.
- Use existing UI tokens/primitives; do not add raw color literals in `.tsx`.
- Keep dark mode out of scope.
- Keep the visual language compact, sleek, technical, and white-background
  first; avoid earthy wellness palettes, aggressive gym visuals, and overlapping
  window-style UI.
- Preserve fast set entry/editing affordances where possible.
- Add accessible labels for row state, planned/actual comparisons, and quality.
- Update `docs/specs/ui/*` when semantics or component contracts change.

## Historical Append Behavior

When browsing past sessions:

- If an active session exists, appending a historical session adds planned rows
  to the current active session.
- If no active session exists, appending a historical session starts/creates a
  new active session and adds the historical session into it.
- Imported historical sets are planned targets, not completed logs.
- Planned target values must not be overwritten by performed data.
- Actual logged values are stored and handled separately from planned values.

## Row State Model

Every set row has a fixed left glyph slot so imported and non-imported rows
align in both compact and editable modes.

- `○ planned`: planned target exists but has not been performed.
  - Muted ghost row with light border and lower visual weight.
  - Shows `Log` and `Skip`.
  - Does not show the quality control until logged, edited, skipped, or added.
- `✓ matched`: actual set matches the planned prescription.
  - Solid confirmed row.
  - Default match policy is prescribed volume only: `Weight` + `Reps`.
  - Quality is displayed and persisted, but does not make a row modified by
    default.
- `≈ modified`: actual volume differs from the planned target.
  - Shows target-to-actual text.
- `− skipped`: planned target intentionally not performed.
  - Remains visible and muted/collapsed.
  - Never silently delete skipped rows.
- `+ added`: extra performed set not in the plan.
  - Solid row marked as added.
- `• normal`: non-imported performed set.
  - Uses the same compact/edit row behavior as planned execution rows.

The matching implementation must stay parameterized so the app can later switch
from volume-only matching to quality-only or volume-and-quality matching without
rewriting row-state logic.

## Compact Row Text

Compact set text is the default display once a row has displayable values.

- Use dot separators, not `x` or `×`.
- Display weights with `kg`.
- Display bodyweight as `BW`.
- Display reps with explicit unit text.
- Keep quality out of the compact text body; quality lives in the right-side
  quality control.

Examples:

```text
• Set 1 · 60kg · 8 reps                         RIR 2
✓ Set 1 · BW · 6 reps                           RIR 2
≈ Set 2 · BW · 6 reps → BW · 5 reps             RIR 1
− Set 3 · BW · 6 reps · Skipped                 RIR 2
+ Set 4 · Band-assisted · 8 reps · Added        •
○ Set 5 · 30kg · 8 reps                         Log   Skip
```

## Editable Row Behavior

Tapping any compact row opens inline editable controls.

- Planned/skipped target rows hydrate actual fields from planned values before
  opening, so skipped/imported rows do not open as blank inputs.
- Weight input shows placeholder `Weight` and a persistent muted `kg` suffix
  inside the field.
- Reps input shows placeholder `Reps`.
- Existing prefilled numbers remain visible when editing; inputs do not
  auto-select copied/defaulted values.
- There is no `Type / Weight / Reps` column header row.
- Blank newly added rows may start editable because there is nothing useful to
  display yet.
- Tapping outside set inputs collapses all displayable editable rows back to
  compact text.
- Moving focus between weight and reps inside a row does not collapse the row.
- Avoid multiple rows remaining in text-box mode at the same time; expanding a
  row collapses the previous expanded row.

## Quality Control

The existing set `type` concept is presented as set quality.

- Quality renders as a fixed-width right-side control in compact and editable
  rows.
- The button is wide enough for the longest current label, `Warm-up`, and must
  not resize as values change.
- Empty quality displays as `•` and persists as `NULL`.
- Tapping cycles quality in the existing order.
- Long-pressing opens the existing modal picker with explicit options.
- Planned rows that have not been logged, edited, or skipped suppress the
  quality control while `Log` and `Skip` are visible.
- Non-imported set rows may show quality immediately.

Current labels:

- `•`
- `Warm-up`
- `RIR 0`
- `RIR 1`
- `RIR 2`

## Row Actions

- `Log` on a planned row is one tap and marks the set done as planned.
- `Skip` marks the planned row skipped without deleting it.
- `rm` removes a non-planned set row and is styled exactly like the secondary
  `Skip` button.
- Planned rows use `Done` when edited; non-planned rows use `rm`.

## Add Set Behavior

`Add set` means "create another performed set", not "auto-complete an unlogged
planned target."

- If the previous row is a normal non-imported row with valid weight/reps,
  commit/collapse it and create the next editable row.
- If the previous row is a planned row with actual values entered,
  commit/collapse it as matched or modified and create the next editable added
  row.
- If the previous row is planned and has no actual values, do not silently mark
  it done. Leave it planned until the user explicitly taps `Log` or `Skip`.
- If the previous planned row is skipped, preserve skipped state and add the new
  row after it as `+ Added`.
- New non-planned rows copy the previous set's actual `Weight`, `Reps`, and
  quality values where applicable.

## Target Example

```text
Pull-ups
4 sets · 2 performed · 1 skipped

✓ Set 1 · BW · 6 reps
≈ Set 2 · BW · 6 reps → BW · 5 reps
− Set 3 · BW · 6 reps · Skipped

+ Add set

DB Row
3 planned · 1 performed

✓ Set 1 · 30kg · 8 reps
○ Set 2 · 30kg · 8 reps                         Log
○ Set 3 · 30kg · 8 reps                         Log

+ Add set
```

## Persistence/Data Semantics

Planned and actual values are distinct.

- Planned targets store planned reps, planned weight, planned quality, and
  performance status.
- Actual performed values store actual reps, actual weight, and actual quality.
- Skipping clears/keeps actual performed values as intentionally unperformed
  while preserving planned target fields.
- Editing a planned/skipped row copies planned values into actual fields as an
  explicit user edit action.

## Accessibility Contract

Compact row accessibility labels include:

- row state (`planned`, `matched planned set`, `modified planned set`,
  `skipped planned set`, `added set`, `logged set`),
- exercise/set position,
- planned value and actual value when different,
- quality where the quality control is visible.

Action labels remain explicit, for example:

- `Log set 1 as planned`
- `Skip set 3`
- `Done editing set 2`
- `Remove set 4 from exercise 1`

## Verification Contract

For mobile UI changes in this area, run:

```bash
./boga test fast
PATH="/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk" ./boga test frontend
```

If the branch diff touches data/sync/backend paths, also check required gates:

```bash
./boga test for
```

Run `./boga test backend` when required by the diff.

Expected evidence includes at least one simulator screenshot set covering:

- normal non-imported compact rows,
- imported planned rows,
- matched, modified, skipped, and added states,
- editable row with placeholders and right-side quality.

Evidence captured for this implementation:

- `/Users/sboschi/Code/BOGA3/apps/mobile/artifacts/maestro/ad-hoc/20260616-170138-56791/maestro-output/screenshots/workout-set-row-editable-placeholders.png`
- `/Users/sboschi/Code/BOGA3/apps/mobile/artifacts/maestro/ad-hoc/20260616-170138-56791/maestro-output/screenshots/workout-set-row-normal-compact.png`
- `/Users/sboschi/Code/BOGA3/apps/mobile/artifacts/maestro/ad-hoc/20260616-170138-56791/maestro-output/screenshots/workout-set-row-imported-states.png`
