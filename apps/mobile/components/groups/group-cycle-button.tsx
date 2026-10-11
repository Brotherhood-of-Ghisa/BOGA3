import { Pressable, StyleSheet, Text } from 'react-native';

import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';

export type GroupCycleOption<TValue extends string> = { value: TValue; label: string };

/**
 * One filter as a single pill showing its current option; a tap moves to the
 * next option, wrapping. Several sit side by side on one row (`flex: 1`).
 * `testID` on the pill; VoiceOver reads `<accessibilityLabel>, <option>`.
 */
export function GroupCycleButton<TValue extends string>({ options, value, onChange, accessibilityLabel, testID }: {
  options: readonly GroupCycleOption<TValue>[];
  value: TValue;
  onChange: (next: TValue) => void;
  accessibilityLabel: string;
  testID: string;
}) {
  const index = Math.max(0, options.findIndex(option => option.value === value));
  const current = options[index];
  const next = options[(index + 1) % options.length];
  return (
    <Pressable
      accessibilityHint={next && next.value !== current?.value ? `Changes to ${next.label}` : undefined}
      accessibilityLabel={`${accessibilityLabel}, ${current?.label ?? ''}`}
      accessibilityRole="button"
      disabled={options.length < 2}
      hitSlop={uiSpace.xs}
      onPress={() => { if (next) onChange(next.value); }}
      style={({ pressed }) => [styles.pill, pressed ? styles.pressed : null]}
      testID={testID}>
      <Text allowFontScaling={false} numberOfLines={1} style={styles.label}>{current?.label ?? ''}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flex: 1,
    minHeight: uiGeometry.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: uiSpace.sm,
    backgroundColor: uiRoles.surface,
    borderWidth: uiBorder.width,
    borderColor: uiRoles.rule,
    borderRadius: uiGeometry.radius.pill,
  },
  pressed: {
    backgroundColor: uiRoles.paper,
  },
  label: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
  },
});
