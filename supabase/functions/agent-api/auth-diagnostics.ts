// Diagnostic observations only: no decisions or raw claims leave this module.
export type Trace = (event: string, fields?: Record<string, unknown>) => void;
let windowStart = 0;
let count = 0;
let suppressed = 0;
export const authTrace = (requestId: string): Trace => (event, fields = {}) => {
  try {
    const now = Date.now();
    if (now - windowStart >= 60_000) { windowStart = now; count = 0; }
    if (++count > 6000) { suppressed++; return; }
    console.log(JSON.stringify({ ...fields, service: 'agent-api', event, request_id: requestId,
      timestamp: new Date(now).toISOString(), suppressed_since_last: suppressed }));
    suppressed = 0;
  } catch { /* Logging cannot change authorization. */ }
};

export const claimFailure = (claims: Record<string, unknown>, userId: string, now: number): string | null => {
  if (typeof claims.client_id !== 'string' || claims.client_id.trim().length === 0) return 'oauth_client_missing';
  if (typeof claims.sub !== 'string' || claims.sub !== userId) return 'subject_mismatch';
  if (typeof claims.exp !== 'number') return 'expiry_missing';
  if (claims.exp * 1000 <= now) return 'token_expired';
  return null;
};

export const claimObservations = (claims: Record<string, unknown>, issuer: string) => ({
  issuer_observed: typeof claims.iss === 'string' ? claims.iss === issuer ? 'matches' : 'mismatch' : 'missing',
  audience_observed: claims.aud === 'authenticated' ||
    (Array.isArray(claims.aud) && claims.aud.includes('authenticated')) ? 'matches' : claims.aud == null ? 'missing' : 'mismatch',
  issuer_audience_enforcement: 'delegated_to_supabase_auth',
  token_age_observed: typeof claims.iat !== 'number' ? 'unknown'
    : claims.iat * 1000 > Date.now() ? 'future_issued_at'
    : Date.now() - claims.iat * 1000 <= 300_000 ? 'issued_within_5m' : 'older_than_5m',
  offline_access_claimed: typeof claims.scope === 'string' && claims.scope.split(/\s+/).includes('offline_access'),
  expiry_state: typeof claims.exp !== 'number' ? 'missing' : claims.exp * 1000 <= Date.now() ? 'expired' : 'future',
});

export const privateTag = async (key: string | undefined, kind: string, value: string): Promise<string | undefined> => {
  try {
    if (!key || key.length < 32) return undefined;
    const encoder = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(`${kind}:${value}`));
    return Array.from(new Uint8Array(signature)).map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 24);
  } catch { return undefined; }
};
