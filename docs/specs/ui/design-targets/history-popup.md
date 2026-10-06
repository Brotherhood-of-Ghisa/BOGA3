# Accepted target — Progress history popup

**Status: implemented; container and dismissal amended.** Accepted by the
operator on 2026-10-05 after reviewing the popup-only graphic below. On
2026-10-06 the operator moved history onto the shared sub-page sheet
(`ux-rules.md` "Sheets"): the "Amended container" section below overrides the
graphic and the Brief on container and dismissal; content is unchanged. This is a target for the window
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
  **history popup container and dismissal** prescription. The [Progress target](progress.md)
  retains chart semantics; `components/stats/history-sheet.tsx` renders in the
  shared `components/ui/page-sheet.tsx`.
- [Design language](../design-language.md), [UI rules](../ux-rules.md)
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
  saved chart/window and legend. For the metric control's theme-colour amendment
  and the Daily chart, load the accepted
  [daily calendar target](daily-history-calendar.md); it supersedes this
  graphic’s older horizontal grid and selected-day detail. Weekly keeps its bar
  chart and selected-week banner.
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

## Amended container (2026-10-06)

- History is a `PageSheet`: the native iOS page sheet the exercise picker uses,
  still in-route state. The screen behind recedes into a card above it, so the
  sheet sits a little below the safe area rather than filling it.
- The header is the shared sub-page header: grabber, the `Muscle History` /
  `Exercise History` eyebrow, the name (wrapping to two lines) and an X. The
  `Swipe down to dismiss` hint is gone.
- Swiping down closes it from the header, or from the body when it is at the
  top. Charts keep their own body scroll and the metric control keeps its taps. The X, Android Back and the VoiceOver escape close
  it too.
- Progress clears its target and restores focus once the native sheet has
  gone (`HistorySheet` `onDismiss`).

## Rendered verification

The data-smoke scenario proves a short header drag snapping back, independent
chart scrolling and swipe dismissal in the page sheet. Jest
(`ui-page-sheet.test.tsx`, `weekly-history-bars.test.tsx`, the stats suites)
proves the X, Back, swipe-once reporting and focus after native close.
Runtime captures and gate logs stay in the gitignored Maestro artifacts tree,
linked from the PR.
