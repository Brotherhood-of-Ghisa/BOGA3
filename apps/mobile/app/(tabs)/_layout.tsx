import { Tabs, useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MainTabBar } from '@/components/navigation/main-tab-bar';
import { useOpenMainTab } from '@/components/navigation/use-open-main-tab';
import { resolveMainTab } from '@/src/navigation/main-tabs';

/**
 * The tab layout's bar, selected from the tab navigator's own focused route.
 * Not from the global route: a screen pushed over the tabs (the session view)
 * would otherwise hide the bar before the push animates, and the tab screen
 * underneath would reflow (Train's disc dropped as it opened a workout).
 */
export function TabsBar({ routeName }: { routeName: string | undefined }) {
  const router = useRouter();
  const activeTab = routeName ? resolveMainTab([routeName]) : null;
  const openTab = useOpenMainTab(useCallback((href: Href) => router.push(href), [router]));

  if (!activeTab) {
    return null;
  }

  return <MainTabBar activeTab={activeTab} onSelect={openTab} />;
}

export default function TabsLayout() {
  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={({ state }) => <TabsBar routeName={state.routes[state.index]?.name} />}>
        <Tabs.Screen name="today" options={{ title: 'Today' }} />
        <Tabs.Screen name="train" options={{ title: 'Train' }} />
        <Tabs.Screen name="progress" options={{ title: 'Progress' }} />
        <Tabs.Screen name="more" options={{ title: 'More' }} />
        {/* Preserved compatibility roots remain directly addressable but are
            owned by the four canonical destinations rather than visible. */}
        <Tabs.Screen name="stats-history" options={{ title: 'History' }} />
        <Tabs.Screen name="exercise-catalog" options={{ title: 'Exercise Catalog' }} />
        <Tabs.Screen name="groups" options={{ title: 'Groups' }} />
        <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
      </Tabs>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
});
