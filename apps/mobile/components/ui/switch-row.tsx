import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

export type SwitchRowProps = {
  disabled?: boolean;
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  testID?: string;
};

/**
 * A sheet row that turns one view option on or off: the label across the
 * row, the native switch at its end. The whole row is the target and one
 * accessible switch; the drawn switch is its glyph.
 */
export function SwitchRow({ disabled = false, label, value, onValueChange, testID }: SwitchRowProps) {
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
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
      ]}
      testID={testID}>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.label, disabled ? styles.labelDisabled : null]}>
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
  labelDisabled: {
    color: uiRoles.inkMuted,
  },
});
