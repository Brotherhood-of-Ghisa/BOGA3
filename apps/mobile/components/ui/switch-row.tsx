import { Pressable, Switch, Text, View } from 'react-native';

import { uiTextFor, useUiText } from '@/components/ui/text-roles';
import { makeStyles, useUiRoles } from '@/components/ui/theme-context';
import { uiBorder, uiGeometry, uiSpace } from '@/components/ui/tokens';

export type SwitchRowProps = {
  // `sheet` (default): a roomy row among a sheet's options. `list`: a form
  // card's row, at `ListRow`'s list density.
  density?: 'sheet' | 'list';
  disabled?: boolean;
  // A `rule-soft` hairline above the row, as `ListRow`'s.
  divider?: boolean;
  label: string;
  // A muted line under the label (a setting's state).
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  testID?: string;
};

/**
 * A sheet or card row that turns one option or setting on or off: the label
 * across the row, the native switch at its end. The whole row is the target and one
 * accessible switch; the drawn switch is its glyph.
 */
export function SwitchRow({ density = 'sheet', disabled = false, divider = false, label, description, value, onValueChange, testID }: SwitchRowProps) {
  const styles = useStyles();
  const roles = useUiRoles();
  const textRoles = useUiText();
  return (
    <Pressable
      accessibilityLabel={description !== undefined ? `${label}, ${description}` : label}
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
      <View style={styles.text}>
        <Text allowFontScaling={false} numberOfLines={1} style={[density === 'list' ? textRoles.option : textRoles.optionLarge, disabled ? styles.labelDisabled : null]}>
          {label}
        </Text>
        {description !== undefined ? <Text allowFontScaling={false} style={styles.description}>{description}</Text> : null}
      </View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Switch
          disabled={disabled}
          onValueChange={onValueChange}
          testID={testID ? `${testID}-switch` : undefined}
          trackColor={{ false: roles.rule, true: roles.accent }}
          value={value}
        />
      </View>
    </Pressable>
  );
}

// The sheet density of `ListRow`, so it sits among a sheet's rows.
const useStyles = makeStyles((roles) => ({
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
    borderTopColor: roles.ruleSoft,
  },
  pressed: {
    backgroundColor: roles.paper,
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  description: {
    ...uiTextFor(roles).body,
    color: roles.inkMuted,
  },
  labelDisabled: {
    color: roles.inkMuted,
  },
}));
