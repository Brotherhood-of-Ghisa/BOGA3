import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
// Brings the SDK's `Request.auth` augmentation into scope.
import type {} from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';

import { BogaAgentApiError, type BogaAgentApi } from './api-client.js';

export type BogaBearerAuthOptions = {
  api: Pick<BogaAgentApi, 'verifySession'>;
  // Scopes clients should request. They are advertised in the challenge so
  // every client asks for the same set; they are not enforced on the token.
  challengeScopes: readonly string[];
  resourceMetadataUrl: string;
};

export const UPSTREAM_RETRY_AFTER_SECONDS = 5;

const quoted = (value: string): string => value.replace(/["\\]/g, '');

const bearerToken = (request: Request): string => {
  const header = request.headers.authorization;
  if (!header) throw new InvalidTokenError('Missing Authorization header');
  const [type, token] = header.split(' ');
  if (type?.toLowerCase() !== 'bearer' || !token) {
    throw new InvalidTokenError("Invalid Authorization header format, expected 'Bearer TOKEN'");
  }
  return token;
};

// An upstream 401/403 means the token was rejected (expired, revoked, or not
// an agent token). Clients must see 401 + challenge so they refresh or
// re-authorize instead of treating the server as broken.
const isRejectedToken = (error: unknown): boolean =>
  error instanceof BogaAgentApiError && (error.status === 401 || error.status === 403);

const isUpstreamUnavailable = (error: unknown): boolean =>
  error instanceof BogaAgentApiError && (error.status === 429 || error.status >= 500);

const verify = async (
  api: BogaBearerAuthOptions['api'],
  token: string,
): Promise<AuthInfo> => {
  let session;
  try {
    session = await api.verifySession(token);
  } catch (error) {
    if (isRejectedToken(error)) throw new InvalidTokenError('The access token is invalid or expired');
    throw error;
  }
  if (session.expires_at < Date.now() / 1000) {
    throw new InvalidTokenError('Token has expired');
  }
  return {
    clientId: session.client_id,
    expiresAt: session.expires_at,
    scopes: session.scopes,
    token,
  };
};

export const bogaBearerAuth = (options: BogaBearerAuthOptions): RequestHandler => {
  const challenge = (error: InvalidTokenError): string => {
    const parts = [
      `error="${error.errorCode}"`,
      `error_description="${quoted(error.message)}"`,
    ];
    if (options.challengeScopes.length > 0) {
      parts.push(`scope="${options.challengeScopes.join(' ')}"`);
    }
    parts.push(`resource_metadata="${options.resourceMetadataUrl}"`);
    return `Bearer ${parts.join(', ')}`;
  };

  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      request.auth = await verify(options.api, bearerToken(request));
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        response.set('WWW-Authenticate', challenge(error));
        response.status(401).json(error.toResponseObject());
        return;
      }
      const message = error instanceof Error ? error.message : 'unknown error';
      console.error('[boga-mcp] token verification failed', { message });
      if (isUpstreamUnavailable(error)) {
        response.set('Retry-After', String(UPSTREAM_RETRY_AFTER_SECONDS));
        response.status(503).json({
          error: 'temporarily_unavailable',
          error_description: 'BoGa is temporarily unavailable. Try again shortly.',
        });
        return;
      }
      response.status(500).json({
        error: 'server_error',
        error_description: 'Internal Server Error',
      });
      return;
    }
    next();
  };
};
