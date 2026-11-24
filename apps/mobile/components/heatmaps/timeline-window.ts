// A horizontal viewport in week coordinates. The start and span can be
// fractional during a gesture. Button steps and finished pinches show whole weeks.
export type TimelineWindow = { start: number; span: number };
export type TimelineWindowLimits = { count: number; maxSpan: number };

export function clampTimelineStart(start: number, span: number, count: number): number {
  'worklet';
  return Math.max(0, Math.min(start, count - span));
}

export function focusTimelineWindow(window: TimelineWindow, index: number, count: number): TimelineWindow {
  const { start, span } = window;
  if (index >= start && index + 1 <= start + span) return window;
  return { start: clampTimelineStart(Math.round(index - (span - 1) / 2), span, count), span };
}

export function resizeTimelineWindow(limits: TimelineWindowLimits, anchor: number, focalFraction: number,
  requestedSpan: number, settle: boolean): TimelineWindow {
  'worklet';
  const span = Math.max(1, Math.min(limits.maxSpan, settle ? Math.round(requestedSpan) : requestedSpan));
  const start = anchor - focalFraction * span;
  return { start: clampTimelineStart(settle ? Math.round(start) : start, span, limits.count), span };
}

export function stepTimelineZoom(window: TimelineWindow, limits: TimelineWindowLimits, index: number, delta: number): TimelineWindow {
  const selectedCenter = index + 0.5;
  const { start, span } = window;
  const focalFraction = selectedCenter >= start && selectedCenter < start + span ? (selectedCenter - start) / span : 0.5;
  return resizeTimelineWindow(limits, start + focalFraction * span, focalFraction, span + delta, true);
}
