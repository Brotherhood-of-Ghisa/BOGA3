import type { ComponentProps, ReactNode } from 'react';
import { Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { Card } from '@/components/ui/card';
import { FigureText } from '@/components/ui/figure-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { uiTextFor, useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { makeStyles, useUiRoles } from '@/components/ui/theme-context';
import { uiBorder, uiGeometry, uiSpace } from '@/components/ui/tokens';

// The form grammar (`ux-rules.md` "Forms"): every field of an edit page sits in
// a `FormSection` — a micro-label naming the group over one card of rows — and
// each row is a `ChoiceRow`, an `InputRow`, a `SwitchRow density="list"`, an
// `ActionRow`, or one of `form-rows.tsx` (`SegmentRow`, `RadioRow`, `CheckRow`,
// `ValueRow`). Only a free-text name stands alone, as a `FormField`.

export type FormSectionProps = {
  // The group's micro-label; omitted where a heading would only repeat its one row.
  title?: string;
  // A control beside the micro-label, such as an on-demand explainer.
  titleAccessory?: ReactNode;
  children: ReactNode;
  // The section's one validation message, under its card in `danger`.
  error?: string | null;
  errorTestID?: string;
  // A muted note under the card, above any error (`System follows the phone’s mode`).
  footnote?: string;
  testID?: string;
};

export function FormSection({ title, titleAccessory, children, error, errorTestID, footnote, testID }: FormSectionProps) {
  const styles = useStyles();
  const textRoles = useUiText();
  const textTones = useUiTextTone();
  const heading = title ? (
    <Text allowFontScaling={false} accessibilityRole="header" style={textRoles.label}>{title}</Text>
  ) : null;
  return (
    <View style={styles.section} testID={testID}>
      {title && titleAccessory ? <View style={styles.heading}>{heading}{titleAccessory}</View> : heading}
      <Card style={error ? styles.cardInvalid : null}>{children}</Card>
      {footnote ? (
        <Text allowFontScaling={false} style={[textRoles.meta, textTones.muted]} testID={testID ? `${testID}-footnote` : undefined}>
          {footnote}
        </Text>
      ) : null}
      <FormError message={error} testID={errorTestID} />
    </View>
  );
}

/** A field's or section's validation message, the one way forms show one. */
export function FormError({ message, testID }: { message?: string | null; testID?: string }) {
  const styles = useStyles();
  return message ? (
    <Text allowFontScaling={false} accessibilityLiveRegion="polite" selectable style={styles.error} testID={testID}>
      {message}
    </Text>
  ) : null;
}

export type ChoiceRowProps = {
  ref?: ComponentProps<typeof ListRow>['ref'];
  label: string;
  // The current choice, muted at the row's end; `placeholder` (faint) until one is made.
  value?: string | null;
  placeholder?: string;
  // A leading glyph naming the destination (a Settings home row), muted.
  icon?: IconName;
  onPress: () => void;
  divider?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
};

/** A field whose value is chosen elsewhere (a picker sheet, a page): label, value, chevron. */
export function ChoiceRow({ label, value, placeholder, icon, onPress, divider = false, disabled, accessibilityLabel, testID, ref }: ChoiceRowProps) {
  const styles = useStyles();
  const textRoles = useUiText();
  const textTones = useUiTextTone();
  const shown = value && value.length > 0 ? value : null;
  return (
    <ListRow
      ref={ref}
      accessibilityLabel={accessibilityLabel ?? `${label}: ${shown ?? placeholder ?? 'none'}`}
      density="list"
      disabled={disabled}
      divider={divider}
      label={label}
      leading={icon ? <Icon colorRole={disabled ? 'inkGhost' : 'inkMuted'} name={icon} size="md" /> : undefined}
      meta={
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={[textRoles.body, shown ? textTones.muted : textTones.faint, styles.value]}>
          <FigureText>{shown ?? placeholder ?? ''}</FigureText>
        </Text>
      }
      onPress={onPress}
      testID={testID}
      trailing={<Icon colorRole="inkMuted" name="chevron-right" size="sm" />}
    />
  );
}

export type InputRowProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  // Commits the typed value when editing ends (a setting saved on blur).
  onEndEditing?: () => void;
  // The value a blank field falls back to (the app default), faint.
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  editable?: boolean;
  invalid?: boolean;
  divider?: boolean;
  accessibilityLabel?: string;
  testID?: string;
};

