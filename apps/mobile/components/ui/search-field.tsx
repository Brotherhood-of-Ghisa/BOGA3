import { TextInput, View, type TextInputProps } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { useUiText } from '@/components/ui/text-roles';
import { makeStyles, useUiRoles } from '@/components/ui/theme-context';
import { uiBorder, uiGeometry, uiSpace } from '@/components/ui/tokens';

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
// there is text to clear; the query at the size of the rows it finds. One tap target tall, `radius.control`, `rule` hairline.
// The keyboard's Search key closes the keyboard (single-line fields blur on
// submit).
export function SearchField({
  value,
  onChangeText,
  accessibilityLabel,
  clearLabel = 'Clear search',
  testID,
  ...inputProps
}: SearchFieldProps) {
  const styles = useStyles();
  const roles = useUiRoles();
  const textRoles = useUiText();
  return (
    <View style={styles.field}>
      <Icon colorRole="inkFaint" name="search" size="sm" />
      <TextInput
        autoCorrect={false}
        returnKeyType="search"
        {...inputProps}
        allowFontScaling={false}
        accessibilityLabel={accessibilityLabel}
        onChangeText={onChangeText}
        placeholderTextColor={roles.inkFaint}
        style={[textRoles.inputLarge, styles.input]}
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

const useStyles = makeStyles((roles) => ({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    minHeight: uiGeometry.tapTarget,
    paddingLeft: uiSpace.md,
    backgroundColor: roles.surface,
    borderWidth: uiBorder.width,
    borderColor: roles.rule,
    borderRadius: uiGeometry.radius.control,
  },
  input: {
    flex: 1,
    minHeight: uiGeometry.tapTarget,
    paddingRight: uiSpace.md,
  },
}));
