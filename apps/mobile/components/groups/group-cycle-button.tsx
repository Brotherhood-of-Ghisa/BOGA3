import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { uiBorder, uiGeometry, uiRoles, uiSpace, uiText, uiTextTone } from '@/components/ui';

export type GroupCycleOption<TValue extends string> = { value: TValue; label: string };

/**
 * One filter as a single pill showing its current option; a tap moves to the
 * next option, wrapping. Several sit side by side on one row (`flex: 1`);
 * `style` overrides the pill's sizing, for one beside other controls.
 * `testID` on the pill; VoiceOver reads `<accessibilityLabel>, <option>`.
 */
export function GroupCycleButton<TValue extends string>({ options, value, onChange, accessibilityLabel, testID, style }: {
  options: readonly GroupCycleOption<TValue>[];
  style?: StyleProp<ViewStyle>;
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
      style={({ pressed }) => [styles.pill, style, pressed ? styles.pressed : null]}
      testID={testID}>
      <Text allowFontScaling={false} numberOfLines={1} style={[uiText.label, uiTextTone.ink]}>{current?.label ?? ''}</Text>
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
});
