# Accepted target — weekly history bars

Target record per [AI-assisted design policy](../ai-design-policy.md).
**Accepted; awaiting implementation.** The operator selected Product Design
option 3 on 2026-10-05, retained Settings as the Daily/Weekly selector, and
approved the revised selected-week state after removing the tap-instruction
sentence. This record guides the weekly redesign; current runtime behavior
remains documented in `../ux-rules.md` until the implementation ships.

## Target

- [Accepted selected-week screenshot](weekly-history-bars/selected-week.png):
  final Product Design revision dated 2026-10-05. Only this accepted image is
  retained; alternative concepts and generated implementations stay outside
  the repository.
- Mobile portrait, nominal **390 × 844pt**, light Warm theme. The generated
  raster illustrates the viewport; integrated captures must use the matching
  logical viewport and state for comparison.
- Vocabulary: [design language](../design-language.md) and existing
  `apps/mobile/components/ui/` tokens/primitives. The mock's figures are
  illustrative, anchored to Monday 5 October 2026; dates and values in the app
  come from its loaded history.

## Brief

- Keep the existing in-route history sheet over the dimmed parent: target
  eyebrow/name, Metric selector and Settings-owned read-only view/window
  caption. Daily/Weekly and look-back are changed only in Settings.
- Render one horizontal bar per local Monday-start week, stacked vertically
  with the most recent week on top. Scroll down for older weeks through the
  entire saved look-back, including short windows and the supported maximum.
- Use a left date gutter, shared central plot and right-aligned formatted
  metric values. Bar **length** is proportional to the value on a common
  zero-based scale; the plot's zero/midpoint/maximum axis adapts to the metric.
  Use existing display formatting/units, never the mock's fixed 0/30/60 values.
- Keep the `viz` ramp and its existing bucket/target meaning. Length and colour
  are independent: muscle Sets colour still expresses target attainment while
  length shows the displayed working-set count.
- The existing recent 12-week average becomes a dashed **vertical** reference
  on that same scale, with an explicit formatted average label. Keep its
  eligibility rule: at least six known training weeks among the most recent
  twelve; include genuine zero training, exclude rest and unavailable weeks.
- Show rest as `Rest` with no filled bar, known-zero training as numeric zero,
  and unknown/incomplete metrics with their existing availability/coverage
  wording. Retain tappable/accessibly labelled rows for each state. Guard empty,
  zero-only and identical-value windows against invalid chart geometry.
- The current week has its existing 1px ink outline plus `Current week` label;
  the selected week has a 2px ink outline, small caret and selected accessibility
  state. Both meanings remain visible when the current week is selected.
- Tapping a row selects it and shows its full date range and metric value in
  the existing band above the chart. Tapping it again clears selection.
  Unselected state has no instruction or empty band. Remove both
  `Tap a week to select it` and the older `Tap a week to see details` copy.
- Stay in the same sheet during selection; no session drilldown is introduced.
  Backdrop tap, Android back and VoiceOver escape dismiss it while preserving
  the parent browsing state. No new close button or drag gesture is part of
  this target.
- Keep row targets at least 44pt. Use existing type/spacing/radius tokens;
  retain legibility of dates and values on small phones without horizontal
  overflow. The sheet owns vertical scrolling.

## Authority and integration differences

- This brief and the existing repository contracts govern metric calculations,
  formatting, available controls, look-back, accessibility and dismissal. The
  image governs visual hierarchy, orientation, alignment and selection marks.
- The image omits main's read-only saved view/window caption; preserve it in
  integration. The illustrative average is not derivable from only the eight
  visible rows: the real average uses the most recent twelve loaded weeks.
- Zero-based bar length intentionally replaces the current observed-range
  height normalization. Update the owning weekly-chart semantics when shipping;
  do not change colour buckets or metric aggregation to imitate the image.
- The mock's header/background chrome is contextual; retain the actual parent
  screen chrome rather than recreating invented background content.

## States and visual verification

The accepted screenshot shows exercise history, Sets, newest/current week
`5–11 Oct` with value `12`, selected prior week `28 Sep–4 Oct 2026` with `54`
sets, a rest week and the average reference. Implementation verification also
covers unselected, current-selected, muscle history, other metrics, unavailable/
incomplete and known-zero data, loading/error/empty states, saved Daily view,
short/long look-back and small/large phones.

Capture the integrated selected state at the target viewport and compare the
reference and runtime image together. Runtime captures remain in the ignored
`apps/mobile/artifacts/maestro/` tree and are linked as PR evidence. Record
material differences here when the implementation is accepted.
