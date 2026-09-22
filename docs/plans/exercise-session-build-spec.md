# Build spec — exercise page and session view

Ephemeral working notes (`docs/plans/README.md`), paired with
`exercise-session-redesign.md`. This is the screen-level detail for the two
screens being built; the screen-agnostic rules it obeys live in
`docs/specs/ui/design-language.md`, and the accepted target is
`docs/specs/ui/design-targets/exercise-session-v5.md`.

**Graduation:** as each screen ships, its contract moves to `screen-map.md` +
`navigation-contract.md`, its semantics to `ux-rules.md`, and its primitives to
`components-catalog.md`. Delete this file with the last step.

## Metrics

Reference viewport 390×844. Page gutter 14. Card radius 6, sheet top radius 16,
sheet handle 38×4. Control column 44 wide. Metric value columns are fixed width
(38 for 1RM, 38 for volume) so figures align down the list.

## Set row

The unit of the whole feature:

```
[type 44] [weight × reps, flex] [1RM / VOL stacked, right] [control 44]
```

- Every row — performed, current, planned — ends in a 44px control column, so
  every control sits on one vertical axis.
- Metric pairs put a mini legend left of a right-aligned fixed-width value.
- Glyph carries state (language §5): filled check = performed
  (`performanceStatus === null`), `accent` ring = current, dashed ring = planned.
- Bold `ink` marks the best 1RM / weight / volume *of that exercise today* —
  applied per column, so three different sets can each be bold.

## Exercise page

Top bar: back to session · exercise name · ⋮. No subtitle.

1. **Records panel**, collapsible. Collapsed is two rows: the
   `Records` | `Last` selector plus the `History` link, then `1RM / MAX / VOL`
   with labels above figures. Expanded `Records` gives each record its date and
   the set that set it. Expanded `Last` lists every set of the previous session
   with 1RM and volume. Selector and History link are present in both states.
2. **One ordered set list.** The current row expands in place into the logger:
   `Weight` (fits 5 digits + a point) · `Reps` (2) · `Effort` (opens a picker) ·
   the commit tick. All three fields are the same height.
3. `+ Add set` strip, then `Complete exercise`.

**Sheets:** ⋮ opens Edit / Swap / **Remove from session** (`danger`). Effort
opens a four-option picker (`W-Up` / `RIR 2` / `RIR 1` / `RIR 0`) defaulting to
the planned `setType`, so it is only opened when deviating.

**Two exits:** Back leaves set states untouched. Complete prompts on incomplete
sets.

## Session view

Top bar: `Session` · ⋮ (Abandon session) · **Finish** in `accent`.

1. **Summary card**: Time / Gym / Sets / Volume, labels above values.
2. **One card per exercise, read-only** — the whole card is a link into the
   exercise; there are no controls inside it. Each card shows the exercise's
   sets with emphasis applied, a `n/m` done count, and a `record` band when a
   record was set.
3. `+ Add exercise`.

Editing happens only on the exercise page. Add lives here; **remove lives in the
exercise's own ⋮**, not on the card.

## Planned vs ad-hoc is not a mode

There is no mode flag. Rows below the cursor mean a plan is being followed; none
means ad-hoc, and the two mix freely in one session. `Append plan` adds rows in
either case. This falls out of the model: a set row carries both a planned
triple (`plannedWeightValue` / `plannedRepsValue` / `plannedSetType`) and an
actual one, with `performanceStatus` deciding which is real.
