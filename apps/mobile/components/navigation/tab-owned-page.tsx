import type { ReactNode } from 'react';
import { View } from 'react-native';

import { MainTabBar } from '@/components/navigation/main-tab-bar';
import { useOpenMainTabFromPage } from '@/components/navigation/use-open-main-tab';
import { makeStyles } from '@/components/ui/theme-context';
import type { MainTabKey } from '@/src/navigation/main-tabs';

type TabOwnedPageProps = {
  children: ReactNode;
  // The tab the page belongs to (`resolveMainTab`); More owns all of them today.
  activeTab?: MainTabKey;
};

/**
 * A root-stack page that keeps the bottom tab bar (Exercises, Settings): the native header on top, its owner tab selected below. A tab
 * press closes the page with no animation and reuses the tabs underneath
 * (`useOpenMainTabFromPage`).
 */
export function TabOwnedPage({ children, activeTab = 'more' }: TabOwnedPageProps) {
  const styles = useStyles();
  const openTab = useOpenMainTabFromPage();
  return (
    <View style={styles.page}>
      <View style={styles.body}>{children}</View>
      <MainTabBar activeTab={activeTab} onSelect={openTab} />
    </View>
  );
}

const useStyles = makeStyles((roles) => ({
  page: {
    flex: 1,
    backgroundColor: roles.paper,
  },
  body: {
    flex: 1,
  },
}));
