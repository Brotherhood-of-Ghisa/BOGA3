import { useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo, findNodeHandle, Modal, Pressable, ScrollView, StyleSheet,
  Text, View, useWindowDimensions, type TextInstance, type ViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { ActionButton, Icon, IconButton, Screen, uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
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
 * countdown changes are read on demand, never announced every second.
 */
export function RepeatingTimerFocus({ view, onAdjust, onToggle, onReset, children }: Props) {
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef<ViewInstance>(null);
  const title = useRef<TextInstance>(null);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const diameter = Math.min(
    width - uiSpace.xxl,
    Math.max(uiGeometry.tapTarget * 6, height - insets.top - insets.bottom - uiGeometry.tapTarget * 4 - uiSpace.xxl * 2),
    uiGeometry.tapTarget * 10,
  );
  const phase = view.round === 0 ? 'Get ready' : `Round ${view.round}`;
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
              <View style={[styles.meter, { width: diameter, height: diameter }]}>
                <TimerRing diameter={diameter} view={view} />
                <View style={styles.readout}>
                  <Text allowFontScaling={false} style={styles.phase} testID="repeating-timer-focus-round">{phase}</Text>
                  <Text
                    accessibilityLabel={countdownLabel}
                    accessibilityLiveRegion="none"
                    adjustsFontSizeToFit
                    allowFontScaling={false}
                    minimumFontScale={0.5}
                    numberOfLines={1}
                    style={[styles.countdown, { fontSize: Math.min(uiTypography.size.timer, diameter / 3.4), lineHeight: Math.min(uiTypography.lineHeight.timer, diameter / 3) }]}
                    testID="repeating-timer-focus-countdown">
                    {view.formatted}
                  </Text>
                  <View style={styles.primary}>
                    <ActionButton accessibilityLabel={view.isPaused ? 'Start repeating timer' : 'Stop repeating timer'} label={view.isPaused ? 'Start' : 'Stop'} onPress={onToggle} testID="repeating-timer-focus-toggle" variant="primary" />
                  </View>
                  <ActionButton accessibilityLabel="Reset repeating timer" label="Reset" onPress={onReset} testID="repeating-timer-focus-reset" variant="text" />
                </View>
              </View>
              <View style={[styles.intervalRow, { width: diameter }]}>
                <View style={styles.intervalControl}>
                  <ActionButton accessibilityLabel="Subtract 15 seconds" disabled={view.intervalSec <= MIN_REPEATING_TIMER_INTERVAL_SECONDS} label="−15s" onPress={() => onAdjust(-REPEATING_TIMER_STEP_SEC)} testID="repeating-timer-focus-minus" variant="outline" />
                </View>
                <View style={styles.interval}>
                  <Text allowFontScaling={false} style={styles.phase}>Interval</Text>
                  <Text accessibilityLabel={`Interval ${formatRestTimerSeconds(view.intervalSec)}`} allowFontScaling={false} style={styles.intervalValue} testID="repeating-timer-focus-interval">{formatRestTimerSeconds(view.intervalSec)}</Text>
                </View>
                <View style={styles.intervalControl}>
                  <ActionButton accessibilityLabel="Add 15 seconds" disabled={view.intervalSec >= MAX_REPEATING_TIMER_INTERVAL_SECONDS} label="+15s" onPress={() => onAdjust(REPEATING_TIMER_STEP_SEC)} testID="repeating-timer-focus-plus" variant="outline" />
                </View>
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
  title: { fontFamily: uiFonts.display.family, fontWeight: '800', fontSize: uiTypography.size.xl, lineHeight: uiTypography.lineHeight.xl, color: uiRoles.ink },
  body: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: uiSpace.lg, gap: uiSpace.xxl },
  meter: { alignItems: 'center', justifyContent: 'center' },
  readout: { width: '80%', alignItems: 'center', gap: uiSpace.sm },
  phase: { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs, lineHeight: uiTypography.lineHeight.xxs, letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking, textTransform: 'uppercase', color: uiRoles.inkMuted },
  countdown: { alignSelf: 'stretch', textAlign: 'center', fontFamily: uiFonts.figure.family, fontWeight: '700', fontVariant: ['tabular-nums'], color: uiRoles.ink },
  primary: { width: '72%' },
  intervalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: uiSpace.sm },
  intervalControl: { width: '29%' },
  interval: { alignItems: 'center', gap: uiSpace.xs },
  intervalValue: { fontFamily: uiFonts.figure.family, fontWeight: '700', fontSize: uiTypography.size.xxl, lineHeight: uiTypography.lineHeight.xxl, color: uiRoles.ink },
});
