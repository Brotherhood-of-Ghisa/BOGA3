import { Tabs, useRouter, useSegments, type Href } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTray, TrayVisibilityProvider } from '@/components/navigation/bottom-tray';
import { MainTabs } from '@/components/navigation/main-tabs';
import { useOpenMainTab } from '@/components/navigation/use-open-main-tab';
import {
  resolveMainTab,
  shouldShowMainNavigation,
} from '@/src/navigation/main-tabs';

function TabsBottomTray() {
  const router = useRouter();
  const segments = useSegments();
  const routeSegments = segments as string[];
  const activeTab = useMemo(() => resolveMainTab(routeSegments), [routeSegments]);
  const isVisible = useMemo(
    () => shouldShowMainNavigation(routeSegments),
    [routeSegments],
  );
  const openTab = useOpenMainTab(useCallback((href: Href) => router.push(href), [router]));

  if (!activeTab || !isVisible) {
    return null;
  }

  return (
    <BottomTray>
      <MainTabs
        activeTab={activeTab}
        onSelect={openTab}
      />
    </BottomTray>
  );
}

export default function TabsLayout() {
  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <TrayVisibilityProvider>
        <Tabs
          screenOptions={{ headerShown: false }}
          tabBar={() => <TabsBottomTray />}>
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
      </TrayVisibilityProvider>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
});
