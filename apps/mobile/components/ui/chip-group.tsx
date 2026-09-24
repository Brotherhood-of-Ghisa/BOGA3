import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

export type ChipOption<TValue extends string | number> = {
  value: TValue;
  label: string;
  // What VoiceOver (and Maestro) read and tap, e.g. `Turn grouping off`.
  accessibilityLabel?: string;
};

type ChipGroupBaseProps<TValue extends string | number> = {
  options: readonly ChipOption<TValue>[];
  // `<prefix>-row` on the group, `<prefix>-<value>` on each chip.
  testIDPrefix: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export type ChipGroupProps<TValue extends string | number> = ChipGroupBaseProps<TValue> &
  (
    | {
        // Exactly one chip is on (a group filter, a period).
        mode: 'single';
        value: TValue;
        onChange: (next: TValue) => void;
      }
    | {
        // Each chip toggles on its own (muscle filters, list options).
        mode: 'multi';
        values: readonly TValue[];
        onToggle: (value: TValue) => void;
      }
  );

// Pills that wrap onto more lines rather than scrolling sideways; an `ink` pill
// is on. `single` reads as a tab list (`selected`), `multi` as checkboxes
// (`checked`), so state never rides colour alone.
export function ChipGroup<TValue extends string | number>(props: ChipGroupProps<TValue>) {
  const { options, testIDPrefix, accessibilityLabel, style } = props;
  const isOn = (value: TValue) =>
    props.mode === 'single' ? props.value === value : props.values.includes(value);

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={props.mode === 'single' ? 'tablist' : undefined}
      style={[styles.group, style]}
      testID={`${testIDPrefix}-row`}>
      {options.map((option) => {
        const on = isOn(option.value);
        return (
          <Pressable
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityRole={props.mode === 'single' ? 'tab' : 'checkbox'}
            accessibilityState={props.mode === 'single' ? { selected: on } : { checked: on }}
            hitSlop={uiSpace.xs}
            key={String(option.value)}
            onPress={() => {
              if (props.mode === 'multi') {
                props.onToggle(option.value);
              } else if (!on) {
                props.onChange(option.value);
              }
            }}
            style={({ pressed }) => [styles.chip, on ? styles.chipOn : null, pressed && !on ? styles.pressed : null]}
            testID={`${testIDPrefix}-${option.value}`}>
            <Text numberOfLines={1} style={[styles.label, on ? styles.labelOn : null]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpace.sm,
  },
  chip: {
    justifyContent: 'center',
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.xs,
    backgroundColor: uiRoles.surface,
    borderWidth: uiBorder.width,
    borderColor: uiRoles.ruleStrong,
    borderRadius: uiGeometry.radius.pill,
  },
  chipOn: {
    backgroundColor: uiRoles.ink,
    borderColor: uiRoles.ink,
  },
  pressed: {
    backgroundColor: uiRoles.surfaceSubtle,
  },
  label: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
  },
  labelOn: {
    color: uiRoles.surface,
  },
});
