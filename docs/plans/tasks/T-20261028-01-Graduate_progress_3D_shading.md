# T-20261028-01 — Graduate Progress 3D shading by period change

- Status: `planned`
- Depends on: none; merge this planning PR before starting implementation
- Milestone: none
- Areas: frontend; UI impact: yes
- Execution: one session, one fresh leased worktree, one implementation PR

## Objective

Make larger increases receive darker theme shades in Progress Muscle 3D.
Replace the current three direction categories with a proportional scale while
preserving the existing period comparisons, figures, theme and anatomical lighting.

## Scope and freshness

- In: the current Muscle 3D view, shade calculation, palette, affected callers,
  tests and the owning product rule.
- Out: Exercise 3D, History heatmaps, targets, counting/Volume eligibility,
  calendar/gym-scope changes, new controls, legends, dependencies or stored data.
- Main inspected: `51b12c40` (2026-10-28). PR #978 established theme shades;
  PR #983 subsequently removed Exercise 3D. The user explicitly chose **current
  Muscle 3D only** after this drift was reported. Do not restore Exercise 3D.
- At kickoff, compare these assumptions with latest main and report material
  drift before implementing.

## Decided

1. Use shades of the active theme, with no legend and no fixed red/green fills.
   Keep the selected muscle's Now/Prev/Change figures and accessibility.
2. Compare each muscle with its own preceding period, following
   [[comparison.window]]. For N weeks, current is the Monday N−1 weeks back
   through now; reference is the preceding N full Monday–Sunday weeks. A newly
   started Monday is intentionally compared with a full reference period.
3. Targets and History look-back never determine 3D shades. Preserve muscle
   attribution, grouping and the secondary-set filter in both periods
   ([[muscle.set-count]], [[muscle.report-groups]],
   [[muscle.secondary-filter]]). Muscle 3D remains all gyms under
   [[gym.view-filter]]; a table's selected gym must not leak into its scores.
4. Score Sets by the signed difference in working-set count, including half
   sets. Score Volume by its rounded whole-percentage change, matching
   [[comparison.change-display]]. Thus +6 Sets ranks above +2 Sets; +50% Volume
   ranks above +10%. A Volume change displayed as 0% receives the middle shade.
5. Scale increases and decreases separately across the muscles represented in
   the filtered figure, front and back together. Equal changes receive equal
   shades. Scale does not change on rotation or selection; filters or metric
   changes recompute it. Identical input yields identical output regardless
   of row order or legacy muscle aliases.

## Scoring contract

For comparable finite inputs with activity in either period, let `d` be the
metric's signed change above. Let `P` be the largest positive finite `d` and
`L` the largest absolute negative finite `d` in the filtered figure.

| Case | Normalized score | Theme anchor / treatment |
| --- | --- | --- |
| `d > 0` | `d / P` | middle toward darkest; largest increase is `+1` |
| `d = 0`, with activity | `0` | middle |
| `d < 0` | `d / L` | middle toward lightest; largest decrease is `−1` |
| Volume: previous 0, current positive | `+1` | darkest; keep the readout `new` |
| Finite Volume inputs, percentage overflows | `+1` | darkest; keep the existing `Increased` readout |
| Both periods 0, missing or non-finite input | outside scale | neutral anatomy; excluded from extrema |

No division by an absent/zero maximum. The `new` and overflow cases do not
enter finite extrema. If all scores are negative, no muscle uses an increase
shade; if all positive, no muscle uses a decrease shade. Unchanged activity
and empty/unavailable anatomy remain distinct.

For Volume increases of +1%, +25%, +50%, their normalized scores are
0.02, 0.5, 1. For decreases of −10%, −40%, the scores are −0.25, −1.
For Sets of +0.5, +2, +4, the scores are 0.125, 0.5, 1.

Accepted trade-off: this is a relative scale. A lone +1% gain is darkest;
changing filters can change a muscle's shade even when its own change is
unchanged. An outlier compresses smaller changes. Do not add percentile,
logarithmic or fixed-threshold adjustments.

## Design target and implementation boundaries

This card is the repo-native design brief. Use the existing running Muscle 3D
view as the layout/reference capture; attach before/after screenshots to the
implementation PR, following `docs/specs/ui/ai-design-policy.md`.

- Keep the existing theme anchors: `viz1` light, `viz2` middle, `viz4` dark.
  Interpolate proportionally in the existing LCh colour space between them.
  Reuse the current facet-lighting ramps independently of the data score.
