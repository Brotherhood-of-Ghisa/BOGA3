import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TitleBarTimer, type TitleBarTimerProps } from '@/components/session-recorder/title-bar-timer';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

type ExerciseTopBarProps = {
  title: string;
  onBack: () => void;
  // Present once the session is loaded: the title opens the exercise switcher.
  onOpenSwitcher?: () => void;
  // Omitted while the page has no exercise to act on (loading, error).
  onOpenOptions?: () => void;
  // Present on an active session: starts or dismisses the rest timer.
  onToggleRestTimer?: () => void;
  restTimerActive?: boolean;
  // Settings › Experiments › Timer in title bar: replaces the timer button.
  titleBarTimer?: Omit<TitleBarTimerProps, 'testID'>;
};

// Back · exercise name ▾ · timer · ⋮. No subtitle.
export function ExerciseTopBar({
  title,
  onBack,
  onOpenSwitcher,
  onOpenOptions,
  onToggleRestTimer,
  restTimerActive = false,
  titleBarTimer,
}: ExerciseTopBarProps) {
  return (
    <View style={styles.bar}>
      <IconButton accessibilityLabel="Back to session" name="chevron-left" onPress={onBack} testID="exercise-page-back" />
      {onOpenSwitcher ? (
        // The label is the bare name, so a title match by text still finds it.
        <Pressable
          accessibilityHint="Switch to another exercise of this session"
          accessibilityLabel={title}
          accessibilityRole="button"
          onPress={onOpenSwitcher}
          style={({ pressed }) => [styles.switcher, pressed ? styles.pressed : null]}
          testID="exercise-page-title">
          <Text allowFontScaling={false} numberOfLines={1} style={styles.switcherTitle}>
            {title}
          </Text>
          <Icon color={uiRoles.inkMuted} name="chevron-down" size="sm" />
        </Pressable>
      ) : (
        <Text allowFontScaling={false} accessibilityRole="header" numberOfLines={1} style={styles.title} testID="exercise-page-title">
          {title}
        </Text>
      )}
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

const titleText = {
  fontFamily: uiFonts.display.family,
  fontWeight: '700',
  fontSize: uiTypography.size.xl,
  lineHeight: uiTypography.lineHeight.xl,
  color: uiRoles.ink,
} as const;

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
    ...titleText,
  },
  switcher: {
    flex: 1,
    minWidth: 0,
    minHeight: uiGeometry.tapTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  // Shrinks before the ▾, so a long name truncates and the glyph stays.
  switcherTitle: {
    flexShrink: 1,
    minWidth: 0,
    ...titleText,
  },
  // The same feedback as the bar's icon buttons.
  pressed: {
    opacity: 0.7,
  },
});
