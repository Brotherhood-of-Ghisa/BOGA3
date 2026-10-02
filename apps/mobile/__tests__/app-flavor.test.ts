/* eslint-disable import/first */

// Mirror the expo-application mock shape from is-dev-mode.test.ts: a late-bound
// getter is the only way mid-test mutations stay visible through babel's
// `_interopRequireWildcard` copy of `import * as Application`.
jest.mock('expo-application', () => {
  const state = { applicationId: null as string | null };
  return {
    get applicationId() {
      return state.applicationId;
    },
    __setApplicationId(value: string | null) {
      state.applicationId = value;
    },
  };
});

import { PROD_BUNDLE_ID, getAppFlavor, getAuthStorageKey } from '@/src/utils/app-flavor';
import { DEV_BUNDLE_ID } from '@/src/utils/isDevMode';

const expoApplicationMock = jest.requireMock('expo-application') as {
  applicationId: string | null;
  __setApplicationId: (value: string | null) => void;
};

const easJson = require('@/eas.json') as {
  build: {
    prod: { env: { IOS_BUNDLE_ID: string } };
    preview: { env: { IOS_BUNDLE_ID: string } };
  };
};

describe('getAppFlavor', () => {
  beforeEach(() => {
    expoApplicationMock.__setApplicationId(null);
  });

  it('maps the full App Store bundle id to "production"', () => {
    expoApplicationMock.__setApplicationId(PROD_BUNDLE_ID);
    expect(getAppFlavor()).toBe('production');
  });

  it('maps the internal / TestFlight bundle id to "preview"', () => {
    expoApplicationMock.__setApplicationId(DEV_BUNDLE_ID);
    expect(getAppFlavor()).toBe('preview');
  });

  it('falls back to "local" for the default dev-client bundle id', () => {
    expoApplicationMock.__setApplicationId('com.anonymous.boga3');
    expect(getAppFlavor()).toBe('local');
  });

  it('falls back to "local" when no bundle id is available', () => {
    expoApplicationMock.__setApplicationId(null);
    expect(getAppFlavor()).toBe('local');
  });

  it('namespaces the auth storage key per flavor', () => {
    expoApplicationMock.__setApplicationId(PROD_BUNDLE_ID);
    expect(getAuthStorageKey()).toBe('boga3-auth-production');

    expoApplicationMock.__setApplicationId(DEV_BUNDLE_ID);
    expect(getAuthStorageKey()).toBe('boga3-auth-preview');

    expoApplicationMock.__setApplicationId(null);
    expect(getAuthStorageKey()).toBe('boga3-auth-local');
  });

  it('PROD_BUNDLE_ID is pinned to the prod profile bundle id in eas.json', () => {
    // If this fails, either eas.json was edited or PROD_BUNDLE_ID drifted —
    // fix whichever is wrong so the runtime flavor matches the shipped binary.
    expect(PROD_BUNDLE_ID).toBe(easJson.build.prod.env.IOS_BUNDLE_ID);
  });

  it('the preview profile shares the dev bundle id (same flavor + backend)', () => {
    expect(easJson.build.preview.env.IOS_BUNDLE_ID).toBe(DEV_BUNDLE_ID);
  });
});
