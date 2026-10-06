# Accepted target — Progress history popup

**Status: implemented and verified.** Accepted by the operator on 2026-10-05
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
  **history popup container and dismissal** prescription. The [Progress target](progress.md)
  retains chart semantics; `components/stats/history-sheet.tsx` uses the
  feature-specific `components/stats/history-popup.tsx` shell.
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

## Implementation

The history shell fills the viewport below the top safe area, extends its
surface to the bottom and pads interactive content above the bottom inset.
Only the 44pt handle/title header owns the pan; controls and charts remain
outside it. An 8pt downward activation slop rejects upward motion, with a 12pt
horizontal failure range. Release dismisses at 120pt downward displacement,
or at 24pt with downward velocity at least 900pt/s; horizontal-dominant or
upward releases and cancelled gestures restore position. A new drag may
interrupt snap-back from its current position.

Exit/snap-back respect system reduced motion. Dismiss, escape, Back and
reachable backdrop use one guarded close; host focus returns after native
modal dismissal. Unmount cancels animation, and a new target opens at zero.
Other sheets retain their default geometry, keyboard and native-alert behavior.

## Rendered verification

Native captures at 375pt (iPhone SE) and 430pt (iPhone 15 Pro Max) compare
both kinds in Daily/Weekly, wrapped titles, loading, error/Retry and empty
states. The approved small viewport is 375pt; 320pt layout is covered by Jest.
The active Bone palette, existing chart geometry and repository microcopy
intentionally differ from the illustrative Plum graphic. Small screens scroll
the body to reach details/legend; the popup retains the full safe-area height.

The approved data-smoke scenario proves native short-drag restoration,
independent chart scrolling and actual header dismissal. Native accessibility
trees exclude underlying Progress controls. Jest proves dismissal actions,
escape/Back, focus after native close, cancellation and reduced motion;
this does not claim a manual VoiceOver traversal. Runtime captures and gate
logs stay in the normal gitignored Maestro artifacts tree, linked from the PR.
