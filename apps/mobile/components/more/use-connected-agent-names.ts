import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { listConnectedAgents } from '@/src/auth/connected-agents';

/**
 * The signed-in user's connected agents' names, re-read each time More comes
 * into view. `null` until known: still loading, or the read failed — More then
 * opens the agents screen, which owns the error and its retry.
 */
export function useConnectedAgentNames(userId: string | null): string[] | null {
  const [loaded, setLoaded] = useState<{ userId: string; names: string[] } | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let live = true;
      listConnectedAgents().then(
        (agents) => {
          if (live) setLoaded({ userId, names: agents.map((agent) => agent.name) });
        },
        () => {
          if (live) setLoaded(null);
        },
      );
      return () => {
        live = false;
      };
    }, [userId]),
  );

  // A previous account's names are never shown for the current one.
  return loaded && loaded.userId === userId ? loaded.names : null;
}
