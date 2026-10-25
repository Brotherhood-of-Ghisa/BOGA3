import { StyleSheet, Text, View } from 'react-native';

import { TitleBarTimer, type TitleBarTimerProps } from '@/components/session-recorder/title-bar-timer';
import { IconButton } from '@/components/ui/icon-button';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

type ExerciseTopBarProps = {
  title: string;
  onBack: () => void;
  // Omitted while the page has no exercise to act on (loading, error).
  onOpenOptions?: () => void;
  // Present on an active session: starts or dismisses the rest timer.
  onToggleRestTimer?: () => void;
  restTimerActive?: boolean;
  // Settings › Experiments › Timer in title bar: replaces the timer button.
  titleBarTimer?: Omit<TitleBarTimerProps, 'testID'>;
};

// Back · exercise name · timer · ⋮. No subtitle.
export function ExerciseTopBar({
  title,
  onBack,
  onOpenOptions,
  onToggleRestTimer,
  restTimerActive = false,
  titleBarTimer,
}: ExerciseTopBarProps) {
  return (
    <View style={styles.bar}>
      <IconButton accessibilityLabel="Back to session" name="chevron-left" onPress={onBack} testID="exercise-page-back" />
      <Text allowFontScaling={false} accessibilityRole="header" numberOfLines={1} style={styles.title} testID="exercise-page-title">
        {title}
      </Text>
      {titleBarTimer ? (
        <TitleBarTimer {...titleBarTimer} testID="exercise-page-rest-timer-button" />
      ) : onToggleRestTimer ? (
        <IconButton
          accessibilityLabel={restTimerActive ? 'Dismiss rest timer' : 'Start rest timer'}
          name="timer"
          onPress={onToggleRestTimer}
          testID="exercise-page-rest-timer-button"
        />
      ) : null}
      {onOpenOptions ? (
        <IconButton
          accessibilityLabel="Exercise options"
          name="more-vertical"
          onPress={onOpenOptions}
          testID="exercise-page-options"
        />
      ) : (
        <View style={styles.spacer} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
    paddingHorizontal: uiSpace.xs,
    backgroundColor: uiRoles.surface,
    borderBottomWidth: uiBorder.width,
    borderBottomColor: uiRoles.rule,
  },
  spacer: {
    width: uiGeometry.tapTarget,
    height: uiGeometry.tapTarget,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
});
