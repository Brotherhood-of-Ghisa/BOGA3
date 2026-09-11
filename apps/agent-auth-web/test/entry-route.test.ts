import { describe, expect, it } from 'vitest';

import { agentAuthEntryRouteFrom } from '../src/entry-route.ts';
import { BOGA_PUBLIC_MCP_ENDPOINT } from '../src/setup.ts';

describe('agent authorization web entry routes', () => {
  it.each(['/', '/connect', '/connect/'])('selects standalone setup for %s', (pathname) => {
    expect(agentAuthEntryRouteFrom(new URL(`https://auth.example.test${pathname}`))).toEqual({
      kind: 'setup',
    });
  });

  it('selects consent only for a valid client-created authorization request', () => {
    expect(
      agentAuthEntryRouteFrom(
        new URL(
          'https://auth.example.test/oauth/consent?authorization_id=valid_request_12345',
        ),
      ),
    ).toEqual({ authorizationId: 'valid_request_12345', kind: 'consent' });
  });

  it('fails closed when the consent route has no authorization request', () => {
    expect(() =>
      agentAuthEntryRouteFrom(new URL('https://auth.example.test/oauth/consent')),
    ).toThrow('missing or invalid');
  });

  it('does not turn unknown paths into setup or consent', () => {
    expect(agentAuthEntryRouteFrom(new URL('https://auth.example.test/not-a-route'))).toEqual({
      kind: 'unsupported',
    });
  });

  it('publishes the canonical HTTPS MCP endpoint', () => {
    expect(BOGA_PUBLIC_MCP_ENDPOINT).toBe('https://boga3.onrender.com/mcp');
  });
});
