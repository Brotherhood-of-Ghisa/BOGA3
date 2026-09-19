import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { uiBorder, uiColors, uiRadius, uiSpace, uiTypography } from '@/components/ui/tokens';

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
  variant?: 'pills' | 'joined';
};

export function SegmentedChips<TValue extends string | number>({
  options,
  value,
  onChange,
  testIDPrefix,
  accessibilityLabel,
  style,
  compact = false,
  variant = 'pills',
}: SegmentedChipsProps<TValue>) {
  const isJoined = variant === 'joined';

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[styles.row, isJoined && styles.rowJoined, style]}
      testID={`${testIDPrefix}-row`}>
      {options.map((option, index) => {
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
            style={[
              styles.chip,
              compact && styles.chipCompact,
              isJoined && styles.chipJoined,
              isJoined && index > 0 && styles.chipJoinedDivider,
              selected && styles.chipSelected,
            ]}
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
    gap: uiSpace.sm,
  },
  rowJoined: {
    gap: 0,
    alignSelf: 'stretch',
    overflow: 'hidden',
    borderRadius: uiRadius.lg,
    borderWidth: uiBorder.width,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
  },
  chip: {
    borderRadius: uiRadius.full,
    borderWidth: uiBorder.width,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: uiSpace.xl,
    paddingVertical: uiSpace.sm,
  },
  chipCompact: {
    paddingHorizontal: uiSpace.sm,
    paddingVertical: uiSpace.xs,
  },
  chipJoined: {
    flex: 1,
    minHeight: 44,
    borderRadius: 0,
    borderWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipJoinedDivider: {
    borderLeftWidth: uiBorder.width,
    borderLeftColor: uiColors.borderMuted,
  },
  chipSelected: {
    borderColor: uiColors.actionPrimary,
    backgroundColor: uiColors.actionPrimarySubtleBg,
  },
  chipText: {
    fontSize: uiTypography.size.md,
    fontWeight: uiTypography.weight.semibold,
    color: uiColors.textSecondary,
  },
  chipTextCompact: {
    fontSize: uiTypography.size.xs,
  },
  chipTextSelected: {
    color: uiColors.actionPrimary,
  },
});
