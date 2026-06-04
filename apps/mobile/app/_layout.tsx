import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthRouteGuard } from '@/components/navigation/auth-route-guard';
import { AuthProvider, bootstrapAuthState } from '@/src/auth';
import { bootstrapLocalDataLayer } from '@/src/data';
import { ensureExerciseCatalogLoaded } from '@/src/exercise-catalog/cache';
import { registerBackgroundSyncTask } from '@/src/sync/background-task';
import { startSyncGateStateBridge, stopSyncGateStateBridge } from '@/src/sync/sync-gate-state-bridge';
import { requestSync, startSyncScheduler, stopSyncScheduler } from '@/src/sync/scheduler';
import { SyncGate } from '@/src/sync/SyncGate';

export default function RootLayout() {
  useEffect(() => {
    // The scheduler must wire first. A wiring failure here re-throws and crashes
    // boot by design (a broken native build leaves sync permanently dead); it
    // must NOT be caught into a recoverable gate state, so nothing below runs if
    // it throws.
    startSyncScheduler();

    // Observe the runtime-state flag and the cycle's error signals so the
    // first-sync gate can decide whether to block. Started only after the
    // scheduler wired successfully.
    startSyncGateStateBridge();

    // Ask the OS to schedule the background sync task. Registration is async and
    // must not block boot, and a rejection (e.g. Background App Refresh disabled
    // by the user) must not crash the app — the foreground scheduler still runs.
    void registerBackgroundSyncTask().catch(() => {
      // Swallow: a failed registration just means no OS-driven background runs;
      // foreground sync is unaffected.
    });

    void Promise.allSettled([
      bootstrapLocalDataLayer(),
      bootstrapAuthState(),
      ensureExerciseCatalogLoaded(),
    ]).finally(() => {
      // One cold-launch nudge once the boot sequence settles. It is a no-op
      // until the network projection first goes online, after which the
      // scheduler is already heading into its first cycle.
      requestSync();
    });

    return () => {
      stopSyncGateStateBridge();
      stopSyncScheduler();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AuthRouteGuard>
          <SyncGate>
            <Stack>
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="sign-in" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="exercise-history" />
              <Stack.Screen name="sessions" options={{ title: 'Sessions' }} />
              <Stack.Screen name="profile" options={{ title: 'Profile' }} />
              <Stack.Screen name="maestro-harness" options={{ headerShown: false }} />
            </Stack>
          </SyncGate>
        </AuthRouteGuard>
        <StatusBar style="auto" />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
