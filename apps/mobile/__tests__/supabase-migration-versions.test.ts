import { readdirSync } from 'fs';
import { join } from 'path';

it('keeps Supabase migration versions unique so hosted releases can apply each file', () => {
  const versions = readdirSync(join(__dirname, '../../../supabase/migrations'))
    .filter((file) => file.endsWith('.sql'))
    .map((file) => file.split('_')[0]);

  expect(versions.filter((version, index) => versions.indexOf(version) !== index)).toEqual([]);
});
