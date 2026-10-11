import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { uiRoles } from '@/components/ui/tokens';

// A drag claims the gesture only past this horizontal distance, and only
// before the row has moved this far vertically — scrolling always wins.
const ACTIVATION_DISTANCE = 24;
const FAIL_VERTICAL = 10;
// Past the trigger the release fires; a fling fires it earlier. The row keeps
// moving past the trigger, but at `PAST_TRIGGER_RESISTANCE` of the finger, so
// the drag visibly hits a wall at the distance that fires it.
const TRIGGER_DISTANCE = 36;
const MAX_DRAG = 72;
const PAST_TRIGGER_RESISTANCE = 0.45;
const TRIGGER_VELOCITY = 500;
// The run-up's last fifth cross-fades the side's wash into its solid colour:
// the drag that fires the swipe is the drag where the side goes solid.
const LATCH_FADE = 0.2;
const MIN_SYMBOL_SCALE = 0.85;
const LATCH_SYMBOL_GROWTH = 0.15;

export type SwipeDirections = { left: boolean; right: boolean };

export type SwipeSide = 'left' | 'right';

/** The drag towards `side`, 0 or less when the finger went the other way. */
const towardsSide = (translationX: number, side: SwipeSide): number => {
  'worklet';
  return side === 'left' ? -translationX : translationX;
};

/**
 * The row's offset for a drag: the finger up to the trigger, resisted past it
 * to `MAX_DRAG`, and pinned at 0 towards a side that does nothing.
 */
export function clampSwipeDrag(translationX: number, directions: SwipeDirections): number {
  'worklet';
  const side: SwipeSide = translationX < 0 ? 'left' : 'right';
  if (!directions[side]) return 0;
  const distance = towardsSide(translationX, side);
  if (distance <= 0) return 0;
  const offset =
    distance <= TRIGGER_DISTANCE
      ? distance
      : Math.min(MAX_DRAG, TRIGGER_DISTANCE + (distance - TRIGGER_DISTANCE) * PAST_TRIGGER_RESISTANCE);
  return side === 'left' ? -offset : offset;
}

/** What a release fires: a side fires only when it is offered and the drag passed its trigger. */
export function swipeOutcome(
  translationX: number,
  velocityX: number,
  directions: SwipeDirections
): SwipeSide | null {
  'worklet';
  if (directions.right && translationX > 0 && (translationX > TRIGGER_DISTANCE || velocityX > TRIGGER_VELOCITY)) {
    return 'right';
  }
  if (directions.left && translationX < 0 && (-translationX > TRIGGER_DISTANCE || -velocityX > TRIGGER_VELOCITY)) {
    return 'left';
  }
  return null;
}

/**
 * How a side draws itself for a row offset (`clampSwipeDrag`'s result, not the
 * raw finger): the `wash` and `solid` layers' opacities and the symbol's
 * scale. The two layers cross-fade over the run-up's last fifth, so the row
 * reads "release now" exactly from the trigger on, and nothing before it.
 */
export function swipeSideVisual(
  drag: number,
  side: SwipeSide
): { wash: number; solid: number; scale: number } {
  'worklet';
  const distance = towardsSide(drag, side);
  if (distance <= 0) return { wash: 0, solid: 0, scale: MIN_SYMBOL_SCALE };
  const progress = Math.min(1, distance / TRIGGER_DISTANCE);
  // Exactly 1 from the trigger on, so the latched look never depends on how
  // the division rounded.
  const latch =
    distance >= TRIGGER_DISTANCE ? 1 : Math.max(0, (progress - (1 - LATCH_FADE)) / LATCH_FADE);
  return {
    wash: (0.5 + 0.5 * progress) * (1 - latch),
    solid: latch,
    scale: MIN_SYMBOL_SCALE + (1 - MIN_SYMBOL_SCALE) * progress + LATCH_SYMBOL_GROWTH * latch,
  };
}

// Only an offered side claims a horizontal drag; with none, the shell is inert.
const activeOffsetFor = ({ left, right }: SwipeDirections): number | [number, number] => {
  if (left && right) return [-ACTIVATION_DISTANCE, ACTIVATION_DISTANCE];
  return left ? -ACTIVATION_DISTANCE : ACTIVATION_DISTANCE;
};

