/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import appConfig from '../app.config';

const plugin = require('../plugins/with-android-app-icon-state');
const root = path.resolve(__dirname, '..');
const relativeSource = 'android/src/main/java/expo/modules/alternateappicons/ExpoAlternateAppIconsModule.kt';
const installedSource = fs.readFileSync(path.join(root, 'node_modules/expo-alternate-app-icons', relativeSource), 'utf8');

it('patches the installed Android boundary to read and replace enabled launcher components', () => {
  const patched = plugin.patchAndroidIconSource(installedSource);
  expect(patched).toContain('PackageManager.GET_ACTIVITIES or PackageManager.MATCH_DISABLED_COMPONENTS');
  expect(patched).toContain('PackageManager.COMPONENT_ENABLED_STATE_DEFAULT -> activity.enabled');
  expect(patched).toContain('PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true');
  expect(patched).toContain('enabledLauncherComponents(component, manager).firstOrNull()');
  expect(patched).toContain('val enabled = enabledLauncherComponents(component, this)');
  expect(patched).toContain('if (enabled.size == 1 && enabled[0] == target) return@withContext icon');
  expect(patched).toContain('for (previous in enabled)');
  expect(patched.indexOf('setComponentEnabledSetting(target,')).toBeLessThan(patched.indexOf('setComponentEnabledSetting(previous,'));
  expect(patched).not.toContain('val currentIconName = retrieveIconNameFromComponent(currentActivityComponent)');
});

it('is idempotent and fails clearly when upstream or patched native source changes', () => {
  const patched = plugin.patchAndroidIconSource(installedSource);
  expect(plugin.patchAndroidIconSource(patched)).toBe(patched);
  expect(() => plugin.patchAndroidIconSource(`${installedSource}\n// upstream drift`)).toThrow(/Unsupported.*8\.0\.0/);
  expect(() => plugin.patchAndroidIconSource(patched.replace('for (previous in enabled)', 'for (previous in emptyList())')))
    .toThrow(/Unsupported.*8\.0\.0/);
});

it('registers only an Android mod and applies it to the native source before compilation', async () => {
  expect(appConfig({ config: {} as never }).plugins).toContain('./plugins/with-android-app-icon-state');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boga-android-icon-state-'));
  const packageRoot = path.join(temporary, 'node_modules/expo-alternate-app-icons');
  const sourceFile = path.join(packageRoot, relativeSource);
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'expo-alternate-app-icons', version: '8.0.0' }));
  fs.writeFileSync(sourceFile, installedSource);
  const config = plugin({});
  expect(config.mods.ios).toBeUndefined();
  const request = { ...config, modResults: {}, modRequest: {
    projectRoot: temporary, platformProjectRoot: path.join(temporary, 'android'), platform: 'android', modName: 'dangerous',
  } };
  try {
    await config.mods.android.dangerous(request);
    const patched = fs.readFileSync(sourceFile, 'utf8');
    expect(patched).toBe(plugin.patchAndroidIconSource(installedSource));
    await config.mods.android.dangerous(request);
    expect(fs.readFileSync(sourceFile, 'utf8')).toBe(patched);
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ version: '9.0.0' }));
    await expect(config.mods.android.dangerous(request)).rejects.toThrow(/before upgrading.*8\.0\.0/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
