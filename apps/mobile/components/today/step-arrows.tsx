import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type Insets } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';

export type StepArrowsProps = {
  /** Steps back in time: an older session, an earlier period. Null when there is none. */
  onOlder: (() => void) | null;
  /** Steps forward in time, toward the latest. Null at the latest. */
  onNewer: (() => void) | null;
  /** What one step moves to, for the spoken labels: `session`, `period`. */
  noun: string;
  testID: string;
};

// A glyph-sized pair: the row they sit in stays a micro-label's height, and
// the hit slop takes each tap target to the 44pt minimum, reaching outward
// only, so the two never overlap.
const ARROW_WIDTH = 32;
const ARROW_HEIGHT = 20;
const ARROW_GAP = uiSpace.xs;
const VERTICAL_SLOP = (uiGeometry.tapTarget - ARROW_HEIGHT) / 2;
const OUTER_SLOP = uiGeometry.tapTarget - ARROW_WIDTH - ARROW_GAP / 2;
const HIT_SLOP = {
  left: { top: VERTICAL_SLOP, bottom: VERTICAL_SLOP, left: OUTER_SLOP, right: ARROW_GAP / 2 },
  right: { top: VERTICAL_SLOP, bottom: VERTICAL_SLOP, left: ARROW_GAP / 2, right: OUTER_SLOP },
};

type ArrowDirection = 'left' | 'right' | 'up' | 'down';

/** One step arrow, disabled (ghost ink) when `onPress` is null; up and down pass their own reach. */
export function StepArrow({
  direction,
  onPress,
  label,
  testID,
  hitSlop,
}: {
  direction: ArrowDirection;
  onPress: (() => void) | null;
  label: string;
  testID: string;
  hitSlop?: Insets;
}) {
  const disabled = onPress === null;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={hitSlop ?? (direction === 'left' || direction === 'right' ? HIT_SLOP[direction] : undefined)}
      onPress={onPress ?? undefined}
      style={({ pressed }) => [styles.arrow, pressed && !disabled ? styles.pressed : null]}
      testID={testID}>
      <Icon color={disabled ? uiRoles.inkGhost : uiRoles.inkMuted} name={`chevron-${direction}`} size="sm" />
    </Pressable>
  );
}

/**
 * `‹ label ›`: the arrows either side of what they step (a date, a range),
 * older on the left. Each keeps its 44pt reach outward, away from the label.
 */
export function StepAround({ onOlder, onNewer, noun, testID, children }: StepArrowsProps & { children: ReactNode }) {
  return (
    <View style={styles.around} testID={testID}>
      <StepArrow direction="left" label={`Previous ${noun}`} onPress={onOlder} testID={`${testID}-older`} />
      <View style={styles.aroundLabel}>{children}</View>
      <StepArrow direction="right" label={`Next ${noun}`} onPress={onNewer} testID={`${testID}-newer`} />
    </View>
  );
}

const styles = StyleSheet.create({
  around: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  aroundLabel: {
    flexShrink: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  arrow: {
    width: ARROW_WIDTH,
    height: ARROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: uiGeometry.radius.control,
  },
  pressed: {
    backgroundColor: uiRoles.paper,
  },
});
