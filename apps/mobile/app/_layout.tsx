import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthRouteGuard } from '@/components/navigation/auth-route-guard';
import { AuthProvider, bootstrapAuthState } from '@/src/auth';
import { bootstrapLocalDataLayer } from '@/src/data';
import { ensureExerciseCatalogLoaded } from '@/src/exercise-catalog/cache';
import { startLogFlushLoop, stopLogFlushLoop } from '@/src/logging';
import { registerBackgroundSyncTask } from '@/src/sync/background-task';
import { startSyncGateStateBridge, stopSyncGateStateBridge } from '@/src/sync/sync-gate-state-bridge';
import { requestSync, startSyncScheduler, stopSyncScheduler } from '@/src/sync/scheduler';
import { SyncGate } from '@/src/sync/SyncGate';

/**
 * Arrow-only native back affordance on every detail screen. No custom
 * `headerBackTitle`: react-native-screens then builds a custom back item that
 * ignores the display mode and morphs its label in during the push. The
 * hidden back label (still read by VoiceOver) is the previous screen's title,
 * so the headerless `(tabs)` group is titled "Back" rather than "(tabs)".
 */
const ROOT_STACK_SCREEN_OPTIONS = { headerBackButtonDisplayMode: 'minimal' } as const;

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
            <SyncGate>
              <Stack screenOptions={ROOT_STACK_SCREEN_OPTIONS}>
                <Stack.Screen name="index" options={{ headerShown: false }} />
                <Stack.Screen name="sign-in" options={{ headerShown: false }} />
                <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Back' }} />
                <Stack.Screen name="exercise-history" />
                <Stack.Screen name="sessions" options={{ title: 'Sessions' }} />
                <Stack.Screen name="profile" options={{ title: 'Profile' }} />
                <Stack.Screen
                  name="connected-agents"
                  options={{ title: 'Connected agents' }}
                />
                <Stack.Screen name="dev-logs" options={{ title: 'Logs' }} />
                <Stack.Screen name="exercise-link" options={{ title: 'Link exercise' }} />
                <Stack.Screen name="group/mine" options={{ title: 'My groups' }} />
                <Stack.Screen name="group/new" options={{ title: 'New group' }} />
                <Stack.Screen name="group/join" options={{ title: 'Join group' }} />
                {/* The group screen replaces this title with the group's name once loaded. */}
                <Stack.Screen name="group/[groupId]/index" options={{ title: 'Group' }} />
                <Stack.Screen name="group/[groupId]/edit" options={{ title: 'Edit group' }} />
                <Stack.Screen name="group/[groupId]/invite" options={{ title: 'Invite' }} />
                <Stack.Screen name="group/[groupId]/members" options={{ title: 'Members' }} />
                <Stack.Screen
                  name="group/[groupId]/exercises/new"
                  options={{ title: 'Add exercise' }}
                />
                <Stack.Screen
                  name="group/[groupId]/exercises/[exerciseId]/edit"
                  options={{ title: 'Edit exercise' }}
                />
                {/* The board replaces this title with the group exercise's name once loaded. */}
                <Stack.Screen
                  name="group/[groupId]/leaderboards/[exerciseId]/index"
                  options={{ title: 'Leaderboard' }}
                />
                <Stack.Screen
                  name="group/[groupId]/leaderboards/[exerciseId]/history"
                  options={{ title: 'History' }}
                />
                <Stack.Screen
                  name="group-session/[memberId]/[sessionId]"
                  options={{ title: 'Session' }}
                />
                <Stack.Screen name="maestro-harness" options={{ headerShown: false }} />
              </Stack>
            </SyncGate>
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
