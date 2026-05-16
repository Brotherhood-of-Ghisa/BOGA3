import type { Href } from 'expo-router';
import Constants, { ExecutionEnvironment } from 'expo-constants';

import { resetLocalAppData } from '@/src/data';
import { isDevMode } from '@/src/utils/isDevMode';

export type MaestroHarnessResetMode = 'none' | 'data';
export type MaestroHarnessTeleportTarget =
  | 'session-list'
  | 'session-recorder'
  | 'exercise-catalog'
  | 'completed-session';

export const coerceMaestroHarnessQueryParam = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
};

export const isMaestroHarnessAllowed = ({
  isDev = isDevMode(),
  executionEnvironment = Constants.executionEnvironment,
}: {
  isDev?: boolean;
  executionEnvironment?: ExecutionEnvironment;
} = {}) => isDev && executionEnvironment !== ExecutionEnvironment.StoreClient;

export const resolveMaestroHarnessResetMode = (
  value: string | null | undefined
): MaestroHarnessResetMode => (value === 'data' ? 'data' : 'none');

export const resolveMaestroHarnessTeleportTarget = (
  value: string | null | undefined
): MaestroHarnessTeleportTarget | null => {
  switch (value) {
    case 'session-list':
    case 'session-recorder':
    case 'exercise-catalog':
    case 'completed-session':
      return value;
    default:
      return null;
  }
};

const withQuery = (pathname: string, params: Record<string, string | null | undefined>): Href => {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (!value) {
      return;
    }

    searchParams.set(key, value);
  });

  const search = searchParams.toString();
  return (search.length > 0 ? `${pathname}?${search}` : pathname) as Href;
};

export const resolveMaestroHarnessTeleportHref = ({
  target,
  mode,
  intent,
  sessionId,
}: {
  target: MaestroHarnessTeleportTarget | null;
  mode?: string | null;
  intent?: string | null;
  sessionId?: string | null;
}) => {
  switch (target) {
    case 'session-list':
      return '/session-list' as Href;
    case 'session-recorder':
      return withQuery('/session-recorder', {
        mode: mode === 'completed-edit' ? mode : null,
        sessionId,
      });
    case 'exercise-catalog':
      return withQuery('/exercise-catalog', {
        intent,
        source: 'maestro-harness',
      });
    case 'completed-session':
      return sessionId ? (withQuery(`/completed-session/${sessionId}`, { intent }) as Href) : null;
    default:
      return null;
  }
};

export const runMaestroHarnessReset = async (resetMode: MaestroHarnessResetMode) => {
  if (resetMode === 'data') {
    await resetLocalAppData();
  }
};
