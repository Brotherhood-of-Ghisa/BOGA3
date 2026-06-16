# Workout Set Row UX Refinement

## Context

Continue on branch `codex/add-planned-vs-performed-sets` in
`/Users/sboschi/Code/BOGA3`. Do not create or use a worktree for this task.

The planned-vs-performed workout execution design is already implemented. This
task refines the set-row UX so imported/planned and normal workout rows share
one consistent compact/edit interaction model.

Before starting, load `AGENTS.md` and the always-load docs it references. This
touches mobile UI/screens/components, so also load the required UX/UI specs from
`docs/specs/ui/` per `AGENTS.md`.

## Goal

Make all session-recorder set rows compact text rows by default once they have
displayable values, with tap-to-edit behavior that turns the row into inputs.
Blank newly-added rows may start editable because there is nothing useful to
display yet.

## Approved UX Direction

- Apply compact text-row behavior to all set rows, not only imported/planned
  rows.
- Newly blank rows may start editable.
- Once a normal row has valid performed values, it should collapse into compact
  display.
- Tapping any compact row should reopen editable controls.
- Remove the `Type / Weight / Reps` column header row.
- Input fields should use placeholder text:
  - `Weight` with a persistent muted `kg` suffix inside the field
  - `Reps`
- Compact set text should use dot separators, not `x` or `×`.
- Display weights with `kg` in compact text.
- Bodyweight rows should still read naturally, e.g. `BW · 6 reps`.

## Row Examples

```text
• Set 1 · 60kg · 8 reps                         RIR 2
✓ Set 1 · 60kg · 8 reps                         RIR 2
≈ Set 2 · 60kg · 8 reps → 60kg · 6 reps         RIR 1
− Set 3 · 60kg · 8 reps                         RIR 2
+ Set 4 · 50kg · 10 reps                        Assisted
○ Set 5 · BW · 6 reps                           Log   Skip
```

## Glyph Rules

Use a fixed left glyph slot for every compact and editable row so imported and
non-imported rows align.

- `•` normal/non-imported performed set
- `○` planned target, not yet performed
- `✓` imported/planned set performed exactly as planned
- `≈` imported/planned set modified from target
- `−` imported/planned set skipped
- `+` extra performed set added beyond a plan

Editable rows should preserve the same left glyph slot.

## Quality Display

The current set `type` concept should be presented as quality in the row UI.

- Keep the existing underlying set type data model unless the codebase already
  has a better local naming convention.
- Render quality as a right-side badge/label in both compact and editable modes.
- Exception: imported/planned rows that have not yet been logged, edited, or
  skipped should not show the quality badge while the `Log` / `Skip` decision
  controls are visible. Show quality after the user logs, edits, skips, or adds
  a performed row.
- In editable rows, keep the quality badge next to the weight/reps text inputs.
  The remove control should be a compact secondary `rm` button, not a prominent
  destructive icon button.
- Follow-up refinement: the empty quality value renders as `•` and persists as
  `NULL`; the quality button is fixed-width and sized for `Warm-up`; `rm` uses
  the same visual style as `Skip`; tapping outside set inputs collapses
  displayable edit rows, but moving between weight and reps does not.
- Follow-up refinement: quality is displayed and persisted, but the default
  planned-row match policy compares only prescribed volume (`Weight` + `Reps`).
  Keep the comparison code parameterized so a stricter quality-aware mode can be
  enabled later without rewriting row-state logic.
- Do not bury quality in the compact text body.
- Prefer labels such as:
  - `Warm-up`
  - `RIR 2`
  - `RIR 1`
  - `Failure`
- Use existing semantics if labels already exist locally.

Examples:

```text
• Set 1 · 60kg · 8 reps                         RIR 2
• [Weight  kg] [Reps]                           RIR 2
```

## Add Set Behavior

Optimize for reduced user input, while avoiding silent changes to planned
intent.

When tapping `Add set`:

- If the previous row is a normal non-imported row with valid weight/reps,
  commit/collapse it and create the next editable row.
- If the previous row is an imported/planned row with actual values entered,
  commit/collapse it as matched or modified and create the next editable added
  row.
- If the previous row is imported/planned and has no actual values, do not
  silently mark it done. Leave it planned. The user must explicitly tap `Log` or
  `Skip`.
- If the previous imported row is skipped, preserve skipped state and add the new
  row after it as `+ Added`.
- If the user taps a planned or skipped target to edit it, hydrate the editable
  actual fields from the planned target values first so skipped/imported rows do
  not open as blank inputs.

Interpretation: `Add set` means "create another performed set", not
"auto-complete an unlogged planned target."

## Implementation Notes

- Prefer existing `SessionContentLayout` and session-recorder patterns.
- Do not add a new screen shell or custom header.
- Do not add raw color literals in `.tsx`; use existing tokens/primitives.
- Keep current fast-edit affordances where possible.
- Add/update accessibility labels so compact rows include glyph state, performed
  values, planned-vs-actual comparisons, and quality.
- Update relevant UI docs if component semantics change.
- Dark mode is out of scope.

## Verification

Run required gates for mobile UI changes:

```bash
./boga test fast
PATH="/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk" ./boga test frontend
```

Because the parent branch touched sync/data, check whether the diff still
triggers backend gates with:

```bash
./boga test for
```

If required, also run:

```bash
./boga test backend
```

Capture at least one simulator screenshot showing:

- normal non-imported compact rows
- imported planned rows
- matched, modified, skipped, and added states
- editable row with placeholders and right-side quality
