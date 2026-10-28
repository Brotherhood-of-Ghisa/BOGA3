import { StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { uiText } from '@/components/ui/text-roles';
import { uiBorder, uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';

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
  // Render the error message under the field. Set false when the host draws it
  // itself (a dense row of fields whose error spans the whole row); the field
  // still turns `danger`.
  showErrorText?: boolean;
  // A line under the field in `ink-muted`: a format, or a counter (`12/280`).
  hint?: string;
  face?: FormFieldFace;
  // Sizing within the host's layout, e.g. `{ flex: 1 }` in a row of fields.
  containerStyle?: StyleProp<ViewStyle>;
};

// A labelled input field (`design-language.md` §4): the micro-label inside the
// field above the value, one field height, `radius.control`, a `rule`
// hairline that turns `danger` while the value is invalid. The logger's figure
// fields are the same recipe drawn larger (`exercise-page/set-logger.tsx`).
export function FormField({
  label,
  error,
  errorTestID,
  hint,
  showErrorText = true,
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
          placeholderTextColor={uiRoles.inkGhost}
          style={[uiText.input, face === 'figure' ? uiText.inlineFigure : null, styles.input]}
          testID={testID}
        />
      </View>
      {error && showErrorText ? (
        <Text
          allowFontScaling={false}
          accessibilityLiveRegion="polite"
          style={styles.error}
          testID={errorTestID ?? (testID ? `${testID}-error` : undefined)}>
          {error}
        </Text>
      ) : null}
      {hint ? <Text allowFontScaling={false} style={uiText.meta}>{hint}</Text> : null}
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
    borderColor: uiRoles.rule,
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
    ...uiText.label,
    color: uiRoles.inkFaint,
  },
  input: {
    flex: 1,
    padding: 0,
  },
  error: {
    ...uiText.meta,
    color: uiRoles.danger,
  },
});
