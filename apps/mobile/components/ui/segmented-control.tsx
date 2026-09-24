import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

export type SegmentedControlOption<TValue extends string | number> = {
  value: TValue;
  label: string;
  accessibilityLabel?: string;
};

// `fill`: equal-width segments across the row (a screen's selector). `inline`:
// segments sized to their labels (a selector inside a card's header).
export type SegmentedControlLayout = 'fill' | 'inline';

export type SegmentedControlProps<TValue extends string | number> = {
  options: readonly SegmentedControlOption<TValue>[];
  value: TValue;
  onChange: (next: TValue) => void;
  // `<prefix>-row` on the control, `<prefix>-<value>` on each segment.
  testIDPrefix: string;
  accessibilityLabel?: string;
  layout?: SegmentedControlLayout;
  hitSlop?: number;
  style?: StyleProp<ViewStyle>;
};

// One choice from a few, joined in a single `rule-strong` frame at the control
// radius; the selected segment is solid `ink` (`design-language.md` §4). A tab
// list to assistive tech. Selecting the selected segment does nothing.
export function SegmentedControl<TValue extends string | number>({
  options,
  value,
  onChange,
  testIDPrefix,
  accessibilityLabel,
  layout = 'fill',
  hitSlop,
  style,
}: SegmentedControlProps<TValue>) {
  const fill = layout === 'fill';
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="tablist"
      style={[styles.control, fill ? styles.controlFill : null, style]}
      testID={`${testIDPrefix}-row`}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <Pressable
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            hitSlop={hitSlop}
            key={String(option.value)}
            onPress={() => {
              if (!selected) {
                onChange(option.value);
              }
            }}
            style={[
              styles.segment,
              fill ? styles.segmentFill : null,
              index > 0 ? styles.segmentDivider : null,
              selected ? styles.segmentSelected : null,
            ]}
            testID={`${testIDPrefix}-${option.value}`}>
            <Text numberOfLines={1} style={[styles.label, selected ? styles.labelSelected : null]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  control: {
    flexDirection: 'row',
    overflow: 'hidden',
    borderWidth: uiBorder.width,
    borderColor: uiRoles.ruleStrong,
    borderRadius: uiGeometry.radius.control,
  },
  controlFill: {
    alignSelf: 'stretch',
  },
  segment: {
    justifyContent: 'center',
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.xs,
    backgroundColor: uiRoles.surface,
  },
  segmentFill: {
    flex: 1,
    alignItems: 'center',
  },
  segmentDivider: {
    borderLeftWidth: uiBorder.width,
    borderLeftColor: uiRoles.ruleStrong,
  },
  segmentSelected: {
    backgroundColor: uiRoles.ink,
  },
  label: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
  },
  labelSelected: {
    color: uiRoles.surface,
  },
});
