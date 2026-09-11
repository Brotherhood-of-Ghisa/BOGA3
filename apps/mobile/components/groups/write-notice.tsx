import { StyleSheet, View } from 'react-native';

import { UiText, uiColors, uiRadius, uiSpace } from '@/components/ui';

type GroupWriteNoticeProps = {
  tone: 'error' | 'success';
  message: string;
  testID: string;
};

/** Inline outcome of a group write: the failure (nothing changed) or the confirmation. */
export function GroupWriteNotice({ tone, message, testID }: GroupWriteNoticeProps) {
  const error = tone === 'error';
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole={error ? 'alert' : undefined}
      style={[styles.notice, error ? styles.error : styles.success]}
      testID={testID}>
      <UiText style={error ? styles.errorText : styles.successText} variant="label">
        {message}
      </UiText>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    borderRadius: uiRadius.md,
    borderWidth: 1,
    paddingHorizontal: uiSpace.lg,
    paddingVertical: uiSpace.sm,
  },
  error: {
    borderColor: uiColors.actionDangerSubtleBorder,
    backgroundColor: uiColors.actionDangerSubtleBg,
  },
  success: {
    borderColor: uiColors.borderSuccess,
    backgroundColor: uiColors.surfaceSuccess,
  },
  errorText: {
    color: uiColors.actionDangerText,
  },
  successText: {
    color: uiColors.textSuccess,
  },
});
