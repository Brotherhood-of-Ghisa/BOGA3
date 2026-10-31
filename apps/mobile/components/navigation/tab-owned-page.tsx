import { useRouter, type Href } from 'expo-router';
import { useCallback, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { MainTabBar } from '@/components/navigation/main-tab-bar';
import { useOpenMainTab } from '@/components/navigation/use-open-main-tab';
import { uiRoles } from '@/components/ui/tokens';
import type { MainTabKey } from '@/src/navigation/main-tabs';

type TabOwnedPageProps = {
  children: ReactNode;
  // The tab the page belongs to (`resolveMainTab`); More owns all of them today.
  activeTab?: MainTabKey;
};

/**
 * A root-stack page that keeps the bottom tab bar (Exercises, Settings): the native header on top, its owner tab selected below. A tab
 * press returns by `dismissTo`, so the tabs underneath are reused rather than
 * stacked, as from the session view.
 */
export function TabOwnedPage({ children, activeTab = 'more' }: TabOwnedPageProps) {
  const router = useRouter();
  const openTab = useOpenMainTab(useCallback((href: Href) => router.dismissTo(href), [router]));
  return (
    <View style={styles.page}>
      <View style={styles.body}>{children}</View>
      <MainTabBar activeTab={activeTab} onSelect={openTab} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: uiRoles.paper,
  },
  body: {
    flex: 1,
  },
});
