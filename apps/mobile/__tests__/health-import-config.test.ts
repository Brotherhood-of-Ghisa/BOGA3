/** @jest-environment ./jest.node-environment.js */
import path from 'node:path';
import { spawnSync } from 'node:child_process';

it('generates both Health purpose strings required by App Store validation without background delivery', () => {
  const root = path.resolve(__dirname, '..');
  const generated = spawnSync(process.execPath, [
    path.join(root, 'node_modules/expo/bin/cli'), 'config', '--type', 'introspect', '--json',
  ], { cwd: root, encoding: 'utf8', timeout: 30000, env: {
    ...process.env, EXPO_NO_DOTENV: '1', APP_ENV: 'prod', APP_NAME: 'Boga3',
    IOS_BUNDLE_ID: 'com.phano.boga3', ANDROID_PACKAGE: 'com.phano.boga3',
  } });
  expect({ status: generated.status, error: generated.error?.message, stderr: generated.stderr }).toEqual({
    status: 0, error: undefined, stderr: '',
  });
  const ios = JSON.parse(generated.stdout)._internal.modResults.ios;
  expect(ios.infoPlist).toEqual(expect.objectContaining({
    NSHealthShareUsageDescription: expect.stringMatching(/\S/),
    NSHealthUpdateUsageDescription: expect.stringMatching(/\S/),
  }));
  expect(ios.entitlements['com.apple.developer.healthkit']).toBe(true);
  expect(ios.entitlements['com.apple.developer.healthkit.background-delivery']).toBeUndefined();
});
