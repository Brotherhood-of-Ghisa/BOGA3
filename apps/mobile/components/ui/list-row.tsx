import type { ReactNode, Ref } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

export type ListRowDensity = 'sheet' | 'list';
export type ListRowTone = 'default' | 'danger';

export type ListRowProps = {
  // The row's text. Pass `children` instead for composed content (a set row's
  // weight × reps).
  label?: string;
  // A second line under the label in `ink-muted` body text (what a More or
  // Settings destination is for). It wraps; the label stays one line.
  description?: string;
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
  // A disclosure row's state (a collapsible section's header): announced as
  // expanded or collapsed. The glyph that shows it is the caller's `trailing`.
  expanded?: boolean;
  // Makes the row a radio: announced as checked or not, with no ground change.
  // The glyph that shows it (`radio-on` / `radio-off`) is the caller's `leading`.
  checked?: boolean;
  // Makes the whole row one target (sheet options). Leave unset when the
  // trailing control owns the action (set rows).
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  // What pressing the row does, when the label does not say (`Opens the
  // completed session`).
  accessibilityHint?: string;
  // `link` for a row that leaves the app (it opens the system browser).
  accessibilityRole?: 'button' | 'link';
  // A row with no `onPress` read as one element (its `accessibilityLabel`),
  // like a pressable row. Leave unset when a control inside must stay reachable.
  accessible?: boolean;
  // The row's host view, e.g. to move accessibility focus back to it.
  ref?: Ref<View>;
  testID?: string;
};

// A design-language row: `[leading][content, flex][meta][trailing control]`.
export function ListRow({
  label,
  description,
  children,
  leading,
  meta,
  trailing,
  density = 'sheet',
  tone = 'default',
  selected = false,
  divider = true,
  expanded,
  checked,
  onPress,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = 'button',
  accessible,
  ref,
  testID,
}: ListRowProps) {
  const body = (
    <>
      {leading}
      <View style={[styles.content, description !== undefined ? styles.contentTwoLine : null]}>
        {label !== undefined ? (
          <Text
            allowFontScaling={false}
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
        {description !== undefined ? <Text allowFontScaling={false} style={styles.description}>{description}</Text> : null}
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
      <View accessibilityLabel={accessibilityLabel} accessible={accessible} ref={ref} style={rowStyle} testID={testID}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole={checked === undefined ? accessibilityRole : 'radio'}
      accessibilityState={
        checked !== undefined
          ? disabled
            ? { checked, disabled }
            : { checked }
          : expanded === undefined
            ? { selected, disabled }
            : { selected, disabled, expanded }
      }
      // Only when set: Pressable folds an explicit `false` into the state.
      disabled={disabled || undefined}
      onPress={onPress}
      ref={ref}
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
  // Two lines need room above and below, beyond the row's own padding.
  contentTwoLine: {
    paddingVertical: uiSpace.sm,
  },
  description: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
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
