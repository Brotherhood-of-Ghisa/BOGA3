import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { REST_TIMER_STEP_SEC, type RestTimerView } from '@/src/session-recorder/rest-timer';

export type RestTimerBarProps = {
  view: RestTimerView;
  onAdjust: (deltaSec: number) => void;
  onRestart: () => void;
  onDismiss: () => void;
};

/**
 * The active-session rest timer strip rendered directly below `ExerciseTopBar`
 * and `SessionTopBar`. Hidden while idle; shows the live `M:SS` countdown while
 * running and stops at `0:00` (`Rest complete`) when finished until dismissed,
 * restarted, or replaced by the next confirmed set.
 */
export function RestTimerBar({ view, onAdjust, onRestart, onDismiss }: RestTimerBarProps) {
  if (view.status === 'idle') {
    return null;
  }

  const isCompleted = view.status === 'completed';

  return (
    <View style={styles.bar} testID="rest-timer-bar">
      <View style={styles.readout}>
        <Icon
          color={isCompleted ? uiRoles.ink : uiRoles.inkMuted}
          name={isCompleted ? 'success' : 'timer'}
          size="sm"
        />
        <Text
          allowFontScaling={false}
          style={[styles.statusLabel, isCompleted ? styles.statusCompleted : null]}
          testID="rest-timer-status">
          {isCompleted ? 'Rest complete' : 'Rest'}
        </Text>
        <Text
          allowFontScaling={false}
          accessibilityLabel={`Rest timer ${view.formatted}`}
          accessibilityLiveRegion="polite"
          style={styles.countdown}
          testID="rest-timer-countdown">
          {view.formatted}
        </Text>
      </View>
      <View style={styles.controls}>
        <ActionButton
          accessibilityLabel={`Subtract ${REST_TIMER_STEP_SEC} seconds from rest timer`}
          label={`-${REST_TIMER_STEP_SEC}s`}
          onPress={() => onAdjust(-REST_TIMER_STEP_SEC)}
          size="compact"
          testID="rest-timer-minus-15"
          variant="outline"
        />
        <ActionButton
          accessibilityLabel={`Add ${REST_TIMER_STEP_SEC} seconds to rest timer`}
          label={`+${REST_TIMER_STEP_SEC}s`}
          onPress={() => onAdjust(REST_TIMER_STEP_SEC)}
          size="compact"
          testID="rest-timer-plus-15"
          variant="outline"
        />
        <ActionButton
          accessibilityLabel="Restart rest timer"
          label="Restart"
          onPress={onRestart}
          size="compact"
          testID="rest-timer-restart"
          variant="outline"
        />
        <IconButton
          accessibilityLabel="Dismiss rest timer"
          name="x"
          onPress={onDismiss}
          size="sm"
          testID="rest-timer-dismiss"
          tone="muted"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
    paddingLeft: uiSpace.md,
    paddingRight: uiSpace.xs,
    paddingVertical: uiSpace.xs,
    backgroundColor: uiRoles.surface,
    borderBottomWidth: uiBorder.width,
    borderBottomColor: uiRoles.rule,
  },
  readout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    flexShrink: 1,
  },
  statusLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
  },
  statusCompleted: {
    color: uiRoles.ink,
  },
  countdown: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
    fontVariant: ['tabular-nums'],
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
});
