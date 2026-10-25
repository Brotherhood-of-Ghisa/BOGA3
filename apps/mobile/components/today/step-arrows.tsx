import { Pressable, StyleSheet, View } from 'react-native';

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

function Arrow({ direction, onPress, label, testID }: { direction: 'left' | 'right'; onPress: (() => void) | null; label: string; testID: string }) {
  const disabled = onPress === null;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={HIT_SLOP[direction]}
      onPress={onPress ?? undefined}
      style={({ pressed }) => [styles.arrow, pressed && !disabled ? styles.pressed : null]}
      testID={testID}>
      <Icon color={disabled ? uiRoles.inkGhost : uiRoles.inkMuted} name={`chevron-${direction}`} size="sm" />
    </Pressable>
  );
}

/** `‹ ›`: older on the left, newer on the right, as time runs on Today's chart. */
export function StepArrows({ onOlder, onNewer, noun, testID }: StepArrowsProps) {
  return (
    <View style={styles.row} testID={testID}>
      <Arrow direction="left" label={`Previous ${noun}`} onPress={onOlder} testID={`${testID}-older`} />
      <Arrow direction="right" label={`Next ${noun}`} onPress={onNewer} testID={`${testID}-newer`} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ARROW_GAP,
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
