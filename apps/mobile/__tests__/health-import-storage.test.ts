/** The device-local switch and anchor: per account, and unreadable values ignored. */
import { Storage } from 'expo-sqlite/kv-store';

import { healthImportStore } from '@/src/health-import/storage';

const SINCE = new Date('2026-08-12T12:00:00.000Z');

it('keeps the switch per account', () => {
  healthImportStore.writeEnabled('user-a', true);
  expect(healthImportStore.readEnabled('user-a')).toBe(true);
  expect(healthImportStore.readEnabled('user-b')).toBe(false);
  healthImportStore.writeEnabled('user-a', false);
  expect(healthImportStore.readEnabled('user-a')).toBe(false);
});

it('returns the anchor only to the account that saved it, and clears it', () => {
  healthImportStore.writeAnchor('user-a', 'anchor-1', SINCE);
  expect(healthImportStore.readAnchor('user-a')).toEqual({ anchor: 'anchor-1', since: SINCE });
  expect(healthImportStore.readAnchor('user-b')).toBeNull();
  healthImportStore.clearAnchor();
  expect(healthImportStore.readAnchor('user-a')).toBeNull();
});

it.each(['not json', '{"userId":"user-a","anchor":"x"}', '{"userId":"user-a","anchor":"x","since":"soon"}'])(
  'treats a stored anchor it cannot read (%s) as none, so the import backfills',
  (raw) => {
    healthImportStore.writeAnchor('user-a', 'anchor-1', SINCE);
    const [anchorKey] = (Storage.getAllKeysSync() as string[]).filter((entry) => entry.startsWith('boga-health-import-anchor:'));
    Storage.setItemSync(anchorKey, raw);
    expect(healthImportStore.readAnchor('user-a')).toBeNull();
  },
);
