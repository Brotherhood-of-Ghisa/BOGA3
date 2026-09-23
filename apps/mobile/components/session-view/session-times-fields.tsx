import { StyleSheet, Text, TextInput, View } from 'react-native';

import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
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

type FieldProps = {
  label: string;
  value: string;
  error: string | null;
  onChange: (text: string) => void;
  onCommit: () => void;
  testID: string;
};

// A labelled time field in the logger's field style (`set-logger.tsx`): label
// above, one field height, a `danger` rule while its value is invalid.
function TimeField({ label, value, error, onChange, onCommit, testID }: FieldProps) {
  return (
    <View style={styles.column}>
      <View style={[styles.field, error ? styles.fieldInvalid : null]}>
        <Text style={styles.label}>{label}</Text>
        <TextInput
          accessibilityHint={PLACEHOLDER}
          accessibilityLabel={`Session ${label.toLowerCase()} time`}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          onBlur={onCommit}
          onChangeText={onChange}
          onSubmitEditing={onCommit}
          placeholder={PLACEHOLDER}
          placeholderTextColor={uiRoles.disabled}
          returnKeyType="done"
          // Typing replaces the whole time, as the logger's fields do.
          selectTextOnFocus
          style={styles.input}
          testID={testID}
          value={value}
        />
      </View>
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error} testID={`${testID}-error`}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A completed session's Start and End in the summary card, in place of the
 * elapsed Time (the recorder's completed edit, moved to the session view).
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
  // Every number is Plex Mono (`design-language.md` §3); `base` fits the 16
  // characters of a time in half the card's width.
  input: {
    flex: 1,
    padding: 0,
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.base,
    color: uiRoles.ink,
  },
  error: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.danger,
  },
  notice: {
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
});
