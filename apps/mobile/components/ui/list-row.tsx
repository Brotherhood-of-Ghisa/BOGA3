import type { ReactNode, Ref } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewInstance } from 'react-native';

import { uiText } from '@/components/ui/text-roles';
import { uiBorder, uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';

export type ListRowDensity = 'sheet' | 'list' | 'compact';
export type ListRowTone = 'default' | 'danger';

export type ListRowContentAction = {
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityRole?: 'button' | 'link';
  testID?: string;
  ref?: Ref<ViewInstance>;
};

type ListRowBaseProps = {
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
  // `compact`: passive 28pt content or a 44pt independent target.
  // `sheet` and `list` keep the existing option-row recipes.
  density?: ListRowDensity;
  tone?: ListRowTone;
  // The current choice in a picker: `accent-wash` ground, `accent` label.
  selected?: boolean;
  // A board member's own row: paper ground and stronger body label.
  own?: boolean;
  // A `rule-soft` hairline above the row.
  divider?: boolean;
  // A disclosure row's state (a collapsible section's header): announced as
  // expanded or collapsed. The glyph that shows it is the caller's `trailing`.
  expanded?: boolean;
  // Makes the row a radio (a checkbox with `accessibilityRole="checkbox"`):
  // announced as checked or not, with no ground change. The glyph that shows
  // it (`radio-on` / `radio-off`, or a `check`) is the caller's.
  checked?: boolean;
  // Makes the whole row one target (sheet options). Leave unset when the
  // trailing control owns the action (set rows).
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  // What pressing the row does, when the label does not say (`Opens the
  // completed session`).
  accessibilityHint?: string;
  // `link` for a row that leaves the app (it opens the system browser);
  // `checkbox` for a checked row that is one of several.
  accessibilityRole?: 'button' | 'link' | 'checkbox';
  // A row with no `onPress` read as one element (its `accessibilityLabel`),
  // like a pressable row. Leave unset when a control inside must stay reachable.
  accessible?: boolean;
  // The row's host view, e.g. to move accessibility focus back to it.
  ref?: Ref<ViewInstance>;
  testID?: string;
};

// A content action stays independent of the row and its disclosure control.
export type ListRowProps = ListRowBaseProps & (
  | { density: 'compact'; contentAction: ListRowContentAction; onPress?: never; accessible?: never }
  | { contentAction?: never }
);

// A design-language row: `[leading][content, flex][meta][trailing control]`.
export function ListRow({
  label,
  description,
  children,
  contentAction,
  leading,
  meta,
  trailing,
  density = 'sheet',
  tone = 'default',
  selected = false,
  own = false,
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

  const rowStyle = [
    styles.row,
    densityStyles[density],
    density === 'compact' && onPress ? styles.compactTarget : null,
    own ? styles.own : null,
    divider ? styles.divider : null,
    selected ? styles.selected : null,
  ];

  if (!onPress) {
    return (
      <View accessibilityLabel={accessibilityLabel} accessible={accessible} ref={ref} style={rowStyle} testID={testID}>
        <ListRowContent label={label} description={description} leading={leading} meta={meta} trailing={trailing} contentAction={contentAction}
          density={density} tone={tone} selected={selected} own={own} disabled={disabled}>{children}</ListRowContent>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole={checked === undefined ? accessibilityRole : accessibilityRole === 'checkbox' ? 'checkbox' : 'radio'}
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
      <ListRowContent label={label} description={description} leading={leading} meta={meta} trailing={trailing} contentAction={contentAction}
          density={density} tone={tone} selected={selected} own={own} disabled={disabled}>{children}</ListRowContent>
    </Pressable>
  );
}

function ListRowContent({ label, description, children, contentAction, leading, meta, trailing, density = 'sheet', tone = 'default',
  selected = false, own = false, disabled = false }: ListRowBaseProps & { contentAction?: ListRowContentAction }) {
  const labelRole = density === 'compact' && (own || selected) ? uiText.bodyStrong : labelStyles[density];
  const selectedStyle = density === 'compact' ? styles.compactSelected : styles.labelSelected;
  const content = <View style={[contentAction ? null : styles.content, density === 'compact' ? styles.compactInset : description !== undefined ? styles.contentTwoLine : null]}>
        {label !== undefined ? (
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            style={[
              labelRole,
              tone === 'danger' ? styles.labelDanger : null,
              selected ? selectedStyle : null,
              disabled ? styles.labelDisabled : null,
            ]}>
            {label}
          </Text>
        ) : null}
        {description !== undefined ? <Text allowFontScaling={false} style={styles.description}>{description}</Text> : null}
        {children}
      </View>;
  return (
    <>
      {density === 'compact' && leading !== undefined ? <View style={styles.compactInset}>{leading}</View> : leading}
      {contentAction ? <Pressable {...contentAction} accessibilityRole={contentAction.accessibilityRole ?? 'button'}
        disabled={disabled || undefined} style={({ pressed }) => [styles.content, styles.compactTarget, styles.contentControl, pressed && !disabled ? styles.pressed : null]}>
        {content}
      </Pressable> : content}
      {density === 'compact' && meta !== undefined ? <View style={styles.compactInset}>{meta}</View> : meta}
      {trailing !== undefined ? <View style={[styles.control, density === 'compact' ? styles.compactTarget : null]}>{trailing}</View> : null}
    </>
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
  compactInset: { paddingVertical: uiSpace.xs },
  compactTarget: { minHeight: uiGeometry.tapTarget },
  contentControl: { justifyContent: 'center' },
  compactSelected: { color: uiRoles.accent },
  own: { backgroundColor: uiRoles.paper },
  selected: {
    backgroundColor: uiRoles.accentWash,
  },
  pressed: {
    backgroundColor: uiRoles.paper,
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
    ...uiText.body,
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
    color: uiRoles.inkGhost,
  },
});

const densityStyles = StyleSheet.create({
  compact: {
    paddingHorizontal: uiSpace.md,
    gap: uiSpace.sm,
  },
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

const labelStyles = {
  compact: uiText.body,
  sheet: uiText.optionLarge,
  list: uiText.option,
};
