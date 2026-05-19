import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { AuthProvider, bootstrapAuthState } from '@/src/auth';
import { bootstrapLocalDataLayer } from '@/src/data';
import {
  setDefaultSyncCadenceContextFromPathname,
  startSyncRuntime,
  startDefaultSyncScheduler,
  stopSyncRuntime,
  stopDefaultSyncScheduler,
} from '@/src/sync';

export default function RootLayout() {
  const pathname = usePathname();

  useEffect(() => {
    void bootstrapLocalDataLayer();
    void bootstrapAuthState();
    startSyncRuntime();
    startDefaultSyncScheduler();

    return () => {
      stopSyncRuntime();
      stopDefaultSyncScheduler();
    };
  }, []);

  useEffect(() => {
    setDefaultSyncCadenceContextFromPathname(pathname);
  }, [pathname]);

  return (
    <AuthProvider>
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Sessions' }} />
        <Stack.Screen name="session-list" options={{ title: 'Sessions' }} />
        <Stack.Screen name="session-recorder" options={{ title: 'Session Recorder' }} />
        <Stack.Screen name="exercise-catalog" options={{ title: 'Exercise Catalog' }} />
        <Stack.Screen name="stats" options={{ title: 'Stats' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="profile" options={{ title: 'Profile' }} />
        <Stack.Screen name="maestro-harness" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style="auto" />
    </AuthProvider>
  );
}
