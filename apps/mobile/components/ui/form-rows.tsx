import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/segmented-control';
import { uiText, uiTextTone } from '@/components/ui/text-roles';
import { uiRoles, uiSpace } from '@/components/ui/tokens';

// The rest of the Settings row vocabulary (`ux-rules.md` "Forms"), beside the
// rows of `form-section.tsx`: all at `ListRow`'s list density, label left,
// control right, inside a `FormSection` card.

export type SegmentRowProps<TValue extends string | number> = {
  label: string;
  options: readonly SegmentedControlOption<TValue>[];
  value: TValue;
  onChange: (next: TValue) => void;
  // `<prefix>-row` on the control, `<prefix>-<value>` on each segment.
  testIDPrefix: string;
  divider?: boolean;
  disabled?: boolean;
  testID?: string;
};

/** One of up to three short options: the label, with its segmented control under it in the row. */
export function SegmentRow<TValue extends string | number>({
  label, options, value, onChange, testIDPrefix, divider = false, disabled = false, testID,
}: SegmentRowProps<TValue>) {
  return (
    <ListRow density="list" disabled={disabled} divider={divider} label={label} testID={testID}>
      <View style={styles.segment}>
        <SegmentedControl
          accessibilityLabel={label}
          disabled={disabled}
          onChange={onChange}
          options={options}
          testIDPrefix={testIDPrefix}
          value={value}
        />
      </View>
    </ListRow>
  );
}

type ChoiceFlagProps = {
  label: string;
  checked: boolean;
  onPress: () => void;
  divider?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
};

export type RadioRowProps = ChoiceFlagProps & {
  // Detail at the row's end (a theme's swatch).
  meta?: ReactNode;
};

/** The one chosen option among several, inline in its own section: a radio glyph, the label, optional detail. */
export function RadioRow({ label, checked, meta, onPress, divider = false, disabled, accessibilityLabel, testID }: RadioRowProps) {
  return (
    <ListRow
      accessibilityLabel={accessibilityLabel ?? label}
      checked={checked}
      density="list"
      disabled={disabled}
      divider={divider}
      label={label}
      leading={<Icon color={disabled ? uiRoles.inkGhost : uiRoles.ink} name={checked ? 'radio-on' : 'radio-off'} />}
      meta={meta}
      onPress={onPress}
      testID={testID}
    />
  );
}

export type CheckRowProps = ChoiceFlagProps;

/** One of several options that can each be on: the label, and a check at the row's end while chosen. */
export function CheckRow({ label, checked, onPress, divider = false, disabled, accessibilityLabel, testID }: CheckRowProps) {
  return (
    <ListRow
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="checkbox"
      checked={checked}
      density="list"
      disabled={disabled}
      divider={divider}
      label={label}
      onPress={onPress}
      testID={testID}
      trailing={checked ? <Icon color={disabled ? uiRoles.inkGhost : uiRoles.accent} name="check" size="md" /> : null}
    />
  );
}

export type ValueRowProps = {
  label: string;
  value: string;
  divider?: boolean;
  accessibilityLabel?: string;
  testID?: string;
};

/** A read-only figure or status: the label and its value, no chevron, read as one element. */
export function ValueRow({ label, value, divider = false, accessibilityLabel, testID }: ValueRowProps) {
  return (
    <ListRow
      accessibilityLabel={accessibilityLabel ?? `${label}: ${value}`}
      accessible
      density="list"
      divider={divider}
      label={label}
      meta={
        <Text allowFontScaling={false} numberOfLines={1} style={[uiText.body, uiTextTone.muted, styles.value]}>
          {value}
        </Text>
      }
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  segment: {
    paddingBottom: uiSpace.sm,
    paddingTop: uiSpace.xs,
  },
  value: {
    flexShrink: 1,
    maxWidth: '60%',
    textAlign: 'right',
  },
});
