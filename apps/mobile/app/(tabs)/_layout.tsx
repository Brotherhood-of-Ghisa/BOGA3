import { Tabs, useRouter, useSegments } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTray, TrayVisibilityProvider } from '@/components/navigation/bottom-tray';
import { TopLevelTabs, type TopLevelTabKey } from '@/components/navigation/top-level-tabs';

const STATS_HISTORY_ROUTE = '/stats-history';
const SESSION_RECORDER_ROUTE = '/session-recorder';
const EXERCISE_CATALOG_ROUTE = '/exercise-catalog';
const GROUPS_ROUTE = '/groups';
const SETTINGS_ROUTE = '/settings';

export function resolveActiveTab(segments: string[]): TopLevelTabKey {
  // expo-router segments look like ['(tabs)', '<route-name>'] inside the group.
  const last = segments[segments.length - 1] ?? '';
  switch (last) {
    case 'session-recorder':
      return 'log';
    case 'exercise-catalog':
      return 'exercises';
    case 'groups':
      return 'groups';
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
        onPressGroups={() => router.push(GROUPS_ROUTE)}
        onPressSettings={() => router.push(SETTINGS_ROUTE)}
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
          <Tabs.Screen name="stats-history" options={{ title: 'History' }} />
          <Tabs.Screen name="session-recorder" options={{ title: 'Session Recorder' }} />
          <Tabs.Screen name="exercise-catalog" options={{ title: 'Exercise Catalog' }} />
          <Tabs.Screen name="groups" options={{ title: 'Groups' }} />
          <Tabs.Screen name="settings" options={{ title: 'Settings', href: null }} />
          {/* M26 route adapters stay out of the production tab bar until the
              four destination surfaces are ready for the T06 cutover. */}
          <Tabs.Screen name="today" options={{ title: 'Today', href: null }} />
          <Tabs.Screen name="train" options={{ title: 'Train', href: null }} />
          <Tabs.Screen name="progress" options={{ title: 'Progress', href: null }} />
          <Tabs.Screen name="more" options={{ title: 'More', href: null }} />
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
