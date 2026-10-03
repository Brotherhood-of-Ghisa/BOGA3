import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { uiGeometry, uiRoles } from '@/components/ui/tokens';

// A drag claims the gesture only past this horizontal distance, and only
// before the row has moved this far vertically — scrolling always wins.
const ACTIVATION_DISTANCE = 24;
const FAIL_VERTICAL = 10;
// Past either trigger the release fires; a fling fires it earlier.
const MAX_DRAG = 88;
const TRIGGER_DISTANCE = 56;
const TRIGGER_VELOCITY = 500;

type SwipeSetRowProps = {
  children: ReactNode;
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
  testID?: string;
};

/**
 * The swipe shell of the in-progress set (`ux-rules.md` §14a.3): drag the row
 * right to confirm it and move on, left to drop its entry. The shell only
 * animates and reports the direction — the semantics live in the screen's
 * handlers, so nothing here can navigate or change set state. Vertical
 * scrolling wins before activation; the tap controls (the row body, the
 * glyph, the logger's tick) keep working, and the accessibility actions are
 * the non-gesture path.
 */
export function SwipeSetRow({ children, onSwipeRight, onSwipeLeft, testID }: SwipeSetRowProps) {
  const drag = useSharedValue(0);

  const pan = Gesture.Pan()
    .activeOffsetX([-ACTIVATION_DISTANCE, ACTIVATION_DISTANCE])
    .failOffsetY([-FAIL_VERTICAL, FAIL_VERTICAL])
    .onUpdate((event) => {
      'worklet';
      drag.value = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, event.translationX));
    })
    .onEnd((event) => {
      'worklet';
      const { translationX, velocityX } = event;
      const right = translationX > 0 && (translationX > TRIGGER_DISTANCE || velocityX > TRIGGER_VELOCITY);
      const left = translationX < 0 && (-translationX > TRIGGER_DISTANCE || -velocityX > TRIGGER_VELOCITY);
      drag.value = withTiming(0, { duration: 120 });
      if (right) runOnJS(onSwipeRight)();
      else if (left) runOnJS(onSwipeLeft)();
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
      <Animated.View pointerEvents="none" style={[styles.underlay, styles.underlayRight, rightStyle]}>
        <Icon color={uiRoles.accent} name="check" />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[styles.underlay, styles.underlayLeft, leftStyle]}>
        <Icon color={uiRoles.danger} name="x" />
      </Animated.View>
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
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  underlayRight: {
    backgroundColor: uiRoles.accentWash,
    paddingLeft: uiGeometry.tapTarget,
  },
  underlayLeft: {
    backgroundColor: uiRoles.paper,
    paddingRight: uiGeometry.tapTarget,
  },
});
