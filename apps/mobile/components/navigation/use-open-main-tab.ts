import { useNavigation, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { ACTIVE_WORKOUT_HREF } from '@/src/navigation/active-session-entry';
import { mainTabHref, type MainTabKey } from '@/src/navigation/main-tabs';
import { getAccountLocalPreferenceAccountRevision } from '@/src/preferences/account-local';

/**
 * A tab-bar press on a page pushed over the tabs (`TabOwnedPage`, exercise
 * history, a completed session's edit). A tab press switches context and is
 * never a step back, so the pages on top close with no animation and the tab
 * is selected, as a press on the tab layout's own bar does. The top page is the
 * one that animates when several close at once, so only its animation goes.
 */
export function useOpenMainTabFromPage(): (tab: MainTabKey) => void {
  const navigation = useNavigation();
  const router = useRouter();
  return useCallback(
    (tab: MainTabKey) => {
      navigation.setOptions({ animation: 'none' });
      // The option reaches the native screen with the next frame; the close must not beat it.
      requestAnimationFrame(() => router.dismissTo(mainTabHref(tab)));
    },
    [navigation, router],
  );
}

type OpenedWorkoutListener = (sessionId: string) => void;
const openedWorkoutListeners = new Set<OpenedWorkoutListener>();
let pendingWorkout: { sessionId: string; accountRevision: number } | null = null;

/**
 * Train's subscription to workouts opened from elsewhere, so it shows one
 * before the pages on top slide away rather than its disc while it re-reads.
 */
export function subscribeOpenedWorkout(listener: OpenedWorkoutListener): () => void {
  openedWorkoutListeners.add(listener);
  // Tabs mount lazily: the first Resume can arrive before Train exists.
  const pending = pendingWorkout;
  pendingWorkout = null;
  if (pending?.accountRevision === getAccountLocalPreferenceAccountRevision()) listener(pending.sessionId);
  return () => {
    openedWorkoutListeners.delete(listener);
  };
}

/**
 * The way into the workout in progress from a page over the tabs (Sessions, a
 * plan, a programme, History, a group session). The workout lives on Train, so
 * Train is told which one and the pages on top close as Back would.
 */
export function useOpenActiveWorkout(): (sessionId: string) => void {
  const router = useRouter();
  return useCallback(
    (sessionId: string) => {
      pendingWorkout = openedWorkoutListeners.size === 0
        ? { sessionId, accountRevision: getAccountLocalPreferenceAccountRevision() } : null;
      openedWorkoutListeners.forEach((listener) => listener(sessionId));
      router.dismissTo(ACTIVE_WORKOUT_HREF);
    },
    [router],
  );
}
