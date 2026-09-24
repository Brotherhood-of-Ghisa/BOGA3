import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/ui/action-button';
import { Icon } from '@/components/ui/icon';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

type ViewSessionTopBarProps = {
  onBack: () => void;
  // Both omitted while there is no session to act on (loading, error).
  onOpenOptions?: () => void;
  // Omitted while the session is deleted: the session view edits only a live
  // session.
  onEdit?: () => void;
};

// Back · `View Session` · ⋮ · Edit. Edit is the screen's one `accent` action and
// sits where the session view's Done sits, so the Edit → Done loop reads as one
// place.
export function ViewSessionTopBar({ onBack, onOpenOptions, onEdit }: ViewSessionTopBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top }]} testID="completed-session-detail-top-bar">
      <Pressable
        accessibilityLabel="Back"
        accessibilityRole="button"
        onPress={onBack}
        style={styles.control}
        testID="completed-session-detail-back">
        <Icon color={uiRoles.ink} name="chevron-left" />
      </Pressable>
      <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
        View Session
      </Text>
      {onOpenOptions ? (
        <Pressable
          accessibilityLabel="Session options"
          accessibilityRole="button"
          onPress={onOpenOptions}
          style={styles.control}
          testID="completed-session-detail-options-button">
          <Icon color={uiRoles.ink} name="more-vertical" />
        </Pressable>
      ) : null}
      {onEdit ? (
        <ActionButton
          accessibilityLabel="Edit session"
          label="Edit"
          onPress={onEdit}
          testID="completed-session-detail-edit-button"
          variant="primary"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
    paddingLeft: uiSpace.xs,
    paddingRight: uiSpace.sm,
    paddingBottom: uiSpace.xs,
    backgroundColor: uiRoles.surface,
    borderBottomWidth: uiBorder.width,
    borderBottomColor: uiRoles.rule,
  },
  control: {
    width: uiGeometry.tapTarget,
    height: uiGeometry.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
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
