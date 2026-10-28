/** @jest-environment node */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'node:child_process';

import appConfig from '../app.config';
import { themePresets } from '@/components/ui/theme-presets';

const config = appConfig({ config: {} as never });
const root = path.resolve(__dirname, '..');
const ordinaryIcons = [...themePresets, { id: 'rainbow', label: 'Rainbow' }];
const seasonalIcons = ordinaryIcons.map(({ id, label }) => ({ id: `${id}-november`, label: `${label}November` }));
const alternateIcons = [...ordinaryIcons.filter(({ id }) => id !== 'warm'), ...seasonalIcons];

describe('bundled theme app icons', () => {
  it('uses Warm as the primary icon and bundles every alternate on both platforms', () => {
    expect(config.icon).toBe('./assets/images/app-icons/warm.png');
    expect(config.plugins).toContainEqual([
      'expo-alternate-app-icons',
      alternateIcons.map(({ id, label }) => ({
        name: label,
        ios: `./assets/images/app-icons/${id}.png`,
        android: { foregroundImage: `./assets/images/app-icons/${id}.png` },
      })),
    ]);
  });

  it.each([...ordinaryIcons, ...seasonalIcons])('$label has an opaque, square PNG large enough for an iOS icon', ({ id }) => {
    const png = fs.readFileSync(path.join(root, 'assets/images/app-icons', `${id}.png`));
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(1024);
    expect(png.readUInt32BE(16)).toBe(png.readUInt32BE(20));
    expect(png[25]).toBe(2); // RGB, without an alpha channel.
  });
});

it.each(['', ...alternateIcons.map(({ label }) => label)])(
  'preserves boga3 deep links with MainActivity%s selected, including restoration to primary', (suffix) => {
    const activity = [...androidApplication.activity, ...androidApplication['activity-alias']]
      .find((entry) => entry.$['android:name'] === `.MainActivity${suffix}`);
    expect(activity).toBeDefined();
    expect(activity?.$['android:exported']).toBe('true');
    expect(activity?.['intent-filter']).toContainEqual(expect.objectContaining({
      action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
      category: expect.arrayContaining([
        { $: { 'android:name': 'android.intent.category.DEFAULT' } },
        { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
      ]),
      data: expect.arrayContaining([{ $: { 'android:scheme': config.scheme } }]),
    }));
    expect(activity?.['intent-filter']).toContainEqual({
      action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
      category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
    });
    if (suffix) {
      expect(activity?.$['android:targetActivity']).toBe('.MainActivity');
      expect(activity?.$['android:enabled']).toBe('false');
    }
  },
);

type ManifestActivity = { $: Record<string, string>; 'intent-filter': unknown[] };
let androidApplication: { activity: ManifestActivity[]; 'activity-alias': ManifestActivity[] };
beforeAll(() => {
  // Introspection executes the installed Expo plugins without writing native projects.
  const generated = spawnSync(process.execPath, [
    path.join(root, 'node_modules/expo/bin/cli'), 'config', '--type', 'introspect', '--json',
  ], { cwd: root, encoding: 'utf8', timeout: 30000, env: { ...process.env, EXPO_NO_DOTENV: '1' } });
  expect({ status: generated.status, error: generated.error?.message, stderr: generated.stderr }).toEqual({
    status: 0, error: undefined, stderr: '',
  });
  androidApplication = JSON.parse(generated.stdout)._internal.modResults.android.manifest.manifest.application[0];
});
