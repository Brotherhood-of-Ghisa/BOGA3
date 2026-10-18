/**
 * The gym scope over a route boundary ([[gym.split]]): in-process it is
 * three-state, but a route param has only "a value" or "nothing", so the
 * no-gym scope travels as one reserved value.
 */

import {
  decodeGymRouteParam,
  encodeGymRouteParam,
  gymOptionLabel,
  gymScopeLabel,
  NO_GYM_ROUTE_PARAM,
} from '@/src/utils/gym-scope-route';
import { progressHistoryHref } from '@/src/navigation/routes';

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

  it('encodes each state so decoding restores it', () => {
    expect(encodeGymRouteParam(undefined)).toBeUndefined();
    expect(encodeGymRouteParam(null)).toBe(NO_GYM_ROUTE_PARAM);
    expect(encodeGymRouteParam('gym-home')).toBe('gym-home');
    for (const scope of [undefined, null, 'gym-home']) {
      expect(decodeGymRouteParam(encodeGymRouteParam(scope))).toBe(scope);
    }
  });

  it('carries an exercise page\'s gym on its link, and nothing for every gym', () => {
    const href = (gymId?: string | null) => String(progressHistoryHref({ exerciseDefinitionId: 'bench', gymId }));
    expect(href()).not.toMatch(/gymId=/);
    expect(href(null)).toMatch(new RegExp(`gymId=${NO_GYM_ROUTE_PARAM}$`));
    expect(href('gym-home')).toMatch(/gymId=gym-home$/);
  });
});

describe('gym scope labels', () => {
  const options = [{ gymId: 'gym-home', name: 'Home' }, { gymId: 'gym-blank', name: ' ' }, { gymId: null, name: null }];

  it('names every gym, no gym and a gym by its name', () => {
    expect(gymScopeLabel(undefined, options)).toBe('All gyms');
    expect(gymScopeLabel(null, options)).toBe('No gym');
    expect(gymScopeLabel(null, [])).toBe('No gym');
    expect(gymScopeLabel('gym-home', options)).toBe('Home');
    expect(gymScopeLabel('gym-gone', options)).toBe('Selected gym');
  });

  it('names an option without a name', () => {
    expect(gymOptionLabel({ gymId: null, name: 'ignored' })).toBe('No gym');
    expect(gymOptionLabel({ gymId: 'gym-blank', name: ' ' })).toBe('Unnamed gym');
  });
});
