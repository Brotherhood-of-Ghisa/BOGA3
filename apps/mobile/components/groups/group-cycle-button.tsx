import { Pressable, Text, type StyleProp, type ViewStyle } from 'react-native';

import { makeStyles, uiBorder, uiGeometry, uiSpace, useUiText, useUiTextTone } from '@/components/ui';

/** `spokenLabel`: what VoiceOver says for an abbreviated `label` (`GR`). */
export type GroupCycleOption<TValue extends string> = { value: TValue; label: string; spokenLabel?: string };

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
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  const index = Math.max(0, options.findIndex(option => option.value === value));
  const current = options[index];
  const next = options[(index + 1) % options.length];
  return (
    <Pressable
      accessibilityHint={next && next.value !== current?.value ? `Changes to ${next.spokenLabel ?? next.label}` : undefined}
      accessibilityLabel={`${accessibilityLabel}, ${current?.spokenLabel ?? current?.label ?? ''}`}
      accessibilityRole="button"
      disabled={options.length < 2}
      hitSlop={uiSpace.xs}
      onPress={() => { if (next) onChange(next.value); }}
      style={({ pressed }) => [styles.pill, style, pressed ? styles.pressed : null]}
      testID={testID}>
      <Text allowFontScaling={false} numberOfLines={1} style={[text.label, tone.ink]}>{current?.label ?? ''}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((roles) => ({
  pill: {
    flex: 1,
    minHeight: uiGeometry.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: uiSpace.sm,
    backgroundColor: roles.surface,
    borderWidth: uiBorder.width,
    borderColor: roles.rule,
    borderRadius: uiGeometry.radius.pill,
  },
  pressed: {
    backgroundColor: roles.paper,
  },
}));
