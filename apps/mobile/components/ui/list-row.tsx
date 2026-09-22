import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

export type ListRowDensity = 'sheet' | 'list';
export type ListRowTone = 'default' | 'danger';

export type ListRowProps = {
  // The row's text. Pass `children` instead for composed content (a set row's
  // weight × reps).
  label?: string;
  children?: ReactNode;
  // Before the content: an icon, or a fixed-width column (a set row's type).
  leading?: ReactNode;
  // Right-aligned between the content and the control (a set row's metrics).
  meta?: ReactNode;
  // The control. Always rendered in a fixed tap-target-wide column so every
  // control in a list sits on one vertical axis (`design-language.md` §4).
  trailing?: ReactNode;
  // `sheet`: a roomy option row in a sheet. `list`: a dense row in a card.
  density?: ListRowDensity;
  tone?: ListRowTone;
  // The current choice in a picker: `accent-wash` ground, `accent` label.
  selected?: boolean;
  // A `rule-soft` hairline above the row.
  divider?: boolean;
  // Makes the whole row one target (sheet options). Leave unset when the
  // trailing control owns the action (set rows).
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
};

// A design-language row: `[leading][content, flex][meta][trailing control]`.
export function ListRow({
  label,
  children,
  leading,
  meta,
  trailing,
  density = 'sheet',
  tone = 'default',
  selected = false,
  divider = true,
  onPress,
  disabled = false,
  accessibilityLabel,
  testID,
}: ListRowProps) {
  const body = (
    <>
      {leading}
      <View style={styles.content}>
        {label !== undefined ? (
          <Text
            numberOfLines={1}
            style={[
              labelStyles[density],
              tone === 'danger' ? styles.labelDanger : null,
              selected ? styles.labelSelected : null,
              disabled ? styles.labelDisabled : null,
            ]}>
            {label}
          </Text>
        ) : null}
        {children}
      </View>
      {meta}
      {trailing !== undefined ? <View style={styles.control}>{trailing}</View> : null}
    </>
  );

  const rowStyle = [
    styles.row,
    densityStyles[density],
    divider ? styles.divider : null,
    selected ? styles.selected : null,
  ];

  if (!onPress) {
    return (
      <View accessibilityLabel={accessibilityLabel} style={rowStyle} testID={testID}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [rowStyle, pressed && !disabled ? styles.pressed : null]}
      testID={testID}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.md,
  },
  divider: {
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
  },
  selected: {
    backgroundColor: uiRoles.accentWash,
  },
  pressed: {
    backgroundColor: uiRoles.surfaceSubtle,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  // Width only: the row's own minimum height already makes the column a full
  // tap target, and a second minimum here would stack on the row's padding.
  control: {
    width: uiGeometry.tapTarget,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelDanger: {
    color: uiRoles.danger,
  },
  labelSelected: {
    fontWeight: '700',
    color: uiRoles.accent,
  },
  labelDisabled: {
    color: uiRoles.disabled,
  },
});

const densityStyles = StyleSheet.create({
  sheet: {
    minHeight: uiGeometry.tapTarget + uiSpace.sm * 2,
    paddingHorizontal: uiSpace.lg,
    paddingVertical: uiSpace.sm,
  },
  list: {
    minHeight: uiGeometry.tapTarget,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.xs,
  },
});

const labelStyles = StyleSheet.create({
  sheet: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
  list: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
});
