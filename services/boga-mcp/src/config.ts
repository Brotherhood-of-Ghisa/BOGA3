export type BogaMcpConfig = {
  agentApiBaseUrl: URL;
  allowedHosts: string[];
  host: string;
  oauthIssuer: URL;
  port: number;
  publicBaseUrl: URL;
  requestTimeoutMs: number;
  resourceUrl: URL;
};

const requireUrl = (name: string, raw: string | undefined): URL => {
  if (!raw?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  const value = new URL(raw.trim());
  if (value.username || value.password || value.search || value.hash) {
    throw new Error(`${name} must not contain credentials, a query, or a fragment.`);
  }
  if (
    value.protocol !== 'https:' &&
    value.hostname !== '127.0.0.1' &&
    value.hostname !== 'localhost'
  ) {
    throw new Error(`${name} must use HTTPS outside localhost.`);
  }
  return value;
};

const withTrailingSlash = (value: URL): URL => {
  const normalized = new URL(value.href);
  normalized.pathname = `${normalized.pathname.replace(/\/+$/, '')}/`;
  return normalized;
};

const boundedInteger = (
  name: string,
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  if (!raw?.trim()) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
};

export const loadConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): BogaMcpConfig => {
  const publicBaseUrl = withTrailingSlash(
    requireUrl('BOGA_MCP_PUBLIC_URL', environment.BOGA_MCP_PUBLIC_URL),
  );
  const agentApiBaseUrl = withTrailingSlash(
    requireUrl('BOGA_AGENT_API_BASE_URL', environment.BOGA_AGENT_API_BASE_URL),
  );
  const oauthIssuer = requireUrl('BOGA_OAUTH_ISSUER', environment.BOGA_OAUTH_ISSUER);
  oauthIssuer.pathname = oauthIssuer.pathname.replace(/\/+$/, '');

  const resourceUrl = new URL('mcp', publicBaseUrl);
  const configuredHosts = (environment.BOGA_MCP_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
  const allowedHosts = Array.from(
    new Set([publicBaseUrl.hostname, '127.0.0.1', 'localhost', ...configuredHosts]),
  );

  return {
    agentApiBaseUrl,
    allowedHosts,
    host: environment.HOST?.trim() || '0.0.0.0',
    oauthIssuer,
    port: boundedInteger('PORT', environment.PORT, 8787, 1, 65_535),
    publicBaseUrl,
    requestTimeoutMs: boundedInteger(
      'BOGA_AGENT_API_TIMEOUT_MS',
      environment.BOGA_AGENT_API_TIMEOUT_MS,
      10_000,
      500,
      30_000,
    ),
    resourceUrl,
  };
};
