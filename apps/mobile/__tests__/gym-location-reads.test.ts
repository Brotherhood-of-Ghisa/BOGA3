import { findNearbyGym, NEARBY_GYM_TIMEOUT_MS, readGymCoordinates } from '@/src/location/gym-location-reads';

const fixAt = (latitude: number, longitude: number, accuracyM: number | null = 20) =>
  jest.fn().mockResolvedValue({
    status: 'success',
    position: { latitude, longitude, accuracyM, capturedAt: new Date('2026-09-23T10:00:00Z') },
  });

const gym = (id: string, latitude: number | null, longitude: number | null, archived = false) => ({
  id,
  name: id,
  latitude,
  longitude,
  archived,
});

describe('findNearbyGym (the gym sheet suggestion)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the one gym that confidently matches, as the caller passed it', async () => {
    const harbour = { ...gym('harbour', 51.5, -0.12), extra: 'kept' };
    const found = await findNearbyGym([gym('far', 48.85, 2.35), harbour], { readPosition: fixAt(51.5, -0.12) });

    expect(found).toBe(harbour);
  });

  it.each([
    ['a tie', [gym('a', 51.5, -0.12), gym('b', 51.5001, -0.12)], fixAt(51.5, -0.12)],
    ['no gym in range', [gym('far', 48.85, 2.35)], fixAt(51.5, -0.12)],
    ['no gym with a location', [gym('a', null, null)], fixAt(51.5, -0.12)],
    ['an archived gym only', [gym('a', 51.5, -0.12, true)], fixAt(51.5, -0.12)],
    ['low accuracy', [gym('a', 51.5, -0.12)], fixAt(51.5, -0.12, 140)],
    ['permission denial', [gym('a', 51.5, -0.12)], jest.fn().mockResolvedValue({ status: 'permission_denied', canAskAgain: true })],
    ['a rejected read', [gym('a', 51.5, -0.12)], jest.fn().mockRejectedValue(new Error('native'))],
  ])('returns null on %s', async (_case, gyms, readPosition) => {
    await expect(findNearbyGym(gyms, { readPosition })).resolves.toBeNull();
  });

  it('gives up after its budget and clears its timer when the fix wins', async () => {
    jest.useFakeTimers();
    const pending = findNearbyGym([gym('a', 51.5, -0.12)], { readPosition: () => new Promise(() => undefined) });
    jest.advanceTimersByTime(NEARBY_GYM_TIMEOUT_MS);
    await expect(pending).resolves.toBeNull();
    expect(NEARBY_GYM_TIMEOUT_MS).toBe(1500);

    await findNearbyGym([gym('a', 51.5, -0.12)], { readPosition: fixAt(51.5, -0.12) });
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('readGymCoordinates (Save current location)', () => {
  it('returns an accurate fix as the coordinates to save', async () => {
    await expect(readGymCoordinates(fixAt(51.5, -0.12, 30))).resolves.toEqual({
      status: 'success',
      coordinates: { latitude: 51.5, longitude: -0.12, accuracyM: 30, updatedAt: new Date('2026-09-23T10:00:00Z') },
    });
  });

  it.each([
    [{ status: 'permission_denied', canAskAgain: false }, 'Location permission was denied. Nothing changed.'],
    [{ status: 'unavailable', reason: 'services_disabled' }, 'Location services are off. Nothing changed.'],
    [{ status: 'timeout', timeoutMs: 10000 }, "Couldn't read your location. Nothing changed."],
  ])('explains a failed read: %o', async (result, message) => {
    await expect(readGymCoordinates(jest.fn().mockResolvedValue(result))).resolves.toEqual({ status: 'error', message });
  });

  it.each([null, 140, -1, Number.NaN])('refuses a fix with accuracy %p', async (accuracyM) => {
    await expect(readGymCoordinates(fixAt(51.5, -0.12, accuracyM))).resolves.toEqual({
      status: 'error',
      message: 'Location accuracy is too low right now. Nothing changed.',
    });
  });

  it('treats a rejected read as a read failure', async () => {
    await expect(readGymCoordinates(jest.fn().mockRejectedValue(new Error('native')))).resolves.toEqual({
      status: 'error',
      message: "Couldn't read your location. Nothing changed.",
    });
  });
});
