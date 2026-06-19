import {
  isMaestroHarnessRoutePathname,
  isSignInRoutePathname,
} from '@/src/navigation/routes';

describe('navigation route helpers', () => {
  it('recognizes the sign-in route with stable pathname normalization', () => {
    expect(isSignInRoutePathname('/sign-in')).toBe(true);
    expect(isSignInRoutePathname('/sign-in/')).toBe(true);
    expect(isSignInRoutePathname('sign-in?next=/stats-history')).toBe(true);
    expect(isSignInRoutePathname('/stats-history')).toBe(false);
  });

  it('recognizes the Maestro harness route across dev-client path forms', () => {
    expect(isMaestroHarnessRoutePathname('/maestro-harness')).toBe(true);
    expect(isMaestroHarnessRoutePathname('/maestro-harness/')).toBe(true);
    expect(isMaestroHarnessRoutePathname('maestro-harness?teleport=session-list')).toBe(true);
    expect(isMaestroHarnessRoutePathname('/--/maestro-harness?teleport=session-list')).toBe(true);
    expect(isMaestroHarnessRoutePathname('/sign-in')).toBe(false);
  });
});
