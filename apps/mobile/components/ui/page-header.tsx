import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

type PageHeaderProps = {
  title: string;
};

// A tab screen's in-content title (the tab screens have no native header):
// Archivo 800 at `xxl`, standing alone ([[copy.no-subtitles]]).
export function PageHeader({ title }: PageHeaderProps) {
  return (
    <View style={styles.page}>
      <Text allowFontScaling={false} accessibilityRole="header" style={styles.pageTitle}>
        {title}
      </Text>
    </View>
  );
}

type TitleBarProps = {
  title: string;
  // Before the title: the screen's way back (`MoreHubBackButton`), if any.
  back?: ReactNode;
  // After the title, at the right edge: the screen's header actions (⋮).
  actions?: ReactNode;
  testID?: string;
};

// A tab-group screen's top bar, drawn as the native stack header is: one line
// of back arrow, Archivo 700 `ink` title at `xl`, and actions on the right.
// For a screen that keeps the tab bar, so cannot take a native header.
export function TitleBar({ title, back, actions, testID }: TitleBarProps) {
  return (
    <View style={styles.bar} testID={testID}>
      {back}
      <Text
        allowFontScaling={false}
        accessibilityRole="header"
        ellipsizeMode="tail"
        numberOfLines={1}
        style={styles.barTitle}>
        {title}
      </Text>
      {actions ? <View style={styles.barActions}>{actions}</View> : null}
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
  pageTitle: {
    fontFamily: uiFonts.display.family,
    fontWeight: '800',
    fontSize: uiTypography.size.xxl,
    lineHeight: uiTypography.lineHeight.xxl,
    color: uiRoles.ink,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  barTitle: {
    flex: 1,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
  barActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: -uiSpace.xs,
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
