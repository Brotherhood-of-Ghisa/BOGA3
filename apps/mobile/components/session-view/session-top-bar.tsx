import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/icon';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

type SessionTopBarProps = {
  onOpenOptions: () => void;
  onFinish: () => void;
  // While a Finish is being written, so a second tap cannot start another.
  finishDisabled?: boolean;
};

// `Session` · ⋮ · Finish (build spec, "Session view"). Finish is the screen's
// one `accent` primary; ⋮ opens the session options sheet.
export function SessionTopBar({ onOpenOptions, onFinish, finishDisabled = false }: SessionTopBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingTop: insets.top }]} testID="session-view-top-bar">
      <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
        Session
      </Text>
      <Pressable
        accessibilityLabel="Session options"
        accessibilityRole="button"
        hitSlop={uiSpace.xs}
        onPress={onOpenOptions}
        style={styles.iconButton}
        testID="session-view-options-button">
        <Icon color={uiRoles.ink} name="more-vertical" size="md" />
      </Pressable>
      <Pressable
        accessibilityLabel="Finish session"
        accessibilityRole="button"
        accessibilityState={{ disabled: finishDisabled }}
        disabled={finishDisabled}
        onPress={onFinish}
        style={[styles.finish, finishDisabled ? styles.finishDisabled : null]}
        testID="session-view-finish-button">
        <Text style={styles.finishLabel}>Finish</Text>
      </Pressable>
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
  finish: {
    minHeight: uiGeometry.tapTarget,
    paddingHorizontal: uiSpace.md,
    borderRadius: uiGeometry.radius.card,
    backgroundColor: uiRoles.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishDisabled: {
    backgroundColor: uiRoles.disabled,
  },
  finishLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    letterSpacing: uiTypography.size.sm * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.surface,
  },
});
