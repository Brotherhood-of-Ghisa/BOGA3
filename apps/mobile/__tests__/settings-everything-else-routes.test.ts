import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SETTINGS_SUB_PAGES } from '@/src/navigation/routes';

/**
 * Everything else replaced Other, Experiments and Developer tools: their routes,
 * their stack screens and `SettingsCard` are gone, and nothing imports them.
 */

const MOBILE_ROOT = join(__dirname, '..');

const sourceFiles = (dir: string): string[] =>
  readdirSync(join(MOBILE_ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });

describe('the Everything else route', () => {
  it('is the one Settings sub page that replaces Other, Experiments and Developer tools', () => {
    expect(SETTINGS_SUB_PAGES.everythingElse).toBe('/settings-everything-else');
    expect(Object.values(SETTINGS_SUB_PAGES)).not.toEqual(expect.arrayContaining(['/settings-other']));
    expect(Object.keys(SETTINGS_SUB_PAGES)).not.toEqual(
      expect.arrayContaining(['other', 'experiments', 'developerTools']),
    );
    expect(existsSync(join(MOBILE_ROOT, 'app', 'settings-everything-else.tsx'))).toBe(true);
    ['settings-other', 'settings-experiments', 'settings-developer-tools'].forEach((route) =>
      expect(existsSync(join(MOBILE_ROOT, 'app', `${route}.tsx`))).toBe(false));
  });

  it('is titled in the root stack and the old stack screens are gone', () => {
    const stack = readFileSync(join(MOBILE_ROOT, 'components', 'navigation', 'root-stack.tsx'), 'utf8');
    expect(stack).toContain('name="settings-everything-else" options={{ title: \'Everything else\' }}');
    ['settings-other', 'settings-experiments', 'settings-developer-tools'].forEach((route) =>
      expect(stack).not.toContain(`"${route}"`));
  });

  it('leaves no import of SettingsCard or of the retired sub pages', () => {
    expect(existsSync(join(MOBILE_ROOT, 'components', 'settings', 'settings-card.tsx'))).toBe(false);
    const offenders = ['app', 'components', 'src']
      .flatMap(sourceFiles)
      .filter((file) =>
        /SettingsCard|settings-card|OtherSettingsScreen|ExperimentsSettingsScreen|DeveloperToolsScreen/.test(
          readFileSync(join(MOBILE_ROOT, file), 'utf8'),
        ));
    expect(offenders).toEqual([]);
  });
});

describe('the Appearance and Notifications routes', () => {
  it('are Settings sub pages in the root stack, not sheets', () => {
    expect(SETTINGS_SUB_PAGES.appearance).toBe('/settings-appearance');
    expect(SETTINGS_SUB_PAGES.notifications).toBe('/settings-notifications');
    ['settings-appearance', 'settings-notifications'].forEach((route) =>
      expect(existsSync(join(MOBILE_ROOT, 'app', `${route}.tsx`))).toBe(true));
    const stack = readFileSync(join(MOBILE_ROOT, 'components', 'navigation', 'root-stack.tsx'), 'utf8');
    expect(stack).toContain('name="settings-appearance" options={{ title: \'Appearance\' }}');
    expect(stack).toContain('name="settings-notifications" options={{ title: \'Notifications\' }}');
  });

  it('leave no Sheet or outline/primary button in their components', () => {
    const files = [
      'components/appearance/appearance-settings.tsx',
      'components/appearance/theme-colour-screen.tsx',
      'components/notifications/notification-settings-screen.tsx',
    ].map((file) => readFileSync(join(MOBILE_ROOT, file), 'utf8'));
    files.forEach((source) => expect(source).not.toMatch(/<Sheet\b|variant="(primary|outline)"/));
  });
});
