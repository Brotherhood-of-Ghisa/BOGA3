import { Tabs, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MainTabBar } from '@/components/navigation/main-tab-bar';
import { useHeaderStyleOptions } from '@/components/navigation/header-style';
import { useUiRoles } from '@/components/ui/theme-context';
import { mainTabHref, resolveMainTab } from '@/src/navigation/main-tabs';

/**
 * The tab layout's bar, selected from the tab navigator's own focused route.
 * Not from the global route: a screen pushed over the tabs (the session view)
 * would otherwise hide the bar before the push animates, and the tab screen
 * underneath would reflow (Train's disc dropped as it opened a workout).
 */
export function TabsBar({ routeName }: { routeName: string | undefined }) {
  const router = useRouter();
  const activeTab = routeName ? resolveMainTab([routeName]) : null;

  if (!activeTab) {
    return null;
  }

  return <MainTabBar activeTab={activeTab} onSelect={(tab) => router.push(mainTabHref(tab))} />;
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const roles = useUiRoles();
  const headerStyle = useHeaderStyleOptions();
  // The status-bar inset sits on the pages' own `paper` ground, so the top
  // bar and the page read as one surface (not the navigator's default grey).
  // Train clears the status bar itself: its workout's top bar runs under it.
  const sceneStyle = { backgroundColor: roles.paper, paddingTop: insets.top };
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle }}
      tabBar={({ state }) => <TabsBar routeName={state.routes[state.index]?.name} />}>
      <Tabs.Screen name="today" options={{ title: 'Today' }} />
      <Tabs.Screen name="train" options={{ title: 'Train', sceneStyle: { backgroundColor: roles.paper } }} />
      <Tabs.Screen name="progress" options={{ title: 'Progress' }} />
      {/* The one tab with a header: the group's name, its switch and Manage (`GroupScreenHeader`). */}
      <Tabs.Screen name="groups" options={{ ...GROUPS_TAB_OPTIONS, ...headerStyle }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
      {/* A preserved compatibility root: addressable, owned by Progress. */}
      <Tabs.Screen name="stats-history" options={{ title: 'History' }} />
    </Tabs>
  );
}

const GROUPS_TAB_OPTIONS = {
  title: 'Groups',
  headerShown: true,
  // The scene's padding already clears the status bar.
  headerStatusBarHeight: 0,
} as const;
