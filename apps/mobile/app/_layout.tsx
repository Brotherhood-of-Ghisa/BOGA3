import { ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type ReactNode } from 'react';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useThemeAppIcon } from '@/components/appearance/theme-app-icon';
import { AuthRouteGuard } from '@/components/navigation/auth-route-guard';
import { statusBarStyleFor, useNavigationTheme } from '@/components/navigation/navigation-theme';
import { NotificationTapBridge } from '@/components/navigation/notification-tap-bridge';
import { RootStack } from '@/components/navigation/root-stack';
import { AppThemeProvider, useUiMode } from '@/components/ui/theme-context';
import { launchTheme } from '@/components/ui/theme-launch';
import { reportLaunchThemeProblem } from '@/src/appearance/launch-theme-report';
import { AuthProvider, bootstrapAuthState } from '@/src/auth';
import { getDatabaseBackups } from '@/src/backup/database-backups';
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

    let mounted = true;
    let stopDatabaseBackups: (() => void) | null = null;
    void Promise.allSettled([
      bootstrapLocalDataLayer(),
      bootstrapAuthState(),
      ensureExerciseCatalogLoaded(),
    ]).finally(() => {
      // One cold-launch nudge once the boot sequence settles. It is a no-op
      // until the network projection first goes online, after which the
      // scheduler is already heading into its first cycle.
      requestSync();
      // Database snapshots start after the migrations have run: one now if
      // the newest is a day old, and again on each return to the app.
      if (mounted) stopDatabaseBackups = getDatabaseBackups().start();
    });

    return () => {
      mounted = false;
      stopDatabaseBackups?.();
      stopSyncGateStateBridge();
      stopSyncScheduler();
      stopLogFlushLoop();
    };
  }, []);

  // The theme sits outside everything else, so every screen and sheet below
  // that reads it through the theme hooks follows a saved appearance, and so do
  // the navigation theme, the status bar and the launcher icon (`ThemedChrome`).
  return (
    <AppThemeProvider>
      <GestureHandlerRootView style={styles.gestureRoot}>
        <SafeAreaProvider>
          <AuthProvider>
            <ThemedChrome>
              <AuthRouteGuard>
                <RootStack />
                <NotificationTapBridge />
              </AuthRouteGuard>
            </ThemedChrome>
          </AuthProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </AppThemeProvider>
  );
}

// What the navigators, the status bar and the launcher icon take from the
// theme the app is drawn in now.
function ThemedChrome({ children }: { children: ReactNode }) {
  const navigationTheme = useNavigationTheme();
  const mode = useUiMode();
  useThemeAppIcon();
  return (
    <>
      <ThemeProvider value={navigationTheme}>{children}</ThemeProvider>
      {/* The status bar follows the app's mode, never the phone's: `auto`
          would follow a phone switched to the other mode while the app runs,
          leaving the clock unreadable on the page. */}
      <StatusBar style={statusBarStyleFor(mode)} />
    </>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
});
