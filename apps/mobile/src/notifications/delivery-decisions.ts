/** Portable delivery decisions shared by Jest and the Edge worker. */
export const remainingLifetime = (expiresAt: string, nowMs: number): number => {
  const remaining = Date.parse(expiresAt) - nowMs;
  return Number.isFinite(remaining) && remaining >= 1000 ? Math.floor(remaining / 1000) : 0;
};

export type ProviderOutcome = {
  outcome: 'ticket' | 'retry' | 'failed' | 'uncertain' | 'device_unregistered';
  code?: string;
  ticketId?: string;
};
const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

export const providerOutcome = (status: number, body: unknown, receipt = false): ProviderOutcome => {
  if (status === 429) return { outcome: 'retry', code: 'RATE_LIMIT' };
  if (status >= 500) return { outcome: 'retry', code: 'PROVIDER_TEMPORARY' };
  if (status === 401 || status === 403) return { outcome: 'failed', code: 'INVALID_CREDENTIALS' };
  if (status !== 200) return { outcome: 'failed', code: 'INVALID_PAYLOAD' };
  const item = object(body);
  if (item?.status === 'ok') {
    if (receipt) return { outcome: 'ticket' };
    if (typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 160) return { outcome: 'ticket', ticketId: item.id };
  }
  const error = object(item?.details)?.error;
  if (error === 'DeviceNotRegistered') return { outcome: 'device_unregistered', code: 'DEVICE_NOT_REGISTERED' };
  if (error === 'MessageRateExceeded') return { outcome: 'retry', code: 'RATE_LIMIT' };
  if (error === 'InvalidCredentials') return { outcome: 'failed', code: 'INVALID_CREDENTIALS' };
  if (error === 'MessageTooBig') return { outcome: 'failed', code: 'INVALID_PAYLOAD' };
  return { outcome: 'uncertain', code: 'PROVIDER_INVALID_RESPONSE' };
};
