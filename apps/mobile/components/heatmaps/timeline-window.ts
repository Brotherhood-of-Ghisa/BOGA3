// A horizontal viewport in week coordinates. The start and span can be
// fractional during a gesture. Button steps and finished pinches show whole weeks.
export type TimelineWindow = { start: number; span: number };

const OVERVIEW_WEEKS = 52;
const WIDE_ZOOM_STEP = 13;

export const timelineOverviewSpan = (count: number): number => Math.max(1, Math.min(count, OVERVIEW_WEEKS));

export function clampTimelineStart(start: number, span: number, count: number): number {
  'worklet';
  return Math.max(0, Math.min(start, count - span));
}

export function focusTimelineWindow(window: TimelineWindow, index: number, count: number): TimelineWindow {
  const { start, span } = window;
  if (index >= start && index + 1 <= start + span) return window;
  return { start: clampTimelineStart(Math.round(index - (span - 1) / 2), span, count), span };
}

export function resizeTimelineWindow(count: number, anchor: number, focalFraction: number,
  requestedSpan: number, settle: boolean): TimelineWindow {
  'worklet';
  const span = Math.max(1, Math.min(count, settle ? Math.round(requestedSpan) : requestedSpan));
  const start = anchor - focalFraction * span;
  return { start: clampTimelineStart(settle ? Math.round(start) : start, span, count), span };
}

function steppedSpan(span: number, delta: -1 | 1): number {
  const weeks = Math.round(span);
  if (delta === 1) return weeks + (weeks >= OVERVIEW_WEEKS ? WIDE_ZOOM_STEP : 1);
  if (weeks > OVERVIEW_WEEKS) return Math.max(OVERVIEW_WEEKS, weeks - WIDE_ZOOM_STEP);
  return weeks - 1;
}

export function stepTimelineZoom(window: TimelineWindow, count: number, index: number, delta: -1 | 1): TimelineWindow {
  const selectedCenter = index + 0.5;
  const { start, span } = window;
  const focalFraction = selectedCenter >= start && selectedCenter < start + span ? (selectedCenter - start) / span : 0.5;
  return resizeTimelineWindow(count, start + focalFraction * span, focalFraction, steppedSpan(span, delta), true);
}
