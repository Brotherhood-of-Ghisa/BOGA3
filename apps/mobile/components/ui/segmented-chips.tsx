import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { uiColors } from '@/components/ui/tokens';

export type SegmentedChipOption<TValue extends string | number> = {
  value: TValue;
  label: string;
  accessibilityLabel?: string;
};

export type SegmentedChipsProps<TValue extends string | number> = {
  options: readonly SegmentedChipOption<TValue>[];
  value: TValue;
  onChange: (next: TValue) => void;
  testIDPrefix: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
};

export function SegmentedChips<TValue extends string | number>({
  options,
  value,
  onChange,
  testIDPrefix,
  accessibilityLabel,
  style,
  compact = false,
}: SegmentedChipsProps<TValue>) {
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[styles.row, style]}
      testID={`${testIDPrefix}-row`}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            onPress={() => {
              if (!selected) {
                onChange(option.value);
              }
            }}
            style={[styles.chip, compact && styles.chipCompact, selected && styles.chipSelected]}
            testID={`${testIDPrefix}-${option.value}`}>
            <Text style={[styles.chipText, compact && styles.chipTextCompact, selected && styles.chipTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipCompact: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chipSelected: {
    borderColor: uiColors.actionPrimary,
    backgroundColor: uiColors.actionPrimarySubtleBg,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: uiColors.textSecondary,
  },
  chipTextCompact: {
    fontSize: 11,
  },
  chipTextSelected: {
    color: uiColors.actionPrimary,
  },
});
