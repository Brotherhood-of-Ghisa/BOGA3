/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';

import appConfig from '../app.config';
import { encryptProjection } from '../../../supabase/functions/notification-worker/provider';

const plugin = require('../plugins/with-boga-notifications');
const root = path.resolve(__dirname, '..');

it('registers the real application, notification APIs and local bridge through the installed autolinker', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boga-notification-autolinking-'));
  const target = path.join(temporary, 'ExpoModulesProvider.swift');
  try {
    const generated = spawnSync(process.execPath, [
      path.join(root, 'node_modules/expo-modules-autolinking/bin/expo-modules-autolinking.js'),
      'generate-modules-provider', '--platform', 'apple', '--project-root', root, '--app-root', root,
      '--target', target, '--packages', 'expo-application', 'expo-notifications', 'boga-notifications',
    ], { cwd: root, encoding: 'utf8', timeout: 30000 });
    expect({ status: generated.status, error: generated.error?.message, stderr: generated.stderr }).toEqual({
      status: 0, error: undefined, stderr: '',
    });
    const provider = fs.readFileSync(target, 'utf8');
    for (const name of ['BogaNotifications', 'ExpoApplication', 'ExpoNotifications']) {
      expect(provider).toContain(`internal import ${name}`);
    }
    for (const name of ['BogaNotificationsModule', 'ApplicationModule', 'BackgroundModule', 'BadgeModule',
      'CategoriesModule', 'EmitterModule', 'HandlerModule', 'PermissionsModule', 'PresentationModule',
      'PushTokenModule', 'SchedulerModule', 'ServerRegistrationModule']) {
      expect(provider).toContain(`(module: ${name}.self, name: nil)`);
    }
    expect(provider).toContain('NotificationsAppDelegateSubscriber.self');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

it('keeps preview, production and unsupported build identities separated', () => {
  expect(plugin.notificationConfig('com.phano.boga3.dev')).toEqual({ environment: 'preview',
    appGroup: 'group.com.phano.boga3.dev.notifications', keychainGroup: '$(AppIdentifierPrefix)com.phano.boga3.dev.notifications' });
  expect(plugin.notificationConfig('com.phano.boga3').environment).toBe('production');
  expect(plugin.notificationConfig('com.anonymous.boga3').environment).toBe('unsupported');
});

it('declares both extensions for EAS signing and retains existing metadata', () => {
  const config = plugin({ ios: { bundleIdentifier: 'com.phano.boga3.dev' }, extra: { eas: { projectId: 'project' } } });
  expect(config.extra.eas.projectId).toBe('project');
  const extensions = config.extra.eas.build.experimental.ios.appExtensions;
  expect(extensions).toHaveLength(2);
  expect(extensions.map((target: { targetName: string; bundleIdentifier: string }) => [target.targetName, target.bundleIdentifier])).toEqual([
    ['BogaNotificationService', 'com.phano.boga3.dev.notification-service'],
    ['BogaNotificationContent', 'com.phano.boga3.dev.notification-content'],
  ]);
  expect(extensions[0].entitlements).toEqual(extensions[1].entitlements);
  expect(extensions[0].entitlements['keychain-access-groups']).toEqual(['$(AppIdentifierPrefix)com.phano.boga3.dev.notifications']);
});

it('embeds the app fonts in expanded content and keeps the provider category', () => {
  const config = appConfig({ config: {} as never });
  const entry = config.plugins.find((value: unknown) => Array.isArray(value) && value[0] === './plugins/with-boga-notifications') as [string, { fonts: string[] }];
  const fonts = entry[1].fonts;
  const fontEntry = config.plugins.find((value: unknown) => Array.isArray(value) && value[0] === 'expo-font') as [string, { ios: { fonts: string[] } }];
  expect(fonts).toEqual(fontEntry[1].ios.fonts);
  const target = { name: 'BogaNotificationContent', point: 'com.apple.usernotifications.content-extension' };
  const info = plugin.extensionInfo(target, plugin.notificationConfig('com.phano.boga3.dev'), config, fonts);
  expect(info.NSExtension.NSExtensionAttributes).toEqual({ UNNotificationExtensionCategory: 'boga-workout',
    UNNotificationExtensionInitialContentSizeRatio: 0.5, UNNotificationExtensionDefaultContentHidden: true });
  expect(info.UIAppFonts).toEqual(fonts.map(value => path.basename(value)));
  expect(info.CFBundleShortVersionString).toBe(config.version);
});

it('links UserNotificationsUI into expanded content, which otherwise crashes at launch', () => {
  const config = { version: '2.1.0', ios: { bundleIdentifier: 'com.phano.boga3.dev', buildNumber: '42' } };
  const flags = Object.fromEntries(plugin.TARGETS.map((target: { name: string }) =>
    [target.name, plugin.targetBuildSettings(target, config).OTHER_LDFLAGS]));
  expect(flags).toEqual({
    BogaNotificationService: '"$(inherited) -framework UserNotifications"',
    BogaNotificationContent: '"$(inherited) -framework UserNotifications -framework UserNotificationsUI"',
  });
});

it('generates real extension plists, sources and fonts through the production config mod', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boga-notification-plugin-'));
  const fonts = ['./node_modules/@expo-google-fonts/archivo/600SemiBold/Archivo_600SemiBold.ttf'];
  const config = plugin({ version: '2.1.0', ios: { bundleIdentifier: 'com.phano.boga3.dev', buildNumber: '42' } }, { fonts });
  try {
    await config.mods.ios.dangerous({ ...config, modResults: {}, modRequest: {
      projectRoot: root, platformProjectRoot: temporary, platform: 'ios', modName: 'dangerous',
    } });
    const plist = require('@expo/plist').default;
    for (const name of ['BogaNotificationService', 'BogaNotificationContent']) {
      const info = plist.parse(fs.readFileSync(path.join(temporary, name, `${name}-Info.plist`), 'utf8'));
      expect(info.CFBundleVersion).toBe('42');
      expect(info.BogaNotificationEnvironment).toBe('preview');
      expect(fs.existsSync(path.join(temporary, name, `${name}.swift`))).toBe(true);
      expect(fs.readFileSync(path.join(temporary, name, 'BogaNotificationShared.swift'), 'utf8')).toBe(
        fs.readFileSync(path.join(root, 'modules/boga-notifications/ios/BogaNotificationShared.swift'), 'utf8'));
      const entitlements = plist.parse(fs.readFileSync(path.join(temporary, name, `${name}.entitlements`), 'utf8'));
      expect(entitlements['com.apple.security.application-groups']).toEqual(['group.com.phano.boga3.dev.notifications']);
    }
    expect(fs.readFileSync(path.join(temporary, 'BogaNotificationContent', path.basename(fonts[0])))).toEqual(
      fs.readFileSync(path.join(root, fonts[0])));
    const main = await config.mods.ios.entitlements({ ...config, modResults: { 'keychain-access-groups': ['existing-group'] },
      modRequest: { projectRoot: root, platformProjectRoot: temporary, platform: 'ios', modName: 'entitlements' } });
    expect(main.modResults['keychain-access-groups']).toEqual([
      '$(AppIdentifierPrefix)com.phano.boga3.dev', 'existing-group', '$(AppIdentifierPrefix)com.phano.boga3.dev.notifications',
    ]);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

// CryptoKit is a platform API; Linux CI checks config while macOS runs the actual Swift decoder.
(process.platform === 'darwin' ? describe : describe.skip)('native encrypted projection contract', () => {
  let temporary: string;
  let binary: string;
  beforeAll(() => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boga-native-notifications-'));
    binary = path.join(temporary, 'check');
    const compiled = spawnSync('xcrun', ['swiftc', '-module-cache-path', path.join(temporary, 'cache'),
      path.join(root, 'modules/boga-notifications/ios/BogaNotificationShared.swift'),
      path.join(root, 'modules/boga-notifications/tests/main.swift'), '-o', binary], { encoding: 'utf8', timeout: 90000 });
    expect({ status: compiled.status, error: compiled.error?.message, stderr: compiled.stderr }).toEqual({ status: 0, error: undefined, stderr: '' });
  }, 100000);
  afterAll(() => { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); });

  it('keeps local native modules, plugins and assets in the production build workspace', () => {
    const source = path.join(temporary, 'app');
    const workspace = path.join(temporary, 'workspace-copy');
    for (const [name, contents] of Object.entries({
      'modules/boga-notifications/ios/Bridge.swift': 'native bridge',
      'plugins/with-boga-notifications.js': 'plugin',
      'assets/fonts/face.ttf': 'font',
      'ios/Generated.swift': 'generated project',
      'android/Generated.java': 'generated project',
      'node_modules/font.ttf': 'dependency font',
    })) {
      const file = path.join(source, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contents);
    }
    const script = fs.readFileSync(path.join(root, 'scripts/maestro-ios-dev-client-build.sh'), 'utf8');
    const prepare = script.match(/prepare_workspace\(\) \{[\s\S]*?\n\}/)?.[0];
    expect(prepare).toBeDefined();
    const result = spawnSync('bash', ['-c', `${prepare}\nprepare_workspace`], { encoding: 'utf8', env: {
      ...process.env, APP_DIR: source, TEMP_ROOT: workspace, WORKSPACE_DIR: path.join(workspace, 'workspace'), APP_PATH: path.join(temporary, 'client.app'),
    } });
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    for (const name of ['modules/boga-notifications/ios/Bridge.swift', 'plugins/with-boga-notifications.js', 'assets/fonts/face.ttf', 'node_modules/font.ttf']) {
      expect(fs.existsSync(path.join(workspace, 'workspace', name))).toBe(true);
    }
    expect(fs.existsSync(path.join(workspace, 'workspace/ios'))).toBe(false);
    expect(fs.existsSync(path.join(workspace, 'workspace/android'))).toBe(false);
  });

  it('ad-hoc signs the real simulator build invocation and promotes its app without provisioning', () => {
    const fixture = path.join(temporary, 'simulator-build');
    const source = path.join(fixture, 'app');
    const bin = path.join(fixture, 'bin');
    const buildRoot = path.join(fixture, 'output');
    const scratch = path.join(buildRoot, 'scratch');
    const appPath = path.join(buildRoot, 'client.app');
    const argsFile = path.join(fixture, 'xcodebuild-args');
    fs.mkdirSync(path.join(source, 'node_modules'), { recursive: true });
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ dependencies: { 'expo-dev-client': 'fixture' } }));
    fs.writeFileSync(path.join(source, 'Info.plist'), require('@expo/plist').default.build({ CFBundleIdentifier: 'dev.fixture' }));
    const commands = {
      npx: '#!/bin/bash\nmkdir -p ios/Fixture.xcworkspace\n',
      pod: '#!/bin/bash\nexit 0\n',
      xcodebuild: '#!/bin/bash\nprintf "%s\\n" "$@" > "$ARGS_FILE"\n' +
        'mkdir -p "$DERIVED_DATA_DIR/Build/Products/Debug-iphonesimulator/Fixture.app"\n' +
        'cp "$APP_DIR/Info.plist" "$DERIVED_DATA_DIR/Build/Products/Debug-iphonesimulator/Fixture.app/Info.plist"\n',
    };
    for (const [name, body] of Object.entries(commands)) fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
    const script = fs.readFileSync(path.join(root, 'scripts/maestro-ios-dev-client-build.sh'), 'utf8');
    const functions = ['assert_expo_dev_client_dependency', 'ensure_utf8_locale', 'prepare_workspace', 'build_dev_client']
      .map(name => script.match(new RegExp(`${name}\\(\\) \\{[\\s\\S]*?\\n\\}`))?.[0]);
    expect(functions.every(Boolean)).toBe(true);
    const result = spawnSync('bash', ['-c', [
      'set -euo pipefail',
      'maestro_require_command() { command -v "$1" >/dev/null; }',
      'maestro_fail() { echo "$*" >&2; exit 1; }',
      ...functions, 'build_dev_client',
    ].join('\n')], { encoding: 'utf8', timeout: 10000, env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, APP_DIR: source, BUILD_ROOT: buildRoot,
      APP_PATH: appPath, TEMP_ROOT: scratch, WORKSPACE_DIR: path.join(scratch, 'workspace'),
      DERIVED_DATA_DIR: path.join(scratch, 'derived-data'), ARGS_FILE: argsFile,
      METADATA_FILE: path.join(buildRoot, 'build.env'), BUILD_LOG_FILE: path.join(buildRoot, 'build.log'),
    } });
    expect({ status: result.status, error: result.error?.message, stderr: result.stderr }).toEqual({ status: 0, error: undefined, stderr: '' });
    const args = fs.readFileSync(argsFile, 'utf8').trim().split('\n');
    expect(args).toEqual(expect.arrayContaining(['-sdk', 'iphonesimulator', '-destination',
      'generic/platform=iOS Simulator', 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-', 'build']));
    expect(args.some(arg => /allowProvisioningUpdates|DEVELOPMENT_TEAM|PROVISIONING_PROFILE/.test(arg))).toBe(false);
    expect(require('@expo/plist').default.parse(fs.readFileSync(path.join(appPath, 'Info.plist'), 'utf8')).CFBundleIdentifier).toBe('dev.fixture');
  });

  it('decrypts the real worker encryption format and rejects invalid ownership, targets and expiry', async () => {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    const projection = { v: 1, bindingId: '22222222-2222-4222-8222-222222222222',
      recipientUserId: '11111111-1111-4111-8111-111111111111', expiresAt: 2000, notificationId: '42', kind: 'completion',
      identity: 'Alex · Strength Club', heading: 'Finished a workout at Main Gym', bestCount: 2, rankCount: 3,
      route: { groupId: '66666666-6666-4666-8666-666666666666', memberId: '77777777-7777-4777-8777-777777777777', sessionId: 'shared-session' } };
    const envelope = await encryptProjection(Buffer.alloc(32, 55).toString('base64'), projection.bindingId, projection);
    const fixture = path.join(temporary, 'fixture.json');
    fs.writeFileSync(fixture, JSON.stringify({ envelope, projection }));
    const result = spawnSync(binary, [fixture], { encoding: 'utf8', timeout: 10000 });
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    expect(result.stdout).toBe('Native authenticated notification checks passed: 34\n');
  });
});
