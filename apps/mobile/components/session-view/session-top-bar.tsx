import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/ui/action-button';
import { Icon } from '@/components/ui/icon';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

type SessionTopBarProps =
  | {
      // The active session: ⋮ opens the session options, Finish ends it.
      mode: 'active';
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
  active: { title: 'Session', label: 'Finish', a11y: 'Finish session', testID: 'session-view-finish-button' },
  completed: { title: 'Edit session', label: 'Done', a11y: 'Done editing session', testID: 'session-view-done-button' },
  complete: { title: 'Session complete', label: 'Done', a11y: 'Done with session completion', testID: 'session-completion-done' },
} as const;

// `Session` · ⋮ · Finish (build spec, "Session view"); `Edit session` · Done
// for a completed session; `Session complete` · Done after Finish. The primary
// is the screen's one `accent` action.
export function SessionTopBar(props: SessionTopBarProps) {
  const insets = useSafeAreaInsets();
  const copy = PRIMARY[props.mode];
  const onPrimary = props.mode === 'active' ? props.onFinish : props.onDone;
  const disabled = (props.mode === 'active' ? props.finishDisabled : props.doneDisabled) ?? false;

  return (
    <View
      style={[styles.bar, { paddingTop: insets.top }]}
      testID={props.mode === 'complete' ? 'session-completion-top-bar' : 'session-view-top-bar'}>
      <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
        {copy.title}
      </Text>
      {props.mode === 'active' ? (
        <Pressable
          accessibilityLabel="Session options"
          accessibilityRole="button"
          hitSlop={uiSpace.xs}
          onPress={props.onOpenOptions}
          style={styles.iconButton}
          testID="session-view-options-button">
          <Icon color={uiRoles.ink} name="more-vertical" size="md" />
        </Pressable>
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
        <View style={styles.iconButton} />
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
  },
  iconButton: {
    width: uiGeometry.tapTarget,
    height: uiGeometry.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
