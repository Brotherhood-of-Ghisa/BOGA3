import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthRouteGuard } from '@/components/navigation/auth-route-guard';
import { RootStack } from '@/components/navigation/root-stack';
import { launchTheme } from '@/components/ui/theme-launch';
import { reportLaunchThemeProblem } from '@/src/appearance/launch-theme-report';
import { AuthProvider, bootstrapAuthState } from '@/src/auth';
import { bootstrapLocalDataLayer } from '@/src/data';
import { ensureExerciseCatalogLoaded } from '@/src/exercise-catalog/cache';
import { startLogFlushLoop, stopLogFlushLoop } from '@/src/logging';
import { registerBackgroundSyncTask } from '@/src/sync/background-task';
import { startSyncGateStateBridge, stopSyncGateStateBridge } from '@/src/sync/sync-gate-state-bridge';
import { requestSync, startSyncScheduler, stopSyncScheduler } from '@/src/sync/scheduler';

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

    // Start the log flush loop: drains buffered warn/error logs to Supabase on
    // an interval and when the app backgrounds. Cheap and self-gating (no-op
    // until signed in); stopped on unmount so no timer leaks.
    startLogFlushLoop();

    // A stored theme this launch could not use (unknown preset, unreadable
    // store) falls back to the default theme; say so in the logs.
    reportLaunchThemeProblem(launchTheme.problem);

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
      stopLogFlushLoop();
    };
  }, []);

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <SafeAreaProvider>
        <AuthProvider>
          <AuthRouteGuard>
            <RootStack />
          </AuthRouteGuard>
          {/* The app renders on a fixed light background (no dark-mode theming),
              so force dark status-bar content — `auto` turns the clock/icons
              white when the phone is in dark mode, leaving them unreadable on the
              light safe area. */}
          <StatusBar style="dark" />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
});
