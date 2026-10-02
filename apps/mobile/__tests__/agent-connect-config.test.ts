import { DEFAULT_BOGA_AGENT_CONNECT_URL } from '@/src/config/public';
import { resolveAgentConnectUrl } from '@/src/utils/agent-connect';

describe('agent connect public configuration', () => {
  it('accepts a public HTTPS connect page without query state', () => {
    expect(resolveAgentConnectUrl(' https://coach.example.test/connect ')).toBe(
      'https://coach.example.test/connect',
    );
  });

  it.each([
    'http://coach.example.test/connect',
    'https://coach.example.test/oauth/consent',
    'https://coach.example.test/connect?authorization_id=secret-state',
    'https://user:password@coach.example.test/connect',
    '',
  ])('falls back to the checked-in safe default for %p', (configuredValue) => {
    expect(resolveAgentConnectUrl(configuredValue)).toBe(DEFAULT_BOGA_AGENT_CONNECT_URL);
  });
});
