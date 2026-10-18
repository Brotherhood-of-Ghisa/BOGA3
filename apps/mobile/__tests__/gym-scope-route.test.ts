/**
 * The gym scope over a route boundary ([[gym.split]]): in-process it is
 * three-state, but a route param has only "a value" or "nothing", so the
 * no-gym scope travels as one reserved value.
 */

import { decodeGymRouteParam, NO_GYM_ROUTE_PARAM } from '@/src/utils/gym-scope-route';

describe('gym scope route param', () => {
  it('restores all three states', () => {
    expect(decodeGymRouteParam(undefined)).toBeUndefined();
    expect(decodeGymRouteParam(null)).toBeUndefined();
    expect(decodeGymRouteParam(NO_GYM_ROUTE_PARAM)).toBeNull();
    expect(decodeGymRouteParam('gym-home')).toBe('gym-home');
  });

  it('tells a gym apart from the reserved no-gym value', () => {
    expect(decodeGymRouteParam('gym-home')).not.toBeNull();
    expect(NO_GYM_ROUTE_PARAM).not.toBe('');
  });
});
