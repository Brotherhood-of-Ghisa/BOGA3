import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

it('keeps Supabase migration versions unique so hosted releases can apply each file', () => {
  const versions = readdirSync(join(__dirname, '../../../supabase/migrations'))
    .filter((file) => file.endsWith('.sql'))
    .map((file) => file.split('_')[0]);

  expect(versions.filter((version, index) => versions.indexOf(version) !== index)).toEqual([]);
});

it('keeps one copy of each migration when a filename timestamp is corrected', () => {
  const directory = join(__dirname, '../../../supabase/migrations');
  const bodies = readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => readFileSync(join(directory, file), 'utf8').replace(/^-- Migration: .*\r?\n/, '').trim());

  expect(new Set(bodies).size).toBe(bodies.length);
});
