import { Tabs, useRouter, useSegments } from 'expo-router';
import { useMemo } from 'react';

import { BottomTray, TrayVisibilityProvider } from '@/components/navigation/bottom-tray';
import { TopLevelTabs, type TopLevelTabKey } from '@/components/navigation/top-level-tabs';

const STATS_HISTORY_ROUTE = '/stats-history';
const SESSION_RECORDER_ROUTE = '/session-recorder';
const EXERCISE_CATALOG_ROUTE = '/exercise-catalog';
const SETTINGS_ROUTE = '/settings';

function resolveActiveTab(segments: string[]): TopLevelTabKey {
  // expo-router segments look like ['(tabs)', '<route-name>'] inside the group.
  const last = segments[segments.length - 1] ?? '';
  switch (last) {
    case 'session-recorder':
      return 'log';
    case 'exercise-catalog':
      return 'exercises';
    case 'stats-history':
    default:
      return 'stats-history';
  }
}

function TabsBottomTray() {
  const router = useRouter();
  const segments = useSegments();
  const activeTab = useMemo(() => resolveActiveTab(segments as string[]), [segments]);

  return (
    <BottomTray>
      <TopLevelTabs
        activeTab={activeTab}
        onPressStatsHistory={() => router.push(STATS_HISTORY_ROUTE)}
        onPressLog={() => router.push(SESSION_RECORDER_ROUTE)}
        onPressExercises={() => router.push(EXERCISE_CATALOG_ROUTE)}
        onPressSettings={() => router.push(SETTINGS_ROUTE)}
      />
    </BottomTray>
  );
}

export default function TabsLayout() {
  return (
    <TrayVisibilityProvider>
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={() => <TabsBottomTray />}>
        <Tabs.Screen name="stats-history" options={{ title: 'Stats/History' }} />
        <Tabs.Screen name="session-recorder" options={{ title: 'Session Recorder' }} />
        <Tabs.Screen name="exercise-catalog" options={{ title: 'Exercise Catalog' }} />
        <Tabs.Screen name="settings" options={{ title: 'Settings', href: null }} />
      </Tabs>
    </TrayVisibilityProvider>
  );
}
