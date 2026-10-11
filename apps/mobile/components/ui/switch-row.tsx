import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

export type SwitchRowProps = {
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
export function SwitchRow({ label, value, onValueChange, testID }: SwitchRowProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => onValueChange(!value)}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
      testID={testID}>
      <Text allowFontScaling={false} numberOfLines={1} style={styles.label}>
        {label}
      </Text>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Switch
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
  label: {
    flex: 1,
    minWidth: 0,
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
});
