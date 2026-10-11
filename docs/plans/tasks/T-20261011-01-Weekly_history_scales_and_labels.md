# T-20261011-01 — Weekly history scales and aligned labels

- Status: `planned`
- Issue: [#683 — Weekly heatmap labels all over the place](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/683)
- Depends on: none; milestone: none
- Areas: frontend; UI impact: yes
- Planning branch: `codex/plan-683-weekly-heatmap`
- This branch contains the proposal only. No implementation or tests run;
  the operator explicitly deferred testing until implementation.

## Objective

Make Weekly history's scale, numeric axis labels and reference lines agree
for every metric, on exercise and muscle history. Keep the scale readable
around typical strength readings without distorting set-count proportions.
Implement as one focused PR after the open Volume choice is settled.

## Evidence and scope

[PR #675](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/675) restored the
observed-range mapper for all metrics and updated [[comparison.weekly-reference]].
Current axis labels start at the minimum/midpoint coordinate while the maximum
is right-aligned; their text centres do not share the plotted coordinates.
The issue's two screenshots are the visual references for the reported states.

The top axis numbers are minimum/midpoint/maximum, distinct from the dashed
percentile references. Sets already draws only the median. Code inspection
found standard sorted-value interpolation, not evidence of a percentile
calculation defect; the screenshots do not expose the complete population.

Change reach:

- `apps/mobile/components/heatmaps/WeeklyHeatmap.tsx`: metric-specific scale,
  axis annotations and reference positioning.
- `apps/mobile/components/stats/history-view.tsx`: the shared exercise/muscle
  caller, if explicit metric identity is needed; use the existing
  `CalendarHeatmapMetric` rather than new labels or a configuration system.
- Existing Weekly Jest suites and their fixtures, particularly
  `apps/mobile/__tests__/weekly-history-bars.test.tsx` and
  `apps/mobile/__tests__/heatmap-marks.test.tsx`.
- The owning fact and component documentation during implementation.

Keep aggregation, eligibility, percentile interpolation, colour/target grading,
PR counts, week navigation and virtualization. No schema, sync, dependencies,
new chart view or new Maestro flow. Reuse the local text-measurement and
centring approach in
`apps/mobile/components/session-complete/exercise-volume-card.tsx` without
introducing a shared chart framework.

## Decided

| Metric | Proposed scale | Reference lines | Decision |
| --- | --- | --- | --- |
| Sets | Linear zero to the selected window's maximum | Median at its actual scaled position | Agreed; physical centring may be dropped |
| 1RM / Top weight | One symmetric linear range around the median, with padding below the minimum reading | P25 / median at 50% / P75 | Agreed |
| Volume | Linear zero to the selected window's maximum | P25 / median at its actual scaled position / P75 | Proposed; confirm the centring exception |

All bars, axis coordinates and reference lines for a metric use the same
mapping. Numeric annotation text is centred over its coordinate where it fits;
boundary placement stays within the plot. Resolve overlap without moving the
underlying marks. Reference identities and full formatted values remain
accessible; do not add a visible percentile-label stack or explanatory copy.

### Strength scale

For eligible weekly observations, let `a` be the minimum, `m` the median,
and `b` the maximum. Compute `m` even when the sample is too short to display
references. Use this agreed mapping (fractions of chart width):

```text
r = max(m - 0.9 * a, b - m)
lower = m - r
upper = m + r
position(y) = 0.5 + 0.5 * (y - m) / r
```

Median is always at 50%; every eligible observation fits. The lower boundary
is at or below 90% of the minimum reading. This is a margin in measurement
units, not a promise that the minimum bar occupies 10% of the chart.
The maximum need not occupy 100%: unused space preserves symmetry. P25/P75
use their calculated values, never fixed 25%/75% chart positions.

| Minimum / median / maximum | Scale bounds | Their positions |
| --- | --- | --- |
| 100 / 110 / 120 | 90 / 130 | 25% / 50% / 75% |
| 100 / 110 / 150 | 70 / 150 | 37.5% / 50% / 100% |
| 100 / 100 / 100 | 90 / 110 | All at 50% |

The originally suggested `(y - 0.9*a) / (b - 0.9*a)` would put the median of
100/110/120 at 66.7%, so it cannot guarantee centring.
Use overflow-safe arithmetic for finite extremes. Empty/all-zero series draw
no fill and an axis of zero, with no references, rather than dividing by zero.
A strongly skewed strength series can produce a negative lower boundary;
that is scale space, not a fabricated negative observation. Do not silently
clamp it and lose median centring.

### Population and presentation invariants

Keep [[comparison.history-window]] and the population/cutoff portions of
[[comparison.weekly-reference]]: known training weeks, genuine zeros included;
rest/future/unavailable excluded; six observations and positive maximum before
references appear. Calculate positions at full precision and format only the
labels. Equal quartiles retain their exact coincident positions and accessible
identities. Keep [[copy.blank-history]]: a genuine zero stays numeric with no
filled bar; rest and unavailable figures stay blank and distinguishable in
accessibility.

## Open — resolve before implementation

Confirm whether Volume may drop physical median centring like Sets. The
recommendation is zero-to-maximum because Volume can be strongly skewed and
proportional lengths remain meaningful. If the operator keeps Volume centred,
settle its mapping explicitly; do not silently introduce asymmetric/nonlinear
scaling or clipping.

## UX contract and design target

Design target: this repo-native brief, with the issue's 1RM and Volume
screenshots as references for the reported failure. The accepted target is the
scale table once the Volume choice is resolved, the strength examples, and
aligned, readable annotations on small and standard iPhones.

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Compare weekly metrics | Open exercise history, choose Weekly, switch all four metrics | Agreed scale and reference set; labels match marks; taps still open the week's sessions | Clustered, skewed, constant, short, zero, unavailable and empty histories stay finite and readable |
| Read muscle history | Open muscle history, choose Weekly, switch Sets and Volume | Same rules as exercise history; fractional set counts and target colours retained | Long values and narrow plots do not overlap labels or adjacent columns |
| Change history window | Change History look-back and return to Weekly | Scale and references recompute from the same selected population | Older outliers disappear when excluded; partial current week follows the existing rule |

Capture fresh screenshots for each metric on small and standard iPhones;
compare them with the accepted brief and source screenshots. Include clustered
strength values, skewed Sets/Volume, a constant strength series and empty/zero
states. Put visual evidence and any material deviations in the implementation
PR, not this disposable card.

## Deliverables and acceptance

1. Implement the agreed scale table in the existing Weekly component, with
   identical coordinate mapping for bar endpoints, axis ticks and references.
2. Centre and bound numeric annotations using actual layout, with deterministic
   collision handling. The strength centre label is its median, not merely the
   arithmetic midpoint of observed minimum and maximum.
3. Verify percentile values and positions through the real adapter and existing
   helper; change the calculation only if a failing case proves a defect.
4. Extend Jest coverage for both history kinds and all metrics: positive-minimum
   Sets, fractional muscle counts, clustered and skewed values, constant values,
   short samples, genuine zeros, rest/unavailable/future weeks, saved-window
   changes, coincident quartiles, rounding, and finite extreme values.
5. Test measured label bounds at narrow/standard plot widths, long formatted
   values and metric switching. Retain navigation, PR and colour regressions.
6. Complete native screenshot review; percentage-style assertions alone do not
   prove rendered text alignment or non-overlap.
7. Update the owning fact with the approved metric-specific rules, run code and
   product reviews, and delete this card in the implementation PR.

## Docs to update during implementation

- `docs/product/comparison.md`: revise [[comparison.weekly-reference]] for the
  approved scale rules; this proposal does not change the accepted fact yet.
- `apps/mobile/components/heatmaps/README.md` and the component header: the
  annotation behaviour and current implementation pointers.
- If a shared UI semantic changes, load and update
  `docs/specs/ui/ux-rules.md` under the UI documentation maintenance rules.

## Gates — implementation only

Operator agreed: `./boga test fast`, `./boga test ios-data-smoke`,
`./boga test jest-coverage`, `./boga test complexity`, and
`./boga test dependencies`. Run `./boga test for` on the finished diff and
reconfirm only if scope requires a different set. The default `frontend-ui`
is narrowed to the existing history-navigation lane; Jest proves arithmetic
and native captures prove label rendering. No new Maestro scenario is approved.

Before editing tests, load their directory's README. Record gate results and
visual evidence in the PR, measure any quoted durations through `./boga timings`,
and run `docs/product/REVIEW.md` alongside code review. No test or gate runs on
this planning branch, per the operator's explicit instruction.
