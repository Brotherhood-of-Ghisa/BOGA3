import { checkMeetAddress, meetMapsUrl } from '@/src/groups/meet-location';
import { defaultMeetEnd, emptyMeetDraft, meetDraftFields, meetDraftFrom, meetInstant, updateMeetDraft } from '@/src/groups/meet-draft';
import { canEditMeetChallenge, meetCaption, meetDate, meetMetrics, meetPermissions, meetState, meetWriteMessage } from '@/src/groups/meet-presentation';
import { groupCacheKeys, evictGroup, readGroupCache, writeGroupCache } from '@/src/groups/cache';
import { meetDetailFixture, meetFixture } from './helpers/meet-fixtures';
import { createInMemoryDatabase } from './helpers/in-memory-db';
jest.mock('expo-location', () => ({ geocodeAsync: jest.fn(), reverseGeocodeAsync: jest.fn(), getForegroundPermissionsAsync: jest.fn() }));
const meet = meetFixture();
it('derives lifecycle and permitted fields at exact boundaries independent of cached state', () => {
  const points = [meet.starts_at_ms - 1, meet.starts_at_ms, meet.ends_at_ms, meet.cutoff_at_ms];
  expect(points.map(now => meetState(meet, now))).toEqual(['scheduled', 'live', 'finalizing', 'final']);
  expect(meetState({ ...meet, cancelled_at_ms: 1 })).toBe('cancelled');
  expect(points.map(now => meetPermissions(meet, 'admin', now).fields)).toEqual([true, true, false, false]);
  expect(points.map(now => meetPermissions(meet, 'owner', now).cancel)).toEqual([true, false, false, false]);
  expect(points.map(now => meetPermissions(meet, 'member', now).join)).toEqual([true, true, true, false]);
  expect(meetPermissions(meet, 'member', 1).fields).toBe(false);
  expect(meetPermissions(meet, 'member', meet.cutoff_at_ms).challenges).toBe(true);
  expect(meetPermissions({ ...meet, cancelled_at_ms: 1 }, 'owner').challenges).toBe(false);
  const challenge = meetDetailFixture().challenges[0];
  expect(['owner', 'admin', 'member'].map(role => canEditMeetChallenge(challenge, role as 'owner' | 'admin' | 'member', 'other'))).toEqual([true, true, false]);
  expect(canEditMeetChallenge(challenge, 'member', 'u1')).toBe(true);
});
it('uses group zone, date preference, three-hour end and DST-valid wall times', () => {
  expect(meetDate(Date.parse('2026-10-01T00:00:00Z'), 'America/New_York', 'DD-MM-YYYY')).toContain('30 Sep 26 · 20:00');
  expect(meetCaption(meet, 'DD-MM-YYYY', meet.ends_at_ms)).toContain('Standings so far · final at');
  expect(meetMetrics(true)).toEqual(['seconds']); expect(meetMetrics(false)).toEqual(['e1rm', 'weight', 'reps', 'volume']);
  expect(defaultMeetEnd(0)).toBe(10800000);
  expect(meetInstant('2026-03-29', '01:30', 'Europe/London')).toBeNull();
  expect(meetInstant('2026-02-31', '12:00', 'UTC')).toBeNull();
  expect(meetInstant('2026-10-01', '12:00', 'Europe/London')).toBe(Date.parse('2026-10-01T11:00:00Z'));
  let draft = meetDraftFrom(meet, 'UTC');
  expect(meetDraftFields(draft, 'UTC')).toMatchObject({ starts_at_ms: meet.starts_at_ms, ends_at_ms: meet.ends_at_ms });
  draft = updateMeetDraft(draft, 'start', '23:00', 'UTC', { defaultEnd: true });
  expect(draft.end).toBe('02:00'); expect(draft.endDate).not.toBe(draft.date);
  expect(meetDraftFields({ ...draft, venue: '' }, 'UTC')).toBeNull();
  expect(updateMeetDraft({ ...draft, latitude: 1, longitude: 2 }, 'address', 'New place', 'UTC', { defaultEnd: false })).toMatchObject({ latitude: null, longitude: null });
  expect(emptyMeetDraft('UTC').venue).toBe('');
});
it('explains duplicate/conflict/offline without replacing input', () => {
  expect(meetWriteMessage('DUPLICATE')).toContain('exercise and metric'); expect(meetWriteMessage('CONFLICT')).toContain('input is kept');
  expect(meetWriteMessage('NETWORK', true)).toContain('offline');
});
it('checks addresses without ever requesting permission, preserving text on no match/error/offline', async () => {
  const geocoder = { geocodeAsync: jest.fn().mockResolvedValue([{ latitude: 51, longitude: -1 }]), reverseGeocodeAsync: jest.fn().mockResolvedValue([{ name: 'Gym', city: 'Oxford' }]), getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }) };
  expect(await checkMeetAddress('typed', true, 'ios', geocoder)).toEqual({ address: 'Gym, Oxford', latitude: 51, longitude: -1 });
  expect(geocoder.getForegroundPermissionsAsync).not.toHaveBeenCalled();
  geocoder.geocodeAsync.mockClear(); expect(await checkMeetAddress('typed', true, 'android', geocoder)).toEqual({ address: 'typed', latitude: null, longitude: null });
  expect(geocoder.geocodeAsync).not.toHaveBeenCalled();
  geocoder.getForegroundPermissionsAsync.mockResolvedValue({ granted: true });
  expect((await checkMeetAddress('typed', true, 'android', geocoder)).latitude).toBe(51);
  geocoder.geocodeAsync.mockResolvedValue([]); expect((await checkMeetAddress('typed', true, 'ios', geocoder)).address).toBe('typed');
  geocoder.geocodeAsync.mockRejectedValue(new Error('offline')); expect((await checkMeetAddress('typed', true, 'ios', geocoder)).latitude).toBeNull();
  geocoder.geocodeAsync.mockClear(); await checkMeetAddress('typed', false, 'ios', geocoder); expect(geocoder.geocodeAsync).not.toHaveBeenCalled();
});
it.each(['ios', 'android'] as const)('builds %s Maps destination using coordinates or escaped search', platform => {
  expect(meetMapsUrl({ address: 'Gym & street', latitude: 1, longitude: -2 }, platform)).toContain('1,-2');
  expect(meetMapsUrl({ address: 'Gym & street', latitude: null, longitude: null }, platform)).toContain('Gym%20%26%20street');
});
it('stores versioned meet/list cache with nested scope checks and evicts it on group loss', () => {
  const db = createInMemoryDatabase(); const detail = meetDetailFixture();
  try {
    for (const [cacheKey, payload] of [[groupCacheKeys.meet('g1', 'm1'), detail], [groupCacheKeys.meets('g1'), { upcoming: [detail.meet], past: [], next_cursor: null }]] as const) {
      writeGroupCache(db.database, { cacheKey, userId: 'u1', payload, fetchedAtMs: 1 }); expect(readGroupCache(db.database, cacheKey, 'u1')).not.toBeNull();
      expect(readGroupCache(db.database, cacheKey, 'u2')).toBeNull();
    }
    expect(() => writeGroupCache(db.database, { cacheKey: groupCacheKeys.meet('other', 'm1'), userId: 'u1', payload: detail, fetchedAtMs: 1 })).toThrow();
    evictGroup(db.database, 'g1'); expect(readGroupCache(db.database, groupCacheKeys.meet('g1', 'm1'), 'u1')).toBeNull(); expect(readGroupCache(db.database, groupCacheKeys.meets('g1'), 'u1')).toBeNull();
  } finally { db.close(); }
});

it.each(['DD-MM-YYYY', 'MM-DD-YYYY', 'YYYY-MM-DD'] as const)('round-trips edited dates in %s and speaks full numeric dates', format => {
  const draft = meetDraftFrom(meet, 'Europe/London', format);
  expect(meetDraftFields(draft, 'Europe/London', format)).toMatchObject({ starts_at_ms: meet.starts_at_ms, ends_at_ms: meet.ends_at_ms });
  const moved = updateMeetDraft(draft, 'start', '23:00', 'Europe/London', { defaultEnd: true, format });
  expect(meetDraftFields(moved, 'Europe/London', format)).not.toBeNull();
  expect(meetDate(meet.starts_at_ms, 'Europe/London', format, true)).toMatch(/\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2}/);
});
