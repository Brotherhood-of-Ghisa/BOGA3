import { StyleSheet, Text, View } from 'react-native';

import { Icon, uiSpace, useUiText, useUiTextTone } from '@/components/ui';

/**
 * The group session view's native header title, in the page inks: an eyebrow saying this is the
 * group's view (`Iron Crew · group view`) over who trained and when
 * (`sam · Mon 6 Oct`). One header element for VoiceOver.
 */
export function GroupSessionHeaderTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  const text = useUiText();
  const tone = useUiTextTone();
  return (
    <View accessible accessibilityLabel={`${title}, ${eyebrow}`} accessibilityRole="header" style={styles.root} testID="group-session-title">
      <View style={styles.eyebrow}>
        <Icon colorRole="pageInkMuted" name="users" size="xs" />
        <Text allowFontScaling={false} numberOfLines={1} style={[text.label, tone.pageMuted]} testID="group-session-eyebrow">{eyebrow}</Text>
      </View>
      <Text allowFontScaling={false} numberOfLines={1} style={[text.title, tone.page]} testID="group-session-title-text">{title}</Text>
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
