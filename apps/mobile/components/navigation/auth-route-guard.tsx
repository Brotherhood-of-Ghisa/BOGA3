import { useState, useSyncExternalStore, type PropsWithChildren } from 'react';
import { Screen } from '@/components/ui/screen';
import { StatePanel } from '@/components/ui/state-panel';
import { useAuth } from '@/src/auth';
import { getSyncGateStateSnapshot, subscribeToSyncGateState } from '@/src/sync/sync-gate-state';

const getBootstrapFlagKnown = () => getSyncGateStateSnapshot().bootstrapFlagKnown !== false;

/**
 * Holds the root navigator, showing a neutral loading view, until the app knows
 * which routes the user may reach: the session restore has resolved and, for a
 * signed-in user, the persisted first-sync flag has been read. Mounting earlier
 * would land on a route that is wrong a moment later (sign-in before the restore,
 * the first-sync block before the flag is read) and drop a cold-launch deep link.
 *
 * It holds only before the navigator first mounts, never after: unmounting a live
 * navigator reverts its route on expo-router 57. Which routes exist from then on
 * is the root stack's `Stack.Protected` groups' decision
 * (`components/navigation/root-stack.tsx`).
 */
export function AuthRouteGuard({ children }: PropsWithChildren) {
  const { isConfigured, session, status } = useAuth();
  const bootstrapFlagKnown = useSyncExternalStore(subscribeToSyncGateState, getBootstrapFlagKnown, getBootstrapFlagKnown);
  const ready = status === 'ready' && (!isConfigured || !session || bootstrapFlagKnown);

  // Latch the first release so a later `ready` flip can never unmount the navigator.
  const [released, setReleased] = useState(false);
  if (ready && !released) {
    setReleased(true);
  }

  if (!ready && !released) {
    return (
      <Screen>
        <StatePanel kind="loading" testID="auth-guard-loading" title="Loading…" />
      </Screen>
    );
  }

  return <>{children}</>;
}
