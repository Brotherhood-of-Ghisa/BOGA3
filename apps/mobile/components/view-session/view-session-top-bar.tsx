import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/ui/action-button';
import { IconButton } from '@/components/ui/icon-button';
import { uiBorder, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

type ViewSessionTopBarProps = {
  onBack: () => void;
  title?: string;
  // Both omitted while there is no session to act on (loading, error).
  onOpenOptions?: () => void;
  // Omitted while the session is deleted: the session view edits only a live
  // session.
  onEdit?: () => void;
};

// Back · title · ⋮ · Edit. The title is the session's (`Afternoon training ·
// 19 Feb`); `View Session` while there is none. Edit is the screen's one `accent` action and
// sits where the session view's Done sits, so the Edit → Done loop reads as one
// place.
export function ViewSessionTopBar({ onBack, onOpenOptions, onEdit, title = 'View Session' }: ViewSessionTopBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top }]} testID="completed-session-detail-top-bar">
      <IconButton accessibilityLabel="Back" name="chevron-left" onPress={onBack} testID="completed-session-detail-back" />
      {/* Shrinks to fit rather than truncate, as the active session's title does. */}
      <Text allowFontScaling={false} accessibilityRole="header" adjustsFontSizeToFit minimumFontScale={0.7}
        numberOfLines={1} style={styles.title} testID="completed-session-detail-title">
        {title}
      </Text>
      {onOpenOptions ? (
        <IconButton
          accessibilityLabel="Session options"
          name="more-vertical"
          onPress={onOpenOptions}
          testID="completed-session-detail-options-button"
        />
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
