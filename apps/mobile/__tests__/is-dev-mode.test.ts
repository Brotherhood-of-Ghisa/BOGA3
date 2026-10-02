/* eslint-disable import/first */

// Module-level mocks. The factories must not close over outer variables —
// jest hoists `jest.mock` above variable declarations, so the closure
// would still see `undefined` at factory-call time. Instead, declare the
// mutable state *inside* the factory and expose a setter we can reach via
// `jest.requireMock`. Use a getter for `applicationId` because
// `import * as Application` runs through babel's `_interopRequireWildcard`
// helper, which copies enumerable properties at module-load time — a
// late-bound getter is the only way for mid-test mutations to be visible
// to the consuming code.
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

// `Constants` is consumed as a default import, which under CJS interop
// becomes a single object reference — mutations on that reference are
// visible to consumers, so a plain mutable object is sufficient here.
jest.mock('expo-constants', () => ({ expoConfig: null }));

import { DEV_BUNDLE_ID, isDevMode } from '@/src/utils/isDevMode';

const expoApplicationMock = jest.requireMock('expo-application') as {
  applicationId: string | null;
  __setApplicationId: (value: string | null) => void;
};
const expoConstantsMock = jest.requireMock('expo-constants') as {
  expoConfig: { extra?: Record<string, unknown> } | null;
};

const easJson = require('@/eas.json') as {
  build: { dev: { env: { IOS_BUNDLE_ID: string } } };
};

declare const globalThis: { __DEV__: boolean };

describe('isDevMode', () => {
  const originalDev = globalThis.__DEV__;

  beforeEach(() => {
    expoApplicationMock.__setApplicationId(null);
    expoConstantsMock.expoConfig = null;
  });

  afterEach(() => {
    globalThis.__DEV__ = originalDev;
  });

  it('returns true in Metro dev bundles (__DEV__ === true)', () => {
    globalThis.__DEV__ = true;
    expect(isDevMode()).toBe(true);
  });

  it('returns true when the bundle id matches the dev EAS profile', () => {
    globalThis.__DEV__ = false;
    expoApplicationMock.__setApplicationId(DEV_BUNDLE_ID);
    expect(isDevMode()).toBe(true);
  });

  it('returns true when expoConfig.extra.env is "dev" (cross-platform signal)', () => {
    globalThis.__DEV__ = false;
    expoConstantsMock.expoConfig = { extra: { env: 'dev' } };
    expect(isDevMode()).toBe(true);
  });

  it('returns false on production builds with none of the dev signals set', () => {
    globalThis.__DEV__ = false;
    expoApplicationMock.__setApplicationId('com.phano.boga3');
    expoConstantsMock.expoConfig = { extra: { env: 'prod' } };
    expect(isDevMode()).toBe(false);
  });

  it('returns false when no signals are available at all (defence-in-depth)', () => {
    globalThis.__DEV__ = false;
    expect(isDevMode()).toBe(false);
  });

  it('DEV_BUNDLE_ID is pinned to the dev profile bundle id in eas.json', () => {
    // If this fails, either eas.json was edited or DEV_BUNDLE_ID drifted —
    // update whichever is wrong so the runtime guard keeps matching the
    // shipped binary.
    expect(DEV_BUNDLE_ID).toBe(easJson.build.dev.env.IOS_BUNDLE_ID);
  });
});
