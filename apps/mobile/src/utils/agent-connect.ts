import Constants from 'expo-constants';

import { DEFAULT_BOGA_AGENT_CONNECT_URL } from '@/src/config/public';

const isSafeConnectUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      url.pathname.replace(/\/+$/, '') === '/connect'
    );
  } catch {
    return false;
  }
};

export const resolveAgentConnectUrl = (configuredValue: unknown): string => {
  if (typeof configuredValue !== 'string') {
    return DEFAULT_BOGA_AGENT_CONNECT_URL;
  }
  const value = configuredValue.trim();
  return isSafeConnectUrl(value) ? value : DEFAULT_BOGA_AGENT_CONNECT_URL;
};

/** Returns the public first-party setup page embedded by app.config.ts. */
export const getAgentConnectUrl = (): string =>
  resolveAgentConnectUrl(Constants.expoConfig?.extra?.bogaAgentConnectUrl);
