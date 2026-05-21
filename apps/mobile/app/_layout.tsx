import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { AuthProvider, bootstrapAuthState } from '@/src/auth';
import { bootstrapLocalDataLayer } from '@/src/data';
import { ensureExerciseCatalogLoaded } from '@/src/exercise-catalog/cache';
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
    void ensureExerciseCatalogLoaded();
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
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="exercise-history" />
        <Stack.Screen name="profile" options={{ title: 'Profile' }} />
        <Stack.Screen name="maestro-harness" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style="auto" />
    </AuthProvider>
  );
}
