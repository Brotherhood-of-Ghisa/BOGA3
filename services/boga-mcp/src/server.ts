import type { Express, NextFunction, Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import type { OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { OAuthMetadataSchema } from '@modelcontextprotocol/sdk/shared/auth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { BogaAgentApi } from './api-client.js';
import type { BogaMcpConfig } from './config.js';
import { buildBogaMcpServer } from './tools.js';

export type BogaMcpAppOptions = {
  api?: BogaAgentApi;
  config: BogaMcpConfig;
  oauthMetadata?: OAuthMetadata;
};

export const loadOAuthMetadata = async (
  config: BogaMcpConfig,
  fetchImplementation: typeof fetch = fetch,
): Promise<OAuthMetadata> => {
  const issuerBase = new URL(`${config.oauthIssuer.href.replace(/\/+$/, '')}/`);
  const discoveryUrl = new URL('.well-known/oauth-authorization-server', issuerBase);
  const response = await fetchImplementation(discoveryUrl, {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  if (!response.ok) {
    throw new Error(`OAuth metadata discovery failed with status ${response.status}.`);
  }
  const parsed = OAuthMetadataSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.issuer !== config.oauthIssuer.href) {
    throw new Error('OAuth metadata discovery returned an invalid issuer or schema.');
  }
  return parsed.data;
};

const methodNotAllowed = (_request: Request, response: Response): void => {
  response.status(405).json({
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: 'Use POST for this stateless MCP endpoint.',
    },
  });
};

export const createBogaMcpApp = async (
  options: BogaMcpAppOptions,
): Promise<Express> => {
  const { config } = options;
  const api = options.api ?? new BogaAgentApi({
    baseUrl: config.agentApiBaseUrl,
    timeoutMs: config.requestTimeoutMs,
  });
  const oauthMetadata = options.oauthMetadata ?? await loadOAuthMetadata(config);
  const app = createMcpExpressApp({
    allowedHosts: config.allowedHosts,
    host: config.host,
  });

  app.disable('x-powered-by');
  app.use(mcpAuthMetadataRouter({
    oauthMetadata,
    resourceName: 'BoGa Virtual Coach',
    resourceServerUrl: config.resourceUrl,
    scopesSupported: oauthMetadata.scopes_supported ?? ['openid', 'profile'],
  }));

  app.get('/health', (_request, response) => {
    response.status(200).json({
      ok: true,
      service: 'boga-mcp',
    });
  });

  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(config.resourceUrl);
  const authMiddleware = requireBearerAuth({
    requiredScopes: [],
    resourceMetadataUrl,
    verifier: {
      verifyAccessToken: async (token) => {
        const session = await api.verifySession(token);
        return {
          clientId: session.client_id,
          expiresAt: session.expires_at,
          scopes: session.scopes,
          token,
        };
      },
    },
  });
  const mcpRateLimit = rateLimit({
    keyGenerator: (request) => request.auth?.clientId ?? 'unauthenticated',
    legacyHeaders: false,
    limit: 120,
    standardHeaders: 'draft-8',
    windowMs: 60_000,
  });

  app.post('/mcp', authMiddleware, mcpRateLimit, async (request, response) => {
    const server = buildBogaMcpServer(api);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const close = () => {
      void transport.close();
      void server.close();
    };
    response.on('close', close);
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      console.error('[boga-mcp] request failed', { message });
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  });
  app.get('/mcp', authMiddleware, methodNotAllowed);
  app.delete('/mcp', authMiddleware, methodNotAllowed);

  app.use(
    (error: unknown, _request: Request, response: Response, _next: NextFunction) => {
      const message = error instanceof Error ? error.message : 'invalid request';
      console.error('[boga-mcp] transport rejected request', { message });
      if (!response.headersSent) {
        response.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: 'The MCP request could not be parsed.',
          },
        });
      }
    },
  );
  return app;
};
