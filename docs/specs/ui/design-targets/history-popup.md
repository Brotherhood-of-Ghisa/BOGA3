# Accepted target — Progress history popup

**Status: pending implementation.** Accepted by the operator on 2026-10-05
after reviewing the popup-only graphic below. This is a target for the window
opened by an individual muscle name or exercise row in Progress, not a redesign
of Progress tables, exercise browsing or the heatmaps themselves.

## Target and authority

- Source: Product Design / ImageGen proposal in the current design conversation,
  revised to show only the shared popup in muscle and exercise states.
- Selected revision: `exec-f8d91861-4b36-4727-8305-43dc2a5e1e82`, accepted with
  “Yes matches.” [Accepted reference](history-popup/reference.png).
- Reference dimensions: 1191 × 1320 pixels; a design board showing two phone
  content viewports of approximately 390 × 844 logical points. Board captions
  and the bottom explanatory annotation are not application UI.
- This target replaces the old [Progress target](progress.md)'s three-quarter
  **history popup container and dismissal** prescription when implemented.
  Current behavior remains documented in [UI rules](../ux-rules.md) §12 until
  the implementation updates it. Other parts of the older target still apply.
- [Design language](../design-language.md), [UI rules](../ux-rules.md) §11–§13
  and [design policy](../ai-design-policy.md) govern production tokens,
  accessibility, chart/data semantics and integration.

## Brief

- Both existing history entry points use the same full-height in-route modal,
  respecting safe areas and covering the available content viewport.
- A real downward drag from the handle or non-interactive title/header area
  follows the finger, dismisses on a qualifying release, and snaps back if the
  gesture is insufficient or cancelled. No intermediate snap heights.
- No visible Close, X, Cancel, Done or Back control. Keep the small handle and
  the subtle `Swipe down to dismiss` hint; accessible dismissal and system
  Back/VoiceOver escape remain available without a physical swipe.
- Preserve the current heading, saved view/window label, metric control,
  daily/weekly heatmap, selected detail/week banner and legend. Daily history
  remains a seven-row horizontally scrollable grid; Weekly keeps its bar chart.
- Keep surrounding Progress state and every other sheet's default behavior.
  Use the active theme; Plum in the reference is one example, not a palette
  change. Sample names, dates, values and cell counts are illustrative, not data
  fixtures or new visualization specifications.

## Accepted states and required verification

The selected graphic shows fully open **Chest / Muscle History** and
**Barbell Romanian Deadlifts / Exercise History** in Daily mode. The second
example also demonstrates a wrapped title and four metric options.

Runtime acceptance additionally needs both popup kinds in saved Weekly mode,
small/large iPhone layouts, loading, retryable error, no history, short/cancelled
drag, actual drag dismissal, chart/body scroll independence, reduced motion and
accessible dismissal/focus return. Capture and compare new app screenshots at
the corresponding viewport; document material differences and intentional
deviations in the implementation PR. This static concept is not runtime or
gesture-test evidence.
