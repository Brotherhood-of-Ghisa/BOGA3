import path from 'path';
import { ExportedConfig, withStaticPlugin } from 'expo/config-plugins';

import appConfig from '../app.config';

const PROJECT_ROOT = path.resolve(__dirname, '..');

function configuredBuild(): ExportedConfig {
  const config = appConfig({ config: { name: 'Boga3', slug: 'boga3' } }) as ExportedConfig;
  const plugin = config.plugins!.find(
    (entry): entry is [string, { ios: { enableSceneSupport: boolean } }] =>
      Array.isArray(entry) && entry[0] === 'expo-build-properties',
  );
  if (!plugin) throw new Error('Missing iOS scene lifecycle plugin');
  return withStaticPlugin(
    { ...config, _internal: { projectRoot: PROJECT_ROOT } },
    { plugin, projectRoot: PROJECT_ROOT },
  );
}

describe('iOS 27 startup uses the Expo scene lifecycle', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.IOS_BUNDLE_ID;
    delete process.env.APP_ENV;
    process.env.ANDROID_PACKAGE = 'com.phano.boga3';
  });

  afterEach(() => { process.env = originalEnv; });

  it.each([undefined, 'com.phano.boga3.dev', 'com.phano.boga3'])(
    'generates a single-window scene manifest for bundle %p',
    async (bundleId) => {
      if (bundleId) process.env.IOS_BUNDLE_ID = bundleId;
      const config = configuredBuild();
      const result = await config.mods!.ios!.infoPlist!({
        ...config,
        modResults: {},
        modRawConfig: config,
        modRequest: {
          projectRoot: PROJECT_ROOT,
          platformProjectRoot: path.join(PROJECT_ROOT, 'ios'),
          platform: 'ios', modName: 'infoPlist', introspect: true,
        },
      });
      expect(result.modResults.UIApplicationSceneManifest).toEqual({
        UIApplicationSupportsMultipleScenes: false,
        UISceneConfigurations: {
          UIWindowSceneSessionRoleApplication: [{
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: 'EXExpoAppSceneDelegate',
          }],
        },
      });
    },
  );

  it('hands React Native startup to the scene delegate instead of creating a second window', async () => {
    const config = configuredBuild();
    // SDK 57's legacy startup fragment: the plugin must migrate both the
    // delegate and the manifest, otherwise launch crashes or renders blank.
    const contents = `class AppDelegate: ExpoAppDelegate {
    reactNativeFactory = factory
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
}`;
    const result = await config.mods!.ios!.appDelegate!({
      ...config,
      modResults: { path: 'AppDelegate.swift', language: 'swift', contents },
      modRawConfig: config,
      modRequest: {
        projectRoot: PROJECT_ROOT,
        platformProjectRoot: path.join(PROJECT_ROOT, 'ios'),
        platform: 'ios', modName: 'appDelegate', introspect: false,
      },
    });
    expect(result.modResults.contents).toContain('ExpoReactNativeFactoryProvider');
    expect(result.modResults.contents).toContain('reactNativeFactory = factory');
    expect(result.modResults.contents).not.toContain('window = UIWindow');
    expect(result.modResults.contents).not.toContain('factory.startReactNative');
  });
});