- Increasing score must decrease base lightness at the same lighting step.
  Preserve hue, neutral anatomy, selection contours, hit testing, rotation,
  tap targets and the existing rendering/batching approach.
- Intermediate changes must produce intermediate shades, rather than collapse
  back to three direction categories. Do not impose a palette API or helper
  abstraction beyond what this renderer needs.
- Routine implementation choices (interpolation helper, palette resolution,
  internal types) belong to the executing agent. No unresolved product choice;
  surface a conflict with this brief before changing its semantics.

## Code and test starting points

- `apps/mobile/components/stats/muscle-body-projection.ts`: current
  `computeMuscleBuckets`, `buildThemeShadePalette`, facet fills and batching.
- `apps/mobile/components/stats/muscle-body-card.tsx` and
  `apps/mobile/components/stats/progress-muscle-view.tsx`: consumers and
  selection. Find every consumer of any changed export before editing.
- `apps/mobile/components/stats/comparison-format.ts`: retain display/rounding
  semantics; do not parse formatted strings to recover a numeric score.
- `apps/mobile/src/data/progress-comparisons.ts`: reuse the existing numeric
  `workingSetChange` and tagged `volumeChange` on comparison rows; do not add
  a second period-comparison calculation in the renderer.
- Read `apps/mobile/__tests__/README.md` before editing tests. Extend the
  existing `muscle-body-3d.test.tsx`, `progress-muscle-report.test.ts` and
  `stats-screen-local-data.test.tsx` coverage as needed; keep real-data tests
  for filtering and Monday windows rather than duplicating them with mocks.

## Deliverables and acceptance

1. Prove proportional ordering for the example scores, positive and negative
   ties, half-set changes, rounded 0% and an outlier. Tests must distinguish
   +1%, +25%, +50% beyond a shared positive category.
2. Cover all-positive, all-negative, unchanged-only, empty, unavailable,
   zero-baseline `new` and percentage-overflow inputs. No invalid colour,
   accidental empty-as-unchanged fill or division by zero.
3. Verify palette ordering at a fixed facet-lighting step for every built-in
   theme; preserve custom-theme generation. Capture native screenshots with
   several gain/loss magnitudes, unchanged activity and neutral anatomy in
   the default and a contrasting theme, including a small phone viewport.
4. Preserve real-data Monday 1-week/4-week comparisons, all-gyms scope,
   secondary filters, grouped muscles, and independence from targets/History.
   Verify a prior table gym choice cannot narrow 3D. Rotation, selection and
   alias handling must not rescale the same figure.
5. Keep the figure free of a legend. Numeric readouts remain sufficient to
   read exact changes without colour, including with VoiceOver selection.
6. **Product fact change:** update only the 3D portion of
   [[comparison.colour-scale]] to describe magnitude and relative scaling.
   Preserve its History rules. Keep [[comparison.window]] and
   [[comparison.change-display]] unchanged. Review the existing exception in
   `docs/specs/ui/design-language.md`; avoid copying the product rule there.
7. Delete this card in the implementation PR; evidence belongs in that PR.

## UX contract

| Flow | Trigger and steps | Success | Failure / edge |
| --- | --- | --- | --- |
| Compare training change | Open Progress → Muscle → 3D; choose Sets or Volume | Largest gain darkest; intermediate gains/losses proportional | Empty/unavailable neutral; activity with no change middle |
| Change scope | Change period or secondary-set filter | Figures and extrema use the same comparison rows, across all gyms | All-loss/all-gain views retain zero at the middle anchor; table gym choice cannot leak |
| Inspect a muscle | Rotate, tap or select with VoiceOver | Existing Now/Prev/Change and contour; scale unchanged | Untracked anatomy stays neutral; no legend appears |

## Gates and handoff

- Execute with the task-protocol skill and the current `AGENTS.md` load list;
  read the training metrics contract before touching these figures.
- Start with `./boga test for`; agree the lane set with an independent reviewer.
  Run `./boga test fast`, `./boga test jest-coverage`, `./boga test complexity`
  and `./boga test dependencies` to green before opening the implementation PR.
- UI default: `frontend-ui` on macOS / `frontend-android` on Linux. Run only
  relevant device flows, or obtain reviewer agreement for `covered-by-jest`
  plus native visual evidence. New Maestro flows need written justification.
- Obtain separate code and product reviews; highlight
  `comparison.colour-scale` on the implementation PR's Product facts line.
  Wait for green CI and the user's approval of that PR before merging.
  Stop the stack at PR opening and release the worktree after confirmed merge.
