import type { PropsWithChildren } from 'react';
import { Screen } from '@/components/ui/screen';
import { StatePanel } from '@/components/ui/state-panel';
import { useAuth } from '@/src/auth';

/**
 * Holds the root navigator until the session restore resolves, showing a neutral
 * loading view. It does NOT flash the sign-in screen or a data screen: either
 * could be wrong the moment auth resolves. Restore runs once, at boot, before the
 * navigator first mounts, so this never unmounts a live navigator.
 *
 * Which routes a user may reach afterwards (sign-in, the first-sync block, or the
 * app) is decided by the root stack's `Stack.Protected` groups
 * (`components/navigation/root-stack.tsx`), not here.
 */
export function AuthRouteGuard({ children }: PropsWithChildren) {
  const { status } = useAuth();

  if (status === 'restoring') {
    return (
      <Screen>
        <StatePanel kind="loading" testID="auth-guard-loading" title="Loading…" />
      </Screen>
    );
  }

  return <>{children}</>;
}
