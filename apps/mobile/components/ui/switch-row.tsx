import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

export type SwitchRowProps = {
  // `sheet` (default): a roomy row among a sheet's options. `list`: a form
  // card's row, at `ListRow`'s list density.
  density?: 'sheet' | 'list';
  disabled?: boolean;
  // A `rule-soft` hairline above the row, as `ListRow`'s.
  divider?: boolean;
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  testID?: string;
};

/**
 * A sheet or card row that turns one option or setting on or off: the label
 * across the row, the native switch at its end. The whole row is the target and one
 * accessible switch; the drawn switch is its glyph.
 */
export function SwitchRow({ density = 'sheet', disabled = false, divider = false, label, value, onValueChange, testID }: SwitchRowProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={disabled ? { checked: value, disabled: true } : { checked: value }}
      {...(disabled ? { disabled: true } : {})}
      onPress={() => {
        if (!disabled) onValueChange(!value);
      }}
      style={({ pressed }) => [
        styles.row,
        density === 'list' ? styles.rowList : null,
        divider ? styles.divider : null,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
      ]}
      testID={testID}>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.label, density === 'list' ? styles.labelList : null, disabled ? styles.labelDisabled : null]}>
        {label}
      </Text>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Switch
          disabled={disabled}
          onValueChange={onValueChange}
          testID={testID ? `${testID}-switch` : undefined}
          trackColor={{ false: uiRoles.rule, true: uiRoles.accent }}
          value={value}
        />
      </View>
    </Pressable>
  );
}

// The sheet density of `ListRow`, so it sits among a sheet's rows.
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.md,
    minHeight: uiGeometry.tapTarget + uiSpace.sm * 2,
    paddingHorizontal: uiSpace.lg,
    paddingVertical: uiSpace.sm,
  },
  rowList: {
    minHeight: uiGeometry.tapTarget,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.xs,
  },
  divider: {
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
  },
  pressed: {
    backgroundColor: uiRoles.paper,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    flex: 1,
    minWidth: 0,
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
  labelList: {
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
  },
  labelDisabled: {
    color: uiRoles.inkMuted,
  },
});
