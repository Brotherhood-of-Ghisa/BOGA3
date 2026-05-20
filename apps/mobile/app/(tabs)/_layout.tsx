import { Tabs } from 'expo-router';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={() => null}>
      <Tabs.Screen name="stats-history" options={{ title: 'Stats/History' }} />
      <Tabs.Screen name="session-recorder" options={{ title: 'Session Recorder' }} />
      <Tabs.Screen name="exercise-catalog" options={{ title: 'Exercise Catalog' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', href: null }} />
    </Tabs>
  );
}
