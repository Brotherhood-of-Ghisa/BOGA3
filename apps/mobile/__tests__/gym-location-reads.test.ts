import { findNearbyGymSuggestions, readGymCoordinates } from '@/src/location/gym-location-reads';

const positionAt = (latitude: number, longitude: number, accuracyM: number | null = 20) => ({
  latitude,
  longitude,
  accuracyM,
  capturedAt: new Date('2026-09-23T10:00:00Z'),
});

const gym = (id: string, latitude: number | null, longitude: number | null, archived = false) => ({
  id,
  name: id,
  latitude,
  longitude,
  archived,
});

describe('findNearbyGymSuggestions (the gym sheet suggestion)', () => {
  it('returns the nearest gyms as the caller passed them, nearest first', () => {
    const harbour = { ...gym('harbour', 51.5, -0.12), extra: 'kept' };
    const annex = gym('annex', 51.5001, -0.12);

    const found = findNearbyGymSuggestions(positionAt(51.5, -0.12), [gym('far', 48.85, 2.35), annex, harbour]);

    expect(found).toEqual([harbour, annex]);
    expect(found[0]).toBe(harbour);
  });

  it('suggests nothing without a fix and with a fix too coarse to trust', () => {
    const gyms = [gym('a', 51.5, -0.12)];

    expect(findNearbyGymSuggestions(null, gyms)).toEqual([]);
    expect(findNearbyGymSuggestions(positionAt(51.5, -0.12, 501), gyms)).toEqual([]);
  });

  it('trusts a fix the old 1.5-second read refused', () => {
    const gyms = [gym('a', 51.5, -0.12)];

    expect(findNearbyGymSuggestions(positionAt(51.5, -0.12, 140), gyms)).toEqual([gyms[0]]);
  });

  it.each([
    ['no gym in range', [gym('far', 48.85, 2.35)]],
    ['no gym with a location', [gym('a', null, null)]],
    ['an archived gym only', [gym('a', 51.5, -0.12, true)]],
  ])('suggests nothing on %s', (_case, gyms) => {
    expect(findNearbyGymSuggestions(positionAt(51.5, -0.12), gyms)).toEqual([]);
  });
});

describe('readGymCoordinates (Save current location)', () => {
  const fixAt = (latitude: number, longitude: number, accuracyM: number | null = 20) =>
    jest.fn().mockResolvedValue({ status: 'success', position: positionAt(latitude, longitude, accuracyM) });

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