/**
 * One side under the row: its wash with the role-coloured symbol while the
 * drag is short, its solid colour under a white symbol from the trigger on.
 * The switch is the gesture's only commit signal, so it lands exactly where
 * `swipeOutcome` starts firing.
 */
function SwipeUnderlay({ drag, side, testID }: { drag: SharedValue<number>; side: SwipeSide; testID?: string }) {
  const washStyle = useAnimatedStyle(() => ({ opacity: swipeSideVisual(drag.value, side).wash }));
  const solidStyle = useAnimatedStyle(() => ({ opacity: swipeSideVisual(drag.value, side).solid }));
  const symbolStyle = useAnimatedStyle(() => ({
    transform: [{ scale: swipeSideVisual(drag.value, side).scale }],
  }));
  const name = side === 'left' ? 'x' : 'check';
  const isLeft = side === 'left';
  return (
    <View
      pointerEvents="none"
      style={[styles.underlay, isLeft ? styles.underlayLeft : styles.underlayRight]}
      testID={testID}>
      <Animated.View style={[styles.layer, isLeft ? styles.washLeft : styles.washRight, washStyle]} />
      <Animated.View style={[styles.layer, isLeft ? styles.solidLeft : styles.solidRight, solidStyle]} />
      {/* The symbol sits in the outer `TRIGGER_DISTANCE` of the slot, so the
          whole glyph is clear of the row by the drag that fires the swipe. */}
      <View
        style={[styles.symbolSlot, isLeft ? styles.symbolSlotLeft : styles.symbolSlotRight]}
        testID={testID ? `${testID}-symbols` : undefined}>
        <Animated.View style={[styles.symbol, symbolStyle, washStyle]}>
          <Icon color={isLeft ? uiRoles.danger : uiRoles.accent} name={name} />
        </Animated.View>
        <Animated.View style={[styles.symbol, symbolStyle, solidStyle]}>
          <Icon color={uiRoles.surface} name={name} />
        </Animated.View>
      </View>
    </View>
  );
}

type SwipeSetRowProps = {
  children: ReactNode;
  // Each side is offered only when its move would change the row
  // (`ux-rules.md` "Swipes on the exercise page"):
  // without a handler the row cannot be dragged that way and the side's
  // symbol never shows.
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  testID?: string;
};

/**
 * The swipe shell of a set row (`ux-rules.md` "Swipes on the exercise page"):
 * drag the row right to confirm it and move on, left to drop it. The shell
 * only animates and reports the direction — the semantics live in the screen's
 * handlers, so nothing here can navigate or change set state. Vertical
 * scrolling wins before activation; the tap controls (the glyph, the logger's
 * tick) keep working, and the accessibility actions are the non-gesture path.
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

  return (
    <View testID={testID}>
      {directions.right ? (
        <SwipeUnderlay drag={drag} side="right" testID={testID ? `${testID}-right` : undefined} />
      ) : null}
      {directions.left ? (
        <SwipeUnderlay drag={drag} side="left" testID={testID ? `${testID}-left` : undefined} />
      ) : null}
      <GestureDetector gesture={pan}>
        {/* Opaque, so a side shows only in the gap the drag opens and never
            through the row itself. */}
        <Animated.View style={[styles.content, contentStyle]}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    backgroundColor: uiRoles.surface,
  },
  underlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: MAX_DRAG,
  },
  underlayRight: {
    left: 0,
  },
  underlayLeft: {
    right: 0,
  },
  // The wash and the solid ground fill the same slot and cross-fade.
  layer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  symbolSlot: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: TRIGGER_DISTANCE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  symbolSlotRight: {
    left: 0,
  },
  symbolSlotLeft: {
    right: 0,
  },
  // The two symbols share the slot's centre, one per ground.
  symbol: {
    position: 'absolute',
  },
  washRight: {
    backgroundColor: uiRoles.accentWash,
  },
  washLeft: {
    backgroundColor: uiRoles.paper,
  },
  solidRight: {
    backgroundColor: uiRoles.accent,
  },
  solidLeft: {
    backgroundColor: uiRoles.danger,
  },
});
