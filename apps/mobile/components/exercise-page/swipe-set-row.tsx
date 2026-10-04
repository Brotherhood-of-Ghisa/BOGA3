import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { uiRoles } from '@/components/ui/tokens';

// A drag claims the gesture only past this horizontal distance, and only
// before the row has moved this far vertically — scrolling always wins.
const ACTIVATION_DISTANCE = 24;
const FAIL_VERTICAL = 10;
// Past either trigger the release fires; a fling fires it earlier.
const MAX_DRAG = 88;
const TRIGGER_DISTANCE = 56;
const TRIGGER_VELOCITY = 500;

export type SwipeDirections = { left: boolean; right: boolean };

/** The row's offset for a drag: capped at `MAX_DRAG`, and pinned at 0 towards a side that does nothing. */
export function clampSwipeDrag(translationX: number, directions: SwipeDirections): number {
  'worklet';
  const min = directions.left ? -MAX_DRAG : 0;
  const max = directions.right ? MAX_DRAG : 0;
  return Math.max(min, Math.min(max, translationX));
}

/** What a release fires: a side fires only when it is offered and the drag passed its trigger. */
export function swipeOutcome(
  translationX: number,
  velocityX: number,
  directions: SwipeDirections
): 'left' | 'right' | null {
  'worklet';
  if (directions.right && translationX > 0 && (translationX > TRIGGER_DISTANCE || velocityX > TRIGGER_VELOCITY)) {
    return 'right';
  }
  if (directions.left && translationX < 0 && (-translationX > TRIGGER_DISTANCE || -velocityX > TRIGGER_VELOCITY)) {
    return 'left';
  }
  return null;
}

// Only an offered side claims a horizontal drag; with none, the shell is inert.
const activeOffsetFor = ({ left, right }: SwipeDirections): number | [number, number] => {
  if (left && right) return [-ACTIVATION_DISTANCE, ACTIVATION_DISTANCE];
  return left ? -ACTIVATION_DISTANCE : ACTIVATION_DISTANCE;
};

type SwipeSetRowProps = {
  children: ReactNode;
  // Each side is offered only when its move would change the row
  // (`ux-rules.md` §14a.3): without a handler the row cannot be dragged that
  // way and the side's symbol never shows.
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  testID?: string;
};

/**
 * The swipe shell of the open set (`ux-rules.md` §14a.3): drag the row right
 * to confirm it and move on, left to drop it. The shell only animates and
 * reports the direction — the semantics live in the screen's handlers, so
 * nothing here can navigate or change set state. Vertical scrolling wins
 * before activation; the tap controls (the glyph, the logger's tick) keep
 * working, and the accessibility actions are the non-gesture path.
 */
export function SwipeSetRow({ children, onSwipeRight, onSwipeLeft, testID }: SwipeSetRowProps) {
  const drag = useSharedValue(0);
  const directions: SwipeDirections = { left: onSwipeLeft !== undefined, right: onSwipeRight !== undefined };

  const pan = Gesture.Pan()
    .enabled(directions.left || directions.right)
    .activeOffsetX(activeOffsetFor(directions))
    .failOffsetY([-FAIL_VERTICAL, FAIL_VERTICAL])
    .onUpdate((event) => {
      'worklet';
      drag.value = clampSwipeDrag(event.translationX, directions);
    })
    .onEnd((event) => {
      'worklet';
      const outcome = swipeOutcome(event.translationX, event.velocityX, directions);
      drag.value = withTiming(0, { duration: 120 });
      if (outcome === 'right' && onSwipeRight) runOnJS(onSwipeRight)();
      else if (outcome === 'left' && onSwipeLeft) runOnJS(onSwipeLeft)();
    });

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: drag.value }],
  }));
  const rightStyle = useAnimatedStyle(() => ({
    opacity: drag.value > 0 ? Math.min(1, drag.value / TRIGGER_DISTANCE) : 0,
  }));
  const leftStyle = useAnimatedStyle(() => ({
    opacity: drag.value < 0 ? Math.min(1, -drag.value / TRIGGER_DISTANCE) : 0,
  }));

  return (
    <View testID={testID}>
      {directions.right ? (
        <Animated.View pointerEvents="none" style={[styles.underlay, styles.underlayRight, rightStyle]}>
          <Icon color={uiRoles.accent} name="check" />
        </Animated.View>
      ) : null}
      {directions.left ? (
        <Animated.View pointerEvents="none" style={[styles.underlay, styles.underlayLeft, leftStyle]}>
          <Icon color={uiRoles.danger} name="x" />
        </Animated.View>
      ) : null}
      <GestureDetector gesture={pan}>
        <Animated.View style={contentStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  underlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: MAX_DRAG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  underlayRight: {
    left: 0,
    backgroundColor: uiRoles.accentWash,
  },
  underlayLeft: {
    right: 0,
    backgroundColor: uiRoles.paper,
  },
});
