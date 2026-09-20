import { readFileSync } from 'fs';
import { join } from 'path';

// Why this file exists
// --------------------
// `app.config.ts` pins `userInterfaceStyle: "light"` because the app renders a
// single light theme (components/ui/tokens.ts has no dark variants) and we want
// the OS-owned chrome — Alert.alert, the keyboard, native pickers — to match.
//
// That pin is NOT self-enforcing. expo-splash-screen's iOS Info.plist plugin
// force-assigns `UIUserInterfaceStyle = 'Automatic'` whenever the splash config
// declares ANY `dark` variant, overriding the app-level setting. Its own source
// calls this "fragile because the order of operations matter now". The failure
// is silent at runtime: prebuild emits one warning line, the build succeeds, and
// the shipped binary is in Automatic — so on a dark-mode device the OS chrome
// goes dark over a light app. It cost a build to catch once already.
//
// These assertions run the real Expo plugin functions, so an upstream change to
// the override rule fails here rather than in a plist nobody inspects.

const appConfig = require('../../app.config').default({
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

describe('iOS userInterfaceStyle is pinned to light', () => {
  it('declares light at the app level', () => {
    expect(appConfig.userInterfaceStyle).toBe('light');
  });

  it("resolves to 'Light' through Expo's own userInterfaceStyle plugin", () => {
    const {
      getUserInterfaceStyle,
      setUserInterfaceStyle,
    } = require('@expo/prebuild-config/build/plugins/unversioned/expo-system-ui/withIosUserInterfaceStyle');

    expect(getUserInterfaceStyle(appConfig)).toBe('light');
    expect(setUserInterfaceStyle(appConfig, {})).toMatchObject({
      UIUserInterfaceStyle: 'Light',
    });
  });

  it('does not let the splash plugin override the pin to Automatic', () => {
    // Order-independent: assert the splash plugin declines to write the key at
    // all. If a `dark` variant is ever reintroduced, this returns
    // { UIUserInterfaceStyle: 'Automatic' } and the test fails.
    const {
      setSplashInfoPlist,
    } = require('@expo/prebuild-config/build/plugins/unversioned/expo-splash-screen/withIosSplashInfoPlist');

    const infoPlist = setSplashInfoPlist(appConfig, {}, splashPluginOptions());

    expect(infoPlist).not.toHaveProperty('UIUserInterfaceStyle');
  });

  it('configures no dark splash variant', () => {
    expect(splashPluginOptions()).not.toHaveProperty('dark');
  });

  it("still guards the key Expo's override writes", () => {
    // Mirrors background-sync-task.test.ts: read the plugin source so an
    // upstream rename of the overriding assignment fails loudly here instead of
    // quietly making the test above vacuous.
    const pluginSource = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'node_modules',
        '@expo',
        'prebuild-config',
        'build',
        'plugins',
        'unversioned',
        'expo-splash-screen',
        'withIosSplashInfoPlist.js',
      ),
      'utf8',
    );

    expect(pluginSource).toContain("infoPlist.UIUserInterfaceStyle = 'Automatic'");
  });
});
