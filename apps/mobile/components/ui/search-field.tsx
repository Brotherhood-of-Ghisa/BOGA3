import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

export type SearchFieldProps = Omit<TextInputProps, 'style' | 'placeholderTextColor' | 'value' | 'onChangeText'> & {
  value: string;
  onChangeText: (text: string) => void;
  // Required: Maestro and VoiceOver find the field by it ("Exercise filter
  // input").
  accessibilityLabel: string;
  // Label of the clear control; `Clear search` by default.
  clearLabel?: string;
};

// A filter or search field: a search glyph, the text, and a clear control while
// there is text to clear. One tap target tall, `radius.control`, `rule` hairline.
export function SearchField({
  value,
  onChangeText,
  accessibilityLabel,
  clearLabel = 'Clear search',
  testID,
  ...inputProps
}: SearchFieldProps) {
  return (
    <View style={styles.field}>
      <Icon color={uiRoles.inkFaint} name="search" size="sm" />
      <TextInput
        autoCorrect={false}
        {...inputProps}
        accessibilityLabel={accessibilityLabel}
        onChangeText={onChangeText}
        placeholderTextColor={uiRoles.inkFaint}
        style={styles.input}
        testID={testID}
        value={value}
      />
      {value.length > 0 ? (
        <IconButton
          accessibilityLabel={clearLabel}
          name="x"
          onPress={() => onChangeText('')}
          size="sm"
          testID={testID ? `${testID}-clear` : undefined}
          tone="muted"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    minHeight: uiGeometry.tapTarget,
    paddingLeft: uiSpace.md,
    backgroundColor: uiRoles.surface,
    borderWidth: uiBorder.width,
    borderColor: uiRoles.rule,
    borderRadius: uiGeometry.radius.control,
  },
  input: {
    flex: 1,
    minHeight: uiGeometry.tapTarget,
    paddingRight: uiSpace.md,
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.lg,
    color: uiRoles.ink,
  },
});
