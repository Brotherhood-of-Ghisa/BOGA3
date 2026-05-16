import * as Application from 'expo-application';
import Constants from 'expo-constants';

/**
 * The native bundle id assigned to the EAS `dev` build profile in
 * `apps/mobile/eas.json`. Exported so a test can pin the two together and
 * surface a CI failure if they drift apart.
 */
export const DEV_BUNDLE_ID = 'com.phano.boga3.dev';

/**
 * True when the current build is a developer build.
 *
 * Returns true in any of three cases:
 *   1. `__DEV__ === true` — Metro dev bundle (i.e. `expo start`).
 *   2. `Constants.expoConfig.extra.env === 'dev'` — cross-platform signal
 *      set from `APP_ENV` by the EAS `dev` build profile (works on iOS
 *      and Android because it doesn't depend on the bundle id / package
 *      name).
 *   3. `Application.applicationId === DEV_BUNDLE_ID` — iOS native bundle
 *      id check, kept as a defence-in-depth signal in case `extra.env`
 *      isn't populated for some reason.
 *
 * Use this — never `__DEV__` directly — to gate developer-only UI and
 * unsafe escape hatches. `__DEV__` is `false` in production-bundled
 * builds, including the `com.phano.boga3.dev` TestFlight build that
 * ships internally for developer testing, so a bare `__DEV__` guard
 * silently hides dev tools on the very build that needs them. A
 * `no-restricted-syntax` ESLint rule enforces this convention.
 */
export const isDevMode = (): boolean => {
  if (__DEV__) {
    return true;
  }

  const envFromConfig = Constants.expoConfig?.extra?.env;
  if (envFromConfig === 'dev') {
    return true;
  }

  return Application.applicationId === DEV_BUNDLE_ID;
};
