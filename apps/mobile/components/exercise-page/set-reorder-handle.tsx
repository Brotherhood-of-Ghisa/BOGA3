import { Pressable, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { ReduceMotion, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { uiGeometry, uiRoles } from '@/components/ui/tokens';

type SetReorderHandleProps = {
  /** The set the handle drags, for the gesture's closures. */
  setId: string;
  setNumber: number;
  onDragStart: (setId: string) => void;
  /** The pointer's window Y while the drag moves; the screen makes it local. */
  onDragPointer: (absoluteY: number) => void;
  onDragEnd: (setId: string, committed: boolean) => void;
  testID?: string;
};

/**
 * The set row's grab handle — the recorder reorder's only persistent chrome
 * (the lightweight playlist-style ordered-row pattern). The drag lives on the
 * handle, so it cannot steal taps from the row's fields or fight the open
 * row's removal swipe; the glyph is quiet while the 44pt target stays. The
 * lift animates unless the system's reduced-motion setting suppresses it;
 * the interaction itself never changes.
 */
export function SetReorderHandle({ setId, setNumber, onDragStart, onDragPointer, onDragEnd, testID }: SetReorderHandleProps) {
  const lift = useSharedValue(0);
  const reducedMotion = useReducedMotion();
  const liftStyle = useAnimatedStyle(() => ({
    opacity: 0.5 + lift.value * 0.5,
    transform: [{ scale: 1 + lift.value * 0.2 }],
  }));

  const gesture = Gesture.Pan()
    .minDistance(2)
    .onStart(() => {
      'worklet';
      lift.value = withTiming(1, { duration: reducedMotion ? 0 : 120, reduceMotion: ReduceMotion.System });
      runOnJS(onDragStart)(setId);
    })
    .onUpdate((event) => {
      'worklet';
      runOnJS(onDragPointer)(event.absoluteY);
    })
    .onEnd((_, success) => {
      'worklet';
      lift.value = withTiming(0, { duration: reducedMotion ? 0 : 120, reduceMotion: ReduceMotion.System });
      runOnJS(onDragEnd)(setId, success);
    });

  return (
    <GestureDetector gesture={gesture}>
      <Pressable
        accessibilityHint="Touch and hold, then drag to move this set"
        accessibilityLabel={`Reorder set ${setNumber}`}
        accessibilityRole="button"
        style={styles.handle}
        testID={testID}>
        <Animated.View style={liftStyle}>
          <Icon color={uiRoles.inkFaint} name="drag-handle" />
        </Animated.View>
      </Pressable>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  handle: {
    width: uiGeometry.tapTarget,
    height: uiGeometry.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
