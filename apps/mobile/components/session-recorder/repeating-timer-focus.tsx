import { useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo, findNodeHandle, Modal, Pressable, ScrollView, StyleSheet,
  Text, View, useWindowDimensions, type TextInstance, type ViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { ActionButton, Icon, IconButton, Screen, uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiText, uiTypography } from '@/components/ui';
import { MAX_REPEATING_TIMER_INTERVAL_SECONDS, MIN_REPEATING_TIMER_INTERVAL_SECONDS } from '@/src/preferences/model';
import { formatRestTimerSeconds, REPEATING_TIMER_PREPARATION_SEC, REPEATING_TIMER_STEP_SEC, type RepeatingTimerModeView } from '@/src/session-recorder/rest-timer';

type Props = {
  view: RepeatingTimerModeView;
  onAdjust: (deltaSec: number) => void;
  onToggle: () => void;
  onReset: () => void;
  children: ReactNode;
};

/**
 * A fullscreen presentation of the host's repeating timer, never another clock.
 * Close, Back and accessibility escape only collapse it. The store owns cues;
 * phase sits above a countdown-only ring, then interval, Pause/Resume and bottom
 * Reset. Countdown changes are read on demand, never announced every second.
 */
export function RepeatingTimerFocus({ view, onAdjust, onToggle, onReset, children }: Props) {
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef<ViewInstance>(null);
  const title = useRef<TextInstance>(null);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const controlsHeight = uiGeometry.tapTarget + uiSpace.sm * 2 + uiBorder.width
    + uiTypography.lineHeight.xxl * 2
    + uiText.label.lineHeight + uiSpace.xs + uiText.figureHero.lineHeight + uiSpace.lg + uiBorder.width
    + uiGeometry.tapTarget + uiSpace.xl + uiGeometry.tapTarget + uiSpace.xl + uiSpace.lg
    + uiSpace.lg * 6;
  const diameter = Math.min(
    width - uiSpace.xxl,
    Math.max(uiGeometry.tapTarget * 4, height - insets.top - insets.bottom - controlsHeight),
    uiGeometry.tapTarget * 10,
  );
  const phase = view.round === 0 ? 'Get ready' : `Round ${view.round}`;
  // iOS Text caches spoken labels when visible digits repeat; the existing View owns the label.
  const countdownLabel = `${phase}, ${view.formatted} remaining${view.isPaused ? ', paused' : ''}`;
  const close = () => setExpanded(false);

  return (
    <>
      <Pressable
        accessibilityLabel="Expand repeating timer"
        accessibilityRole="button"
        accessibilityValue={{ text: countdownLabel }}
        onPress={() => setExpanded(true)}
        ref={trigger}
        style={styles.trigger}
        testID="repeating-timer-expand">
        {children}
        <Icon color={uiRoles.inkMuted} name="chevron-right" size="sm" />
      </Pressable>
      <Modal
        animationType="slide"
        onDismiss={() => focus(trigger.current)}
        onRequestClose={close}
        onShow={() => focus(title.current)}
        presentationStyle="fullScreen"
        testID="repeating-timer-focus-modal"
        visible={expanded}>
        <Screen>
          <View
            accessibilityViewIsModal
            onAccessibilityEscape={close}
            style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
            testID="repeating-timer-focus">
            <View style={styles.header}>
              <Text allowFontScaling={false} accessibilityRole="header" ref={title} style={styles.title}>Repeating</Text>
              <IconButton accessibilityLabel="Collapse repeating timer" name="x" onPress={close} testID="repeating-timer-focus-close" />
            </View>
            <ScrollView contentContainerStyle={styles.body}>
              <Text adjustsFontSizeToFit allowFontScaling={false} minimumFontScale={0.5} numberOfLines={1} style={styles.phase} testID="repeating-timer-focus-round">{phase}</Text>
              <View style={[styles.meter, { width: diameter, height: diameter }]} testID="repeating-timer-focus-meter">
                <TimerRing diameter={diameter} view={view} />
                <View
                  accessible
                  accessibilityLabel={countdownLabel}
                  accessibilityLiveRegion="none"
                  style={styles.readout}
                  testID="repeating-timer-focus-readout">
                  <Text
                    accessible={false}
                    accessibilityLiveRegion="none"
                    adjustsFontSizeToFit
                    allowFontScaling={false}
                    minimumFontScale={0.5}
                    numberOfLines={1}
                    style={[styles.countdown, { fontSize: Math.min(uiTypography.size.timer, diameter / 3.4), lineHeight: Math.min(uiTypography.lineHeight.timer, diameter / 3) }]}
                    testID="repeating-timer-focus-countdown">
                    {view.formatted}
                  </Text>
                </View>
              </View>
              <View style={[styles.intervalRow, { width: diameter }]}>
                <View style={styles.intervalControl}>
                  <ActionButton accessibilityLabel="Subtract 15 seconds" disabled={view.intervalSec <= MIN_REPEATING_TIMER_INTERVAL_SECONDS} label="−15s" onPress={() => onAdjust(-REPEATING_TIMER_STEP_SEC)} testID="repeating-timer-focus-minus" variant="outline" />
                </View>
                <View style={styles.interval}>
                  <Text allowFontScaling={false} style={styles.intervalLabel}>Interval</Text>
                  <Text accessibilityLabel={`Interval ${formatRestTimerSeconds(view.intervalSec)}`} allowFontScaling={false} style={styles.intervalValue} testID="repeating-timer-focus-interval">{formatRestTimerSeconds(view.intervalSec)}</Text>
                </View>
                <View style={styles.intervalControl}>
                  <ActionButton accessibilityLabel="Add 15 seconds" disabled={view.intervalSec >= MAX_REPEATING_TIMER_INTERVAL_SECONDS} label="+15s" onPress={() => onAdjust(REPEATING_TIMER_STEP_SEC)} testID="repeating-timer-focus-plus" variant="outline" />
                </View>
              </View>
              <View style={styles.primary}>
                <ActionButton accessibilityLabel={view.isPaused ? 'Resume repeating timer' : 'Pause repeating timer'} label={view.isPaused ? 'Resume' : 'Pause'} onPress={onToggle} size="large" testID="repeating-timer-focus-toggle" variant="primary" />
              </View>
              <View style={styles.reset}>
                <ActionButton accessibilityLabel="Reset repeating timer" label="Reset" onPress={onReset} size="large" testID="repeating-timer-focus-reset" variant="text" />
              </View>
            </ScrollView>
          </View>
        </Screen>
      </Modal>
    </>
  );
}

function focus(node: ViewInstance | TextInstance | null) {
  const handle = findNodeHandle(node);
  if (typeof handle === 'number') AccessibilityInfo.setAccessibilityFocus(handle);
}

function TimerRing({ diameter, view }: { diameter: number; view: RepeatingTimerModeView }) {
  const stroke = uiSpace.sm;
  const radius = (diameter - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const duration = view.round === 0 ? REPEATING_TIMER_PREPARATION_SEC : view.intervalSec;
  const remaining = Math.min(1, Math.max(0, view.remainingSec / duration));
  return (
    <Svg accessible={false} height={diameter} pointerEvents="none" style={StyleSheet.absoluteFill} width={diameter}>
      <Circle cx={diameter / 2} cy={diameter / 2} fill="none" r={radius} stroke={uiRoles.rule} strokeWidth={stroke} />
      <Circle cx={diameter / 2} cy={diameter / 2} fill="none" r={radius} rotation={-90} origin={`${diameter / 2}, ${diameter / 2}`} stroke={uiRoles.accent} strokeDasharray={[circumference, circumference]} strokeDashoffset={circumference * (1 - remaining)} strokeLinecap="round" strokeWidth={stroke} testID="repeating-timer-focus-progress" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: uiGeometry.tapTarget, gap: uiSpace.sm },
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: uiSpace.lg, paddingVertical: uiSpace.sm, borderBottomWidth: uiBorder.width, borderBottomColor: uiRoles.rule },
  title: uiText.sheetTitle,
  body: { flexGrow: 1, alignItems: 'center', padding: uiSpace.lg, gap: uiSpace.lg },
  meter: { alignItems: 'center', justifyContent: 'center' },
  readout: { width: '80%', alignItems: 'center', gap: uiSpace.sm },
  phase: { alignSelf: 'stretch', textAlign: 'center', fontFamily: uiFonts.display.family, fontWeight: '800', fontSize: uiTypography.size.xxl * 2, lineHeight: uiTypography.lineHeight.xxl * 2, color: uiRoles.ink },
  intervalLabel: uiText.label,
  countdown: { alignSelf: 'stretch', textAlign: 'center', fontFamily: uiFonts.figure.family, fontWeight: '700', fontVariant: ['tabular-nums'], color: uiRoles.ink },
  primary: { alignSelf: 'stretch' },
  reset: { marginTop: 'auto', paddingTop: uiSpace.lg, alignSelf: 'stretch' },
  intervalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: uiSpace.sm, borderTopWidth: uiBorder.width, borderTopColor: uiRoles.rule, paddingTop: uiSpace.lg },
  intervalControl: { width: '29%' },
  interval: { alignItems: 'center', gap: uiSpace.xs },
  intervalValue: uiText.figureHero,
});
