import { Storage } from 'expo-sqlite/kv-store';
import { bodyWeightImportStore as store } from '@/src/health-import/bodyweight-storage';

it('keeps the switch, cutoff and progress isolated per account', () => {
  const value = { enabled: true, since: '2026-11-22T12:00:00.123Z', anchor: 'weight-anchor' };
  store.write('a', value);
  expect(store.read('a')).toEqual(value);
  expect(store.read('b')).toEqual({ enabled: false, since: null, anchor: null });
  store.write('a', { ...value, enabled: false, anchor: null });
  expect(store.read('a').since).toBe(value.since);
});

it.each(['bad json', '{"enabled":true,"since":"bad"}', '{"since":1}', '{"enabled":true,"since":null}'])(
  'disables an unreadable stored cutoff instead of importing history (%s)', raw => {
    store.write('bad', { enabled: true, since: '2026-11-22T12:00:00.123Z', anchor: null });
    const key = (Storage.getAllKeysSync() as string[]).find(key => key.startsWith('boga-health-weight:') && key.endsWith(':bad'))!;
    Storage.setItemSync(key, raw);
    expect(store.read('bad')).toEqual({ enabled: false, since: null, anchor: null });
  },
);
