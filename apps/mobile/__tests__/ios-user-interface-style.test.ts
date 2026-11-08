// Why this file exists
// --------------------
// `app.config.ts` sets `userInterfaceStyle: "automatic"` so the app can read
// and follow the phone's mode; under a pinned "light" the OS reports light
// whatever the phone is set to, and Light / Dark / System could never resolve
// System to dark. The app then pins its own native UI to the chosen mode at
// runtime, or unpins it for System (`components/ui/theme-native.ts`, tested in
// `theme-native.test.ts` and `ui-theme-context.test.tsx`).
//
// The splash stays white in both modes: it is drawn before JS reads the chosen
// mode, so a `dark` variant would follow the phone rather than the choice.
//
// These assertions run the real Expo plugin function, so an upstream change to
// how the key is written fails here rather than in a plist nobody inspects.

const appConfig = require('../app.config').default({
  config: {},
}) as {
  userInterfaceStyle?: string;
  ios?: { userInterfaceStyle?: string; infoPlist?: Record<string, unknown> };
  plugins: (string | [string, Record<string, unknown>])[];
};

function splashPluginOptions(): Record<string, unknown> {
  const entry = appConfig.plugins.find(
    (plugin): plugin is [string, Record<string, unknown>] =>
      Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
  );
  if (!entry) {
    throw new Error('expo-splash-screen plugin entry not found in app.config.ts');
  }
  return entry[1];
}

describe('the native interface style follows the phone until the app pins it', () => {
  it('declares automatic at the app level, with no iOS override', () => {
    expect(appConfig.userInterfaceStyle).toBe('automatic');
    expect(appConfig.ios?.userInterfaceStyle).toBeUndefined();
  });

  it("resolves to 'Automatic' through Expo's own userInterfaceStyle plugin", () => {
    const {
      getUserInterfaceStyle,
      setUserInterfaceStyle,
    } = require('@expo/prebuild-config/build/plugins/unversioned/expo-system-ui/withIosUserInterfaceStyle');

    expect(getUserInterfaceStyle(appConfig)).toBe('automatic');
    expect(setUserInterfaceStyle(appConfig, {})).toMatchObject({
      UIUserInterfaceStyle: 'Automatic',
    });
  });

  it('keeps the splash white, with no dark variant', () => {
    expect(splashPluginOptions()).not.toHaveProperty('dark');
    expect(splashPluginOptions().backgroundColor).toBe('#ffffff');
  });
});
