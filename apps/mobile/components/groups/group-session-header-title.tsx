import { StyleSheet, Text, View } from 'react-native';

import { Icon, uiRoles, uiSpace, uiText } from '@/components/ui';

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
        <Text allowFontScaling={false} numberOfLines={1} style={uiText.label} testID="group-session-eyebrow">{eyebrow}</Text>
      </View>
      <Text allowFontScaling={false} numberOfLines={1} style={uiText.title} testID="group-session-title-text">{title}</Text>
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
});
