import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type AccessibilityActionEvent, type ViewStyle } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { RestTimerView } from '@/src/session-recorder/rest-timer';

export type TitleBarTimerProps = {
  view: RestTimerView;
  // Start the last-used mode, stop a rest timer, pause or resume a repeating one.
  onPress: () => void;
  // Open the timer card.
  onLongPress: () => void;
  testID: string;
};

const HINT = 'Long press for the timer controls.';
const ACCESSIBILITY_ACTIONS = [
  { name: 'activate' },
  { name: 'longpress', label: 'Open timer controls' },
] as const;

/**
 * Settings › Experiments › Timer in title bar: the session and exercise title
 * bars' timer. Idle it is the timer glyph; running it is a pill counting down,
 * so the timer card stays closed. A finished rest inverts the pill to `ink`; a
 * paused repeating timer greys it.
 */
export function TitleBarTimer({ view, onPress, onLongPress, testID }: TitleBarTimerProps) {
  const copy = describeTitleBarTimer(view);
  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'longpress') onLongPress();
    else onPress();
  };

  return (
    <Pressable
      accessibilityActions={ACCESSIBILITY_ACTIONS}
      accessibilityHint={`${copy.tapHint} ${HINT}`}
      accessibilityLabel={copy.label}
      accessibilityRole="button"
      hitSlop={uiSpace.xs}
      onAccessibilityAction={onAccessibilityAction}
      onLongPress={onLongPress}
      onPress={onPress}
      style={({ pressed }) => [styles.control, pressed ? styles.pressed : null]}
      testID={testID}>
      {view.status === 'idle' ? (
        <Icon color={uiRoles.ink} name="timer" />
      ) : (
        <View style={[styles.pill, PILL_TONE[copy.tone]]} testID={`${testID}-pill`}>
          <Icon color={GLYPH_COLOR[copy.tone]} name={copy.tone === 'done' ? 'success' : 'timer'} size="sm" />
          <Text allowFontScaling={false} style={[styles.countdown, { color: GLYPH_COLOR[copy.tone] }]}
            testID={`${testID}-countdown`}>
            {view.formatted}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

type Tone = 'running' | 'paused' | 'done';

// What the control is called and what a tap does, by timer state.
export function describeTitleBarTimer(view: RestTimerView): { label: string; tapHint: string; tone: Tone } {
  if (view.status === 'idle') {
    return { label: 'Start timer', tapHint: 'Starts the timer you last used.', tone: 'running' };
  }
  if (view.mode === 'rest') {
    return view.status === 'completed'
      ? { label: 'Rest complete', tapHint: 'Clears the timer.', tone: 'done' }
      : { label: `Rest timer, ${view.formatted} remaining`, tapHint: 'Stops the timer.', tone: 'running' };
  }
  const phase = view.round === 0 ? 'preparation' : `round ${view.round}`;
  return view.isPaused
    ? { label: `Repeating timer ${phase}, ${view.formatted} remaining, paused`, tapHint: 'Resumes the timer.', tone: 'paused' }
    : { label: `Repeating timer ${phase}, ${view.formatted} remaining`, tapHint: 'Pauses the timer.', tone: 'running' };
}

type TimerControls = {
  view: RestTimerView;
  // Undefined where the session cannot run a timer (a completed session).
  toggleForSession?: () => void;
  tapTitleBar: () => void;
  startLastMode: () => void;
};

/**
 * A timer host's title-bar control and card; none on a completed session.
 * Off, the title bar keeps its
 * timer button and the card shows whenever a timer runs, as before. On, the
 * card shows only once opened by a long press (which starts the last-used mode
 * when idle), and closes on collapse or when the timer stops, so the next
 * start stays in the title bar.
 */
export function useTitleBarTimer(timer: TimerControls, setting: boolean) {
  const enabled = setting && timer.toggleForSession !== undefined;
  const [open, setOpen] = useState(false);
  if (open && timer.view.status === 'idle') setOpen(false);
  const openCard = () => {
    if (timer.view.status === 'idle') timer.startLastMode();
    setOpen(true);
  };
  return {
    cardVisible: timer.view.status !== 'idle' && (!enabled || open),
    collapseCard: enabled ? () => setOpen(false) : undefined,
    titleBarTimer: enabled
      ? { view: timer.view, onPress: timer.tapTitleBar, onLongPress: openCard }
      : undefined,
  };
}

const GLYPH_COLOR: Record<Tone, string> = {
  running: uiRoles.ink,
  paused: uiRoles.inkMuted,
  done: uiRoles.surface,
};

const styles = StyleSheet.create({
  control: {
    minWidth: uiGeometry.tapTarget,
    height: uiGeometry.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
    height: uiGeometry.compactControlHeight,
    paddingHorizontal: uiSpace.sm,
    borderRadius: uiGeometry.radius.pill,
    borderWidth: uiBorder.width,
  },
  running: {
    borderColor: uiRoles.rule,
  },
  paused: {
    borderColor: uiRoles.ruleSoft,
    borderStyle: 'dashed',
  },
  done: {
    borderColor: uiRoles.ink,
    backgroundColor: uiRoles.ink,
  },
  countdown: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    fontVariant: ['tabular-nums'],
  },
});

const PILL_TONE: Record<Tone, ViewStyle> = {
  running: styles.running,
  paused: styles.paused,
  done: styles.done,
};
