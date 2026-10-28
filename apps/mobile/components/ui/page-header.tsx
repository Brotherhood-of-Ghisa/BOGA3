import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { uiText } from '@/components/ui/text-roles';
import { uiSpace } from '@/components/ui/tokens';

type PageHeaderProps = {
  title: string;
};

// A tab screen's in-content title (the tab screens have no native header):
// Archivo 800 at `xxl`, standing alone ([[copy.no-subtitles]]).
export function PageHeader({ title }: PageHeaderProps) {
  return (
    <View style={styles.page}>
      <Text allowFontScaling={false} accessibilityRole="header" style={uiText.pageTitle}>
        {title}
      </Text>
    </View>
  );
}

type SectionHeaderProps = {
  title: string;
  // A way to the full view of the section ("View groups"): a caps text button,
  // never the screen's primary.
  action?: { label: string; onPress: () => void; testID?: string; accessibilityLabel?: string };
};

// A section's heading inside a screen: Archivo 700 at `lg`, with an optional
// text action on the right.
export function SectionHeader({ title, action }: SectionHeaderProps) {
  return (
    <View style={styles.section}>
      <Text allowFontScaling={false} accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {action ? (
        <ActionButton
          accessibilityLabel={action.accessibilityLabel}
          label={action.label}
          onPress={action.onPress}
          testID={action.testID}
          variant="text"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    gap: uiSpace.xs,
  },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  sectionTitle: {
    ...uiText.title,
    flex: 1,
  },
});
