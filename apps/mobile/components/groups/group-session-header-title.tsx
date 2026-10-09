import { StyleSheet, Text, View } from 'react-native';

import { Icon, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';

/**
 * The group session view's native header title: an eyebrow saying this is the
 * group's view (`Iron Crew · group view`) over who trained and when
 * (`sam · Mon 6 Oct`). One header element for VoiceOver.
 */
export function GroupSessionHeaderTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <View accessible accessibilityLabel={`${title}, ${eyebrow}`} accessibilityRole="header" style={styles.root} testID="group-session-title">
      <View style={styles.eyebrow}>
        <Icon color={uiRoles.inkMuted} name="users" size="xs" />
        <Text allowFontScaling={false} numberOfLines={1} style={styles.eyebrowText} testID="group-session-eyebrow">{eyebrow}</Text>
      </View>
      <Text allowFontScaling={false} numberOfLines={1} style={styles.title} testID="group-session-title-text">{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    maxWidth: 260,
  },
  eyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  eyebrowText: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
  },
  title: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
});
