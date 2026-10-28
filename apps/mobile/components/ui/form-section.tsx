import type { ReactNode } from 'react';
import { StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { Card } from '@/components/ui/card';
import { Icon, type IconName } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { uiText, uiTextTone } from '@/components/ui/text-roles';
import { uiBorder, uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';

// The form grammar (`ux-rules.md` "Forms"): every field of an edit page sits in
// a `FormSection` — a micro-label naming the group over one card of rows — and
// each row is a `ChoiceRow`, an `InputRow`, a `SwitchRow density="list"` or a
// `FormActionRow`. Only a free-text name stands alone, as a `FormField`.

export type FormSectionProps = {
  title: string;
  children: ReactNode;
  // The section's one validation message, under its card in `danger`.
  error?: string | null;
  errorTestID?: string;
  testID?: string;
};

export function FormSection({ title, children, error, errorTestID, testID }: FormSectionProps) {
  return (
    <View style={styles.section} testID={testID}>
      <Text allowFontScaling={false} accessibilityRole="header" style={uiText.label}>
        {title}
      </Text>
      <Card style={error ? styles.cardInvalid : null}>{children}</Card>
      <FormError message={error} testID={errorTestID} />
    </View>
  );
}

/** A field's or section's validation message, the one way forms show one. */
export function FormError({ message, testID }: { message?: string | null; testID?: string }) {
  return message ? (
    <Text allowFontScaling={false} accessibilityLiveRegion="polite" selectable style={styles.error} testID={testID}>
      {message}
    </Text>
  ) : null;
}

export type ChoiceRowProps = {
  label: string;
  // The current choice, muted at the row's end; `placeholder` (faint) until one is made.
  value?: string | null;
  placeholder?: string;
  onPress: () => void;
  divider?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
};

/** A field whose value is chosen elsewhere (a picker sheet, a page): label, value, chevron. */
export function ChoiceRow({ label, value, placeholder, onPress, divider = false, disabled, accessibilityLabel, testID }: ChoiceRowProps) {
  const shown = value && value.length > 0 ? value : null;
  return (
    <ListRow
      accessibilityLabel={accessibilityLabel ?? `${label}: ${shown ?? placeholder ?? 'none'}`}
      density="list"
      disabled={disabled}
      divider={divider}
      label={label}
      meta={
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={[uiText.body, shown ? uiTextTone.muted : uiTextTone.faint, styles.value]}>
          {shown ?? placeholder ?? ''}
        </Text>
      }
      onPress={onPress}
      testID={testID}
      trailing={<Icon color={uiRoles.inkMuted} name="chevron-right" size="sm" />}
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
          placeholderTextColor={uiRoles.inkGhost}
          selectTextOnFocus
          style={[uiText.input, uiText.inlineFigure, styles.input, invalid ? styles.inputInvalid : null]}
          testID={testID}
          value={value}
          allowFontScaling={false}
        />
      }
    />
  );
}

export type FormActionRowProps = {
  label: string;
  icon: IconName;
  onPress: () => void;
  divider?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
};

/** A form's action that leaves for another page (Link to a group exercise): `accent` icon and words. */
export function FormActionRow({ label, icon, onPress, divider = false, disabled, accessibilityLabel, testID }: FormActionRowProps) {
  const colour = disabled ? uiRoles.inkGhost : uiRoles.accent;
  return (
    <ListRow
      accessibilityLabel={accessibilityLabel ?? label}
      density="list"
      disabled={disabled}
      divider={divider}
      leading={<Icon color={colour} name={icon} size="md" />}
      onPress={onPress}
      testID={testID}
      trailing={<Icon color={colour} name="chevron-right" size="sm" />}>
      <Text allowFontScaling={false} numberOfLines={1} style={[uiText.option, { color: colour }]}>
        {label}
      </Text>
    </ListRow>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: uiSpace.sm,
  },
  cardInvalid: {
    borderColor: uiRoles.danger,
  },
  error: {
    ...uiText.meta,
    color: uiRoles.danger,
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
    borderColor: uiRoles.rule,
    borderRadius: uiGeometry.radius.control,
    textAlign: 'right',
  },
  inputInvalid: {
    borderColor: uiRoles.danger,
  },
});
