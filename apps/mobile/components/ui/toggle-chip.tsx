import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

export type ToggleChipOption<TValue extends string | number> = {
  value: TValue;
  label: string;
  accessibilityLabel?: string;
};

export type ToggleChipProps<TValue extends string | number> = {
  // Two options, or one when the screen has nothing to offer against it.
  options: readonly ToggleChipOption<TValue>[];
  value: TValue;
  onChange: (next: TValue) => void;
  // The filter's name, read before its value: `Stats breakdown`.
  accessibilityLabel: string;
  // `<testID>` on the chip, `<testID>-<value>` on its label.
  testID: string;
  style?: StyleProp<ViewStyle>;
};

// One filter of two values, showing the one in force; a tap swaps it for the
// other. A `SegmentedControl` shows both at once and is the default — this is
// for a row of filters that cannot afford six labels at phone width
// (`design-language.md` §4). The `swap` glyph says the tap replaces the value
// rather than opening anything. Drawn at `compactControlHeight`, its tap
// target kept at 44 by hit slop. A single option is inert and unglyphed.
export function ToggleChip<TValue extends string | number>({
  options,
  value,
  onChange,
  accessibilityLabel,
  testID,
  style,
}: ToggleChipProps<TValue>) {
  const index = Math.max(0, options.findIndex(option => option.value === value));
  const current = options[index];
  const next = options[(index + 1) % options.length];
  const inert = options.length < 2;
  const described = current.accessibilityLabel ?? current.label;

  return (
    <Pressable
      accessibilityLabel={inert
        ? `${accessibilityLabel}: ${described}.`
        : `${accessibilityLabel}: ${described}. Activate to show ${next.label}.`}
      accessibilityRole="button"
      accessibilityState={inert ? { disabled: true } : undefined}
      disabled={inert || undefined}
      hitSlop={(uiGeometry.tapTarget - uiGeometry.compactControlHeight) / 2}
      onPress={() => onChange(next.value)}
      style={({ pressed }) => [styles.chip, pressed && styles.chipPressed, style]}
      testID={testID}>
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={styles.label}
        testID={`${testID}-${current.value}`}>
        {current.label}
      </Text>
      {inert ? null : (
        <View accessible={false} style={styles.glyph}>
          <Icon color={uiRoles.inkMuted} name="swap" size="xs" />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // `flex: 1` with no basis: every chip in a row takes an equal share, so the
  // row reads as one control strip whichever values are in force.
  chip: {
    flex: 1,
    minWidth: 0,
    minHeight: uiGeometry.compactControlHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: uiSpace.xs,
    paddingHorizontal: uiSpace.sm,
    paddingVertical: uiSpace.xs,
    borderWidth: uiBorder.width,
    borderColor: uiRoles.rule,
    borderRadius: uiGeometry.radius.control,
    backgroundColor: uiRoles.surface,
  },
  chipPressed: {
    backgroundColor: uiRoles.paper,
  },
  label: {
    flexShrink: 1,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.ink,
  },
  glyph: {
    flexShrink: 0,
  },
});
