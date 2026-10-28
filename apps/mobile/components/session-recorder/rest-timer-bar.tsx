import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/segmented-control';
import { FigureText } from '@/components/ui/figure-text';
import { uiText, uiTextTone } from '@/components/ui/text-roles';
import { uiBorder, uiRoles, uiSpace } from '@/components/ui/tokens';
import {
  REPEATING_TIMER_STEP_SEC,
  REST_TIMER_STEP_SEC,
  type RestTimerView,
  type TimerMode,
} from '@/src/session-recorder/rest-timer';

import { RepeatingTimerFocus } from './repeating-timer-focus';

export type RestTimerBarProps = {
  view: RestTimerView;
  onAdjust: (deltaSec: number) => void;
  onRestart: () => void;
  onDismiss: () => void;
  onSwitchMode?: (mode: TimerMode) => void;
  onToggleRepeating?: () => void;
  onResetRepeating?: () => void;
  // The title-bar timer's card: hides the card and leaves the timer running.
  onCollapse?: () => void;
};

const MODE_OPTIONS: readonly SegmentedControlOption<TimerMode>[] = [
  { value: 'rest', label: 'Rest' },
  { value: 'repeating', label: 'Repeating' },
];

/**
 * The active-session timer strip rendered directly below `ExerciseTopBar` and
 * `SessionTopBar`. Supports both Rest timer (fixed countdown per set) and
 * Repeating timer (generalised EMOM interval with drift-free round tracking).
 * Preparation precedes round 1; tapping the repeating readout expands the same
 * timer fullscreen in either host. Collapsing never dismisses or pauses it.
 */
export function RestTimerBar({
  view,
  onAdjust,
  onRestart,
  onDismiss,
  onSwitchMode,
  onToggleRepeating,
  onResetRepeating,
  onCollapse,
}: RestTimerBarProps) {
  if (view.status === 'idle') {
    return null;
  }

  const isRepeating = view.mode === 'repeating';
  const isPaused = isRepeating && view.isPaused;
  const stepSec = isRepeating ? REPEATING_TIMER_STEP_SEC : REST_TIMER_STEP_SEC;

  return (
    <View style={styles.bar} testID="rest-timer-bar">
      <View style={styles.headerRow}>
        <SegmentedControl
          accessibilityLabel="Timer mode"
          density="compact"
          layout="inline"
          onChange={(nextMode) => onSwitchMode?.(nextMode)}
          options={MODE_OPTIONS}
          testIDPrefix="timer-mode-selector"
          value={isRepeating ? 'repeating' : 'rest'}
        />
        <View style={styles.headerActions}>
          {onCollapse ? (
            <IconButton
              accessibilityLabel="Hide timer controls"
              name="chevron-up"
              onPress={onCollapse}
              size="sm"
              testID="rest-timer-collapse"
              tone="muted"
            />
          ) : null}
          <IconButton
            accessibilityLabel="Dismiss timer"
            name="x"
            onPress={onDismiss}
            size="sm"
            testID="rest-timer-dismiss"
            tone="muted"
          />
        </View>
      </View>
      <View style={[styles.actionRow, isRepeating ? styles.repeatingActionRow : null]}>
        {isRepeating ? (
          <RepeatingTimerFocus
            key={view.sessionId}
            onAdjust={onAdjust}
            onReset={onResetRepeating ?? onRestart}
            onToggle={onToggleRepeating ?? onRestart}
            view={view}>
            <TimerReadout view={view} />
          </RepeatingTimerFocus>
        ) : <TimerReadout view={view} />}
        <View style={styles.controls}>
          <ActionButton
            accessibilityLabel={`Subtract ${stepSec} seconds`}
            label={`-${stepSec}s`}
            onPress={() => onAdjust(-stepSec)}
            size="compact"
            testID={isRepeating ? 'repeating-timer-minus-15' : 'rest-timer-minus-15'}
            variant="outline"
          />
          <ActionButton
            accessibilityLabel={`Add ${stepSec} seconds`}
            label={`+${stepSec}s`}
            onPress={() => onAdjust(stepSec)}
            size="compact"
            testID={isRepeating ? 'repeating-timer-plus-15' : 'rest-timer-plus-15'}
            variant="outline"
          />
          {isRepeating ? (
            <>
              <ActionButton
                accessibilityLabel={isPaused ? 'Resume repeating timer' : 'Pause repeating timer'}
                label={isPaused ? 'Resume' : 'Pause'}
                onPress={onToggleRepeating ?? onRestart}
                size="compact"
                testID="repeating-timer-toggle"
                variant="outline"
              />
              <ActionButton
                accessibilityLabel="Reset repeating timer"
                label="Reset"
                onPress={onResetRepeating ?? onRestart}
                size="compact"
                testID="repeating-timer-reset"
                variant="outline"
              />
            </>
          ) : (
            <ActionButton
              accessibilityLabel="Restart rest timer"
              label="Restart"
              onPress={onRestart}
              size="compact"
              testID="rest-timer-restart"
              variant="outline"
            />
          )}
        </View>
      </View>
    </View>
  );
}

function TimerReadout({ view }: { view: Exclude<RestTimerView, { status: 'idle' }> }) {
  const isRepeating = view.mode === 'repeating';
  const isCompleted = view.mode === 'rest' && view.status === 'completed';
  const isPaused = isRepeating && view.isPaused;
  const isPreparing = isRepeating && view.round === 0;
  const phase = isRepeating ? (isPreparing ? 'Get ready' : `Round ${view.round}`) : 'Rest';
  const statusLabel = isCompleted ? 'Rest complete' : phase;
  const accessiblePhase = isPreparing ? 'preparation' : phase.toLowerCase();
  // Repeating's View owns its changing label because iOS Text caches labels for repeated digits.
  const countdownLabel = isRepeating
    ? `Repeating timer ${accessiblePhase}, ${view.formatted} remaining${isPaused ? ', paused' : ''}`
    : `Rest timer ${view.formatted}`;

  return (
    <View
      accessible={isRepeating || undefined}
      accessibilityLabel={isRepeating ? countdownLabel : undefined}
      accessibilityLiveRegion={isRepeating ? 'none' : undefined}
      style={styles.readout}
      testID={isRepeating ? 'repeating-timer-readout' : undefined}>
      <Icon
        color={isCompleted ? uiRoles.ink : uiRoles.inkMuted}
        name={isCompleted ? 'success' : 'timer'}
        size="sm"
      />
      <Text
        allowFontScaling={false}
        style={[uiText.label, isCompleted ? uiTextTone.ink : null]}
        testID={isRepeating ? 'repeating-timer-round' : 'rest-timer-status'}>
        <FigureText>{statusLabel}</FigureText>
      </Text>
      <Text
        accessible={isRepeating ? false : undefined}
        allowFontScaling={false}
        accessibilityLabel={isRepeating ? undefined : countdownLabel}
        accessibilityLiveRegion={isRepeating ? 'none' : 'polite'}
        style={uiText.figureLarge}
        testID={isRepeating ? 'repeating-timer-countdown' : 'rest-timer-countdown'}>
        {view.formatted}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: uiRoles.surface,
    borderBottomWidth: uiBorder.width,
    borderBottomColor: uiRoles.rule,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.xs,
    gap: uiSpace.xs,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  readout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    flexShrink: 1,
  },
  repeatingActionRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  controls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
});
