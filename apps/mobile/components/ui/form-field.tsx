import { StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

// `figure`: a number, date or code in Plex Mono (`design-language.md` §3).
// `text`: words (a name, an email) in Source Sans.
export type FormFieldFace = 'figure' | 'text';

export type FormFieldProps = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  // The micro-label drawn inside the field, above the value.
  label: string;
  // Shown below the field in `danger`; the field's rule turns `danger` too.
  error?: string | null;
  // Defaults to `<testID>-error`.
  errorTestID?: string;
  // A line under the field in `ink-muted`: a format, or a counter (`12/280`).
  hint?: string;
  face?: FormFieldFace;
  // Sizing within the host's layout, e.g. `{ flex: 1 }` in a row of fields.
  containerStyle?: StyleProp<ViewStyle>;
};

// A labelled input field (`design-language.md` §4): the micro-label inside the
// field above the value, one field height, `radius.control`, a `rule-strong`
// hairline that turns `danger` while the value is invalid. The logger's figure
// fields are the same recipe drawn larger (`exercise-page/set-logger.tsx`).
export function FormField({
  label,
  error,
  errorTestID,
  hint,
  face = 'figure',
  containerStyle,
  multiline,
  testID,
  ...inputProps
}: FormFieldProps) {
  return (
    <View style={[styles.column, containerStyle]}>
      <View style={[styles.field, multiline ? styles.fieldMultiline : null, error ? styles.fieldInvalid : null]}>
        <Text allowFontScaling={false} style={styles.label}>{label}</Text>
        <TextInput
          {...inputProps}
          allowFontScaling={false}
          multiline={multiline}
          placeholderTextColor={uiRoles.disabled}
          style={[styles.input, face === 'text' ? styles.inputText : null]}
          testID={testID}
        />
      </View>
      {error ? (
        <Text
          allowFontScaling={false}
          accessibilityLiveRegion="polite"
          style={styles.error}
          testID={errorTestID ?? (testID ? `${testID}-error` : undefined)}>
          {error}
        </Text>
      ) : null}
      {hint ? <Text allowFontScaling={false} style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    gap: uiSpace.xs,
  },
  field: {
    height: uiGeometry.fieldHeight,
    paddingHorizontal: uiSpace.sm,
    paddingTop: uiSpace.xs,
    backgroundColor: uiRoles.surface,
    borderWidth: uiBorder.width,
    borderColor: uiRoles.ruleStrong,
    borderRadius: uiGeometry.radius.control,
  },
  // Grows with its text from one field height.
  fieldMultiline: {
    height: undefined,
    minHeight: uiGeometry.fieldHeight,
    paddingBottom: uiSpace.xs,
  },
  fieldInvalid: {
    borderColor: uiRoles.danger,
  },
  label: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkFaint,
  },
  input: {
    flex: 1,
    padding: 0,
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.base,
    color: uiRoles.ink,
  },
  inputText: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
  },
  error: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.danger,
  },
  hint: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
});
