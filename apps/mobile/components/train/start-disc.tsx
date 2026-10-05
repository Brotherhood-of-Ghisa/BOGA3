import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import {
  uiBorder,
  uiFonts,
  uiGeometry,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui/tokens';

export type StartDiscProps = {
  label: string;
  // A step smaller, to leave room for the planning section beneath it.
  compact?: boolean;
  // Presses are ignored (and announced busy) without the disc changing, so
  // nothing flickers while Train checks for a workout or opens one.
  busy?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  testID: string;
};

// The disc's diameter and the gap to its outer ring.
const DISC = 232;
const DISC_COMPACT = 204;
const RING_GAP = 16;

/**
 * Train's one action: an `accent` disc inside a thin ring, the screen's only
 * primary (`design-language.md` §5).
 */
export function StartDisc({
  label,
  compact = false,
  busy = false,
  onPress,
  accessibilityLabel,
  testID,
}: StartDiscProps) {
  const disc = compact ? DISC_COMPACT : DISC;
  const ring = disc + RING_GAP * 2;
  return (
    <View
      style={[styles.ring, { width: ring, height: ring }]}
      testID={`${testID}-ring`}>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ busy }}
        onPress={() => {
          if (!busy) onPress();
        }}
        style={({ pressed }) => [
          styles.disc,
          { width: disc, height: disc },
          pressed && !busy ? styles.discPressed : null,
        ]}
        testID={testID}>
        <Icon color={uiRoles.surface} name="play" size="lg" />
        <Text allowFontScaling={false} style={styles.label}>
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: uiGeometry.radius.pill,
    borderWidth: uiBorder.width,
    borderColor: uiRoles.rule,
  },
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: uiSpace.sm,
    borderRadius: uiGeometry.radius.pill,
    backgroundColor: uiRoles.accent,
  },
  // As the primary button: depth is never an elevation.
  discPressed: {
    opacity: 0.85,
  },
  label: {
    fontFamily: uiFonts.display.family,
    fontWeight: '800',
    fontSize: uiTypography.size.xxl,
    lineHeight: uiTypography.lineHeight.xxl,
    letterSpacing: uiTypography.size.xxl * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.surface,
  },
});
