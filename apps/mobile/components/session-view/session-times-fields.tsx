import { StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/ui/form-field';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { SessionTimesText, SessionTimesValidation } from '@/src/session-recorder/session-times';

export type SessionTimesFieldsProps = {
  text: SessionTimesText;
  errors: SessionTimesValidation;
  // The autosave-paused notice, while the times are invalid.
  notice: string | null;
  onChangeStart: (text: string) => void;
  onChangeEnd: (text: string) => void;
  onCommitStart: () => void;
  onCommitEnd: () => void;
};

const PLACEHOLDER = 'YYYY-MM-DD HH:mm';

type TimeFieldProps = {
  label: string;
  value: string;
  error: string | null;
  onChange: (text: string) => void;
  onCommit: () => void;
  testID: string;
};

// A labelled time field: a `FormField` (the logger's field style) whose
// figure `base` fits the 16 characters of a time in half the card's width.
function TimeField({ label, value, error, onChange, onCommit, testID }: TimeFieldProps) {
  return (
    <FormField
      accessibilityHint={PLACEHOLDER}
      accessibilityLabel={`Session ${label.toLowerCase()} time`}
      autoCapitalize="none"
      autoCorrect={false}
      containerStyle={styles.column}
      error={error}
      keyboardType="numbers-and-punctuation"
      label={label}
      onBlur={onCommit}
      onChangeText={onChange}
      onSubmitEditing={onCommit}
      placeholder={PLACEHOLDER}
      returnKeyType="done"
      // Typing replaces the whole time, as the logger's fields do.
      selectTextOnFocus
      testID={testID}
      value={value}
    />
  );
}

/**
 * A completed session's Start and End in the summary card, in place of the
 * elapsed Time (the completed edit, `ux-rules` §14b.7).
 */
export function SessionTimesFields({
  text,
  errors,
  notice,
  onChangeStart,
  onChangeEnd,
  onCommitStart,
  onCommitEnd,
}: SessionTimesFieldsProps) {
  return (
    <View style={styles.section} testID="session-view-times">
      <View style={styles.row}>
        <TimeField
          error={errors.start}
          label="Start"
          onChange={onChangeStart}
          onCommit={onCommitStart}
          testID="session-view-start-time"
          value={text.start}
        />
        <TimeField
          error={errors.end}
          label="End"
          onChange={onChangeEnd}
          onCommit={onCommitEnd}
          testID="session-view-end-time"
          value={text.end}
        />
      </View>
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={styles.notice} testID="session-view-times-notice">
          {notice}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    paddingTop: uiSpace.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: uiSpace.sm,
  },
  column: {
    flex: 1,
    minWidth: 0,
  },
  notice: {
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
});
