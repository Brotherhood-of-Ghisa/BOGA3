import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/ui/action-button';
import { IconButton } from '@/components/ui/icon-button';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { formatElapsed, sessionTitleForStart } from '@/src/session-recorder/session-view-model';

type SessionTopBarProps =
  | {
      // The active session: ⋮ opens the session options, Finish ends it.
      mode: 'active';
      // Names the session by its time of day and drives the elapsed time.
      startedAt: Date;
      // Injectable clock for tests.
      now?: () => Date;
      onOpenOptions: () => void;
      onFinish: () => void;
      // While a Finish is being written, so a second tap cannot start another.
      finishDisabled?: boolean;
    }
  | {
      // A completed session being edited: no options (nothing to abandon),
      // and Done saves the edit instead of Finish.
      mode: 'completed';
      onDone: () => void;
      doneDisabled?: boolean;
    }
  | {
      // The completion screen after Finish: Done sits where Finish sat. Omitted
      // on its loading and unavailable states, which offer their own one exit.
      mode: 'complete';
      onDone?: () => void;
      doneDisabled?: boolean;
    };

const PRIMARY = {
  // The active title is live (`ActiveTitle`).
  active: { title: null, label: 'Finish', a11y: 'Finish session', testID: 'session-view-finish-button' },
  completed: { title: 'Edit session', label: 'Done', a11y: 'Done editing session', testID: 'session-view-done-button' },
  complete: { title: 'Session complete', label: 'Done', a11y: 'Done with session completion', testID: 'session-completion-done' },
} as const;

const systemNow = () => new Date();

// `Morning training · 42:17`: ticks on its own so the rest of the screen does
// not re-render each second.
function ActiveTitle({ startedAt, now }: { startedAt: Date; now: () => Date }) {
  const [current, setCurrent] = useState(now);
  useEffect(() => {
    const interval = setInterval(() => setCurrent(now()), 1000);
    return () => clearInterval(interval);
  }, [now]);

  return (
    // Shrinks to fit rather than truncate, so the elapsed time stays visible
    // past the hour on a narrow phone.
    <Text allowFontScaling={false} accessibilityRole="header" adjustsFontSizeToFit minimumFontScale={0.7}
      numberOfLines={1} style={styles.title} testID="session-view-title">
      {`${sessionTitleForStart(startedAt)} · ${formatElapsed(startedAt, current)}`}
    </Text>
  );
}

// `<Time of day> training · <elapsed>` · ⋮ · Finish;
// `Edit session` · Done for a completed session; `Session complete` · Done
// after Finish. The primary is the screen's one `accent` action.
export function SessionTopBar(props: SessionTopBarProps) {
  const insets = useSafeAreaInsets();
  const copy = PRIMARY[props.mode];
  const onPrimary = props.mode === 'active' ? props.onFinish : props.onDone;
  const disabled = (props.mode === 'active' ? props.finishDisabled : props.doneDisabled) ?? false;

  return (
    <View
      style={[styles.bar, { paddingTop: insets.top }]}
      testID={props.mode === 'complete' ? 'session-completion-top-bar' : 'session-view-top-bar'}>
      {props.mode === 'active' ? (
        <ActiveTitle now={props.now ?? systemNow} startedAt={props.startedAt} />
      ) : (
        <Text allowFontScaling={false} accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {copy.title}
        </Text>
      )}
      {props.mode === 'active' ? (
        <IconButton
          accessibilityLabel="Session options"
          hitSlop={uiSpace.xs}
          name="more-vertical"
          onPress={props.onOpenOptions}
          testID="session-view-options-button"
        />
      ) : null}
      {onPrimary ? (
        <ActionButton
          accessibilityLabel={copy.a11y}
          disabled={disabled}
          label={copy.label}
          onPress={onPrimary}
          testID={copy.testID}
          variant="primary"
        />
      ) : (
        // Keeps the bar's height when there is no Done.
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
    paddingLeft: uiSpace.lg,
    paddingRight: uiSpace.sm,
    paddingBottom: uiSpace.xs,
    backgroundColor: uiRoles.surface,
    borderBottomWidth: uiBorder.width,
    borderBottomColor: uiRoles.rule,
  },
  title: {
    flex: 1,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
    // The elapsed digits keep their width, so the title does not jitter.
    fontVariant: ['tabular-nums'],
  },
  spacer: {
    width: uiGeometry.tapTarget,
    height: uiGeometry.tapTarget,
  },
});