/** A short figure typed in place: the label across the row, the input at its end. */
export function InputRow({
  label, value, onChangeText, onEndEditing, placeholder, keyboardType = 'number-pad', editable = true, invalid = false,
  divider = false, accessibilityLabel, testID,
}: InputRowProps) {
  const styles = useStyles();
  const roles = useUiRoles();
  const textRoles = useUiText();
  return (
    <ListRow
      density="list"
      divider={divider}
      label={label}
      meta={
        <TextInput
          accessibilityLabel={accessibilityLabel ?? label}
          editable={editable}
          keyboardType={keyboardType}
          onChangeText={onChangeText}
          onEndEditing={onEndEditing}
          placeholder={placeholder}
          placeholderTextColor={roles.inkGhost}
          selectTextOnFocus
          style={[textRoles.input, textRoles.inlineFigure, styles.input, invalid ? styles.inputInvalid : null]}
          testID={testID}
          value={value}
          allowFontScaling={false}
        />
      }
    />
  );
}

// `navigate`: leaves for another page, `accent` words and a chevron. `act`:
// does something now, `accent` words, no chevron. `danger`: destroys, `danger`
// words, no chevron; the caller confirms it in a native `Alert`.
export type ActionRowKind = 'navigate' | 'act' | 'danger';

export type ActionRowProps = {
  label: string;
  kind?: ActionRowKind;
  icon?: IconName;
  onPress: () => void;
  divider?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
};

/** A form's action row: the kind says whether it leaves (chevron), acts now, or destroys. */
export function ActionRow({ label, kind = 'navigate', icon, onPress, divider = false, disabled, accessibilityLabel, testID }: ActionRowProps) {
  const roles = useUiRoles();
  const textRoles = useUiText();
  const colourRole = disabled ? 'inkGhost' : kind === 'danger' ? 'danger' : 'accent';
  const colour = roles[colourRole];
  return (
    <ListRow
      accessibilityLabel={accessibilityLabel ?? label}
      density="list"
      disabled={disabled}
      divider={divider}
      leading={icon ? <Icon colorRole={colourRole} name={icon} size="md" /> : undefined}
      onPress={onPress}
      testID={testID}
      trailing={kind === 'navigate' ? <Icon colorRole={colourRole} name="chevron-right" size="sm" /> : undefined}>
      <Text allowFontScaling={false} numberOfLines={1} style={[textRoles.option, { color: colour }]}>
        {label}
      </Text>
    </ListRow>
  );
}

const useStyles = makeStyles((roles) => ({
  heading: { flexDirection: 'row', alignItems: 'center' },
  section: {
    gap: uiSpace.sm,
  },
  cardInvalid: {
    borderColor: roles.danger,
  },
  error: {
    ...uiTextFor(roles).meta,
    color: roles.danger,
  },
  value: {
    flexShrink: 1,
    maxWidth: '60%',
    textAlign: 'right',
  },
  // One field-height box at the row's end, framed like a `FormField`.
  input: {
    minWidth: uiGeometry.tapTarget * 2,
    height: uiGeometry.tapTarget - uiSpace.xs * 2,
    paddingHorizontal: uiSpace.sm,
    paddingVertical: 0,
    borderWidth: uiBorder.width,
    borderColor: roles.rule,
    borderRadius: uiGeometry.radius.control,
    textAlign: 'right',
  },
  inputInvalid: {
    borderColor: roles.danger,
  },
}));
