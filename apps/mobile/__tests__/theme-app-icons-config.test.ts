import fs from 'fs';
import path from 'path';

import appConfig from '../app.config';
import { themePresets } from '@/components/ui/theme-presets';

const config = appConfig({ config: {} as never });
const root = path.resolve(__dirname, '..');

describe('bundled theme app icons', () => {
  it('uses Warm as the primary icon and bundles every alternate on both platforms', () => {
    expect(config.icon).toBe('./assets/images/app-icons/warm.png');
    expect(config.plugins).toContainEqual([
      'expo-alternate-app-icons',
      [...themePresets.filter(({ id }) => id !== 'warm'), { id: 'rainbow', label: 'Rainbow' }].map(({ id, label }) => ({
        name: label,
        ios: `./assets/images/app-icons/${id}.png`,
        android: { foregroundImage: `./assets/images/app-icons/${id}.png` },
      })),
    ]);
  });

  it.each([...themePresets, { id: 'rainbow', label: 'Rainbow' }])('$label has an opaque, square PNG large enough for an iOS icon', ({ id }) => {
    const png = fs.readFileSync(path.join(root, 'assets/images/app-icons', `${id}.png`));
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(1024);
    expect(png.readUInt32BE(16)).toBe(png.readUInt32BE(20));
    expect(png[25]).toBe(2); // RGB, without an alpha channel.
  });
});
