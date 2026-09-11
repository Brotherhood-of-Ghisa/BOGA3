// Runs one group write RPC (`docs/specs/tech/groups-contract.md` §6.1, §7).
// Writes are online-only (C3.10.3, AC12): when the device is known to be
// offline the action is refused immediately — no RPC, no cache change, nothing
// queued. Failures come back as a mapped `GroupApiError` result; `run` never
// rejects and never throws into render. The hook never touches `group_cache`:
// callers refresh their resources after a successful write.

import { useCallback, useEffect, useRef, useState } from 'react';

import { GroupApiError, toGroupApiError } from './api';
import { useNetworkOnline } from './use-network-online';

export const GROUP_OFFLINE_ACTION_MESSAGE = "You're offline. Connect to the internet and try again.";

export type GroupActionResult<T> = { ok: true; value: T } | { ok: false; error: GroupApiError };

export type GroupActionState<TArgs extends unknown[], TResult> = {
  run: (...args: TArgs) => Promise<GroupActionResult<TResult>>;
  pending: boolean;
  /** The latest failure (including the offline refusal), cleared by the next run or `reset`. */
  error: GroupApiError | null;
  offline: boolean;
  reset: () => void;
};

export function useGroupAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
): GroupActionState<TArgs, TResult> {
  const online = useNetworkOnline();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<GroupApiError | null>(null);

  const actionRef = useRef(action);
  const onlineRef = useRef(online);
  const mountedRef = useRef(true);

  useEffect(() => {
    actionRef.current = action;
  }, [action]);

  useEffect(() => {
    onlineRef.current = online;
  }, [online]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async (...args: TArgs): Promise<GroupActionResult<TResult>> => {
    if (onlineRef.current === false) {
      const offlineError = new GroupApiError('NETWORK', GROUP_OFFLINE_ACTION_MESSAGE);
      setError(offlineError);
      return { ok: false, error: offlineError };
    }

    setPending(true);
    setError(null);
    try {
      const value = await actionRef.current(...args);
      if (mountedRef.current) {
        setPending(false);
      }
      return { ok: true, value };
    } catch (caught) {
      const mapped = toGroupApiError(caught);
      if (mountedRef.current) {
        setPending(false);
        setError(mapped);
      }
      return { ok: false, error: mapped };
    }
  }, []);

  const reset = useCallback(() => {
    setError(null);
  }, []);

  return { run, pending, error, offline: online === false, reset };
}
