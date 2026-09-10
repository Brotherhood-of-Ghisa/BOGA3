// Live online/offline for group screens. The sync status accessor
// (`src/sync/sync-status.ts` → `getSchedulerStatus`) is a snapshot getter with
// no subscription API, so per `docs/specs/tech/groups-contract.md` §6.1 groups
// keep their own NetInfo listener rather than changing `src/sync`. It applies
// the scheduler's projection rule: online iff `isConnected === true`.

import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

export const projectNetInfoOnline = (state: Pick<NetInfoState, 'isConnected'>): boolean => state.isConnected === true;

/**
 * `true` online, `false` offline, `null` until NetInfo's first report
 * (unknown). Callers treat only `false` as offline, so an unknown state never
 * blocks a request; a real transport failure still surfaces as `NETWORK`.
 */
export const useNetworkOnline = (): boolean | null => {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(
    () =>
      NetInfo.addEventListener((state) => {
        setOnline(projectNetInfoOnline(state));
      }),
    [],
  );

  return online;
};
