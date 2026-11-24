import { useCallback, useEffectEvent, useLayoutEffect, useState } from 'react';
import { usePanGesture, usePinchGesture, useSimultaneousGestures } from 'react-native-gesture-handler';
import { cancelAnimation, useAnimatedReaction, useSharedValue, withDecay } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import {
  clampTimelineStart, focusTimelineWindow, resizeTimelineWindow, stepTimelineZoom, timelineOverviewSpan, type TimelineWindow,
} from './timeline-window';

// Keep the moving viewport in week coordinates on the UI thread. React draws
// only the visible part of the timeline.
export function useTimelineZoom({ expanded, width, count, oldestWeek, focusedIndex }: {
  expanded: boolean; width: number; count: number; oldestWeek?: string; focusedIndex: number;
}) {
  const total = Math.max(1, count);
  const scope = `${expanded}/${width}/${oldestWeek}/${count}`;
  const overviewSpan = timelineOverviewSpan(total);
  const initial = focusTimelineWindow({ start: total - overviewSpan, span: overviewSpan }, focusedIndex, total);
  const [frame, setFrame] = useState({ scope, window: initial });
  const start = useSharedValue(initial.start);
  const span = useSharedValue(initial.span);
  const pinching = useSharedValue<{ window: TimelineWindow; anchor: number; focal: number } | null>(null);
  const panningFrom = useSharedValue<number | null>(null);

  if (scope !== frame.scope) setFrame({ scope, window: initial });
  const resetViewport = useEffectEvent(() => {
    cancelAnimation(start);
    panningFrom.set(null);
    pinching.set(null);
    start.set(initial.start);
    span.set(initial.span);
  });
  useLayoutEffect(() => { resetViewport(); }, [scope]);

  const publish = useCallback((gestureScope: string, next: TimelineWindow) => {
    setFrame(current => current.scope === gestureScope ? { scope: gestureScope, window: next } : current);
  }, []);
  useAnimatedReaction(() => ({ start: start.get(), span: span.get() }), (next, previous) => {
    if (expanded && (next.start !== previous?.start || next.span !== previous?.span)) scheduleOnRN(publish, scope, next);
  });

  const pinch = usePinchGesture({
    enabled: expanded && total > 1,
    onActivate: event => {
      'worklet';
      cancelAnimation(start);
      panningFrom.set(null);
      const window = { start: start.get(), span: span.get() };
      const focal = Math.max(0, Math.min(1, event.focalX / width));
      pinching.set({ window, anchor: window.start + focal * window.span, focal });
    },
    onUpdate: event => {
      'worklet';
      const origin = pinching.get();
      if (!origin || event.scale <= 0) return;
      const focal = Math.max(0, Math.min(1, event.focalX / width));
      const next = resizeTimelineWindow(total, origin.anchor, focal, origin.window.span / event.scale, false);
      pinching.set({ ...origin, focal });
      start.set(next.start);
      span.set(next.span);
    },
    onDeactivate: event => {
      'worklet';
      const origin = pinching.get();
      if (!origin) return;
      const next = event.canceled ? origin.window : resizeTimelineWindow(total, origin.anchor, origin.focal, span.get(), true);
      start.set(next.start);
      span.set(next.span);
      pinching.set(null);
    },
  });

  const pan = usePanGesture({
    enabled: expanded && total > 1,
    activeOffsetX: [-6, 6],
    failOffsetY: [-10, 10],
    maxPointers: 1,
    onActivate: () => {
      'worklet';
      if (pinching.get()) return;
      cancelAnimation(start);
      panningFrom.set(start.get());
    },
    onUpdate: event => {
      'worklet';
      const origin = panningFrom.get();
      if (origin === null || event.numberOfPointers !== 1) return;
      const shown = span.get();
      start.set(clampTimelineStart(origin - event.translationX / width * shown, shown, total));
    },
    onDeactivate: event => {
      'worklet';
      const origin = panningFrom.get();
      panningFrom.set(null);
      const shown = span.get();
      if (origin === null || event.canceled || shown >= total) return;
      start.set(withDecay({ velocity: -event.velocityX / width * shown, clamp: [0, total - shown] }));
    },
  });
  const gesture = useSimultaneousGestures(pan, pinch);
  const window = frame.scope === scope ? frame.window : initial;

  const apply = (next: TimelineWindow) => {
    cancelAnimation(start);
    start.set(next.start);
    span.set(next.span);
    setFrame({ scope, window: next });
  };
  const current = () => ({ start: start.get(), span: span.get() });
  return {
    gesture, window, maxSpan: total,
    zoom: (delta: -1 | 1) => apply(stepTimelineZoom(current(), total, focusedIndex, delta)),
    focus: (index: number) => apply(focusTimelineWindow(current(), index, total)),
    weekAt: (x: number) => {
      // Use the painted frame so a tap while the plot is coasting hits the
      // week the user sees, even if the UI thread has already advanced.
      const index = Math.floor(window.start + x / width * window.span);
      apply(window);
      return Math.min(total - 1, Math.max(0, index));
    },
  };
}
