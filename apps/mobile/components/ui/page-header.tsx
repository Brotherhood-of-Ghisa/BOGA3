import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

type PageHeaderProps = {
  title: string;
  // One line under the title saying what the screen is for.
  intro?: string;
};

// A tab screen's in-content title (the tab screens have no native header):
// Archivo 800 at `xxl`, with an optional `ink-muted` intro.
export function PageHeader({ title, intro }: PageHeaderProps) {
  return (
    <View style={styles.page}>
      <Text accessibilityRole="header" style={styles.pageTitle}>
        {title}
      </Text>
      {intro ? <Text style={styles.intro}>{intro}</Text> : null}
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
      <Text accessibilityRole="header" style={styles.sectionTitle}>
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
  pageTitle: {
    fontFamily: uiFonts.display.family,
    fontWeight: '800',
    fontSize: uiTypography.size.xxl,
    lineHeight: uiTypography.lineHeight.xxl,
    color: uiRoles.ink,
  },
  intro: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  sectionTitle: {
    flex: 1,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
});
