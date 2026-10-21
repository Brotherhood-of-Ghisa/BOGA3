import {
  DEFAULT_MATCH_RADIUS_M,
  DEFAULT_MAX_POSITION_ACCURACY_M,
  DEFAULT_SUGGESTION_MAX_ACCURACY_M,
  DEFAULT_TIE_THRESHOLD_M,
  findNearbyGymsForPosition,
  matchNearestGymForPosition,
} from '@/src/location/gym-location-matcher';

const basePosition = {
  latitude: 51.5007,
  longitude: -0.1246,
  accuracyM: 18,
};

describe('matchNearestGymForPosition', () => {
  it('returns the nearest eligible gym within the default radius', () => {
    const result = matchNearestGymForPosition(basePosition, [
      {
        id: 'gym-farther',
        name: 'Farther Gym',
        latitude: 51.5017,
        longitude: -0.1246,
      },
      {
        id: 'gym-nearest',
        name: 'Nearest Gym',
        latitude: 51.501,
        longitude: -0.1246,
      },
    ]);

    expect(result.status).toBe('matched');
    if (result.status !== 'matched') {
      throw new Error(`expected matched result, received ${result.status}`);
    }
    expect(result.match.gym.id).toBe('gym-nearest');
    expect(result.match.distanceM).toBeLessThan(DEFAULT_MATCH_RADIUS_M);
  });

  it('returns no_match when no valid coordinate-bearing gym is in range', () => {
    const result = matchNearestGymForPosition(basePosition, [
      {
        id: 'too-far',
        name: 'Too Far',
        latitude: 51.503,
        longitude: -0.1246,
      },
    ]);

    expect(result).toEqual({
      status: 'no_match',
      radiusM: DEFAULT_MATCH_RADIUS_M,
    });
  });

  it('rejects low-accuracy or missing-accuracy readings before matching gyms', () => {
    expect(matchNearestGymForPosition({ ...basePosition, accuracyM: DEFAULT_MAX_POSITION_ACCURACY_M + 1 }, [])).toEqual({
      status: 'low_accuracy',
      accuracyM: DEFAULT_MAX_POSITION_ACCURACY_M + 1,
      maxAccuracyM: DEFAULT_MAX_POSITION_ACCURACY_M,
    });

    expect(matchNearestGymForPosition({ ...basePosition, accuracyM: null }, [])).toEqual({
      status: 'low_accuracy',
      accuracyM: null,
      maxAccuracyM: DEFAULT_MAX_POSITION_ACCURACY_M,
    });

    expect(matchNearestGymForPosition({ ...basePosition, accuracyM: -1 }, [])).toEqual({
      status: 'low_accuracy',
      accuracyM: -1,
      maxAccuracyM: DEFAULT_MAX_POSITION_ACCURACY_M,
    });
  });

  it('ignores missing, invalid, archived, and deleted gym coordinates', () => {
    const result = matchNearestGymForPosition(basePosition, [
      {
        id: 'missing-latitude',
        name: 'Missing Latitude',
        latitude: null,
        longitude: -0.1246,
      },
      {
        id: 'invalid-latitude',
        name: 'Invalid Latitude',
        latitude: 91,
        longitude: -0.1246,
      },
      {
        id: 'archived',
        name: 'Archived',
        latitude: 51.5009,
        longitude: -0.1246,
        archived: true,
      },
      {
        id: 'deleted',
        name: 'Deleted',
        latitude: 51.5009,
        longitude: -0.1246,
        deletedAt: new Date('2026-05-23T12:00:00.000Z'),
      },
      {
        id: 'valid',
        name: 'Valid',
        latitude: 51.501,
        longitude: -0.1246,
      },
    ]);

    expect(result.status).toBe('matched');
    if (result.status !== 'matched') {
      throw new Error(`expected matched result, received ${result.status}`);
    }
    expect(result.match.gym.id).toBe('valid');
  });

  it('returns ambiguous when another eligible gym is within the default tie threshold', () => {
    const result = matchNearestGymForPosition(basePosition, [
      {
        id: 'closest',
        name: 'Closest',
        latitude: 51.50095,
        longitude: -0.1246,
      },
      {
        id: 'near-tie',
        name: 'Near Tie',
        latitude: 51.5011,
        longitude: -0.1246,
      },
      {
        id: 'outside-tie',
        name: 'Outside Tie',
        latitude: 51.5017,
        longitude: -0.1246,
      },
    ]);

    expect(result.status).toBe('ambiguous');
    if (result.status !== 'ambiguous') {
      throw new Error(`expected ambiguous result, received ${result.status}`);
    }
    expect(result.tieThresholdM).toBe(DEFAULT_TIE_THRESHOLD_M);
    expect(result.matches.map((match) => match.gym.id)).toEqual(['closest', 'near-tie']);
  });
});

describe("findNearbyGymsForPosition (the gym sheet's suggestion list)", () => {
  const gymAt = (id: string, latitude: number) => ({
    id,
    name: id,
    latitude,
    longitude: -0.1246,
  });

  it('returns the nearest gyms nearest first, at most two, ties included', () => {
    const result = findNearbyGymsForPosition(basePosition, [
      gymAt('third-nearest', 51.502),
      gymAt('nearest', 51.5008),
      gymAt('second-nearest', 51.5009),
      gymAt('no-location', null as unknown as number),
    ]);

    expect(result.map((match) => match.gym.id)).toEqual(['nearest', 'second-nearest']);
  });

  it('trusts a fix the confident matcher refuses and grows the radius with its accuracy', () => {
    const gyms = [gymAt('few-hundred-metres-out', 51.5033)];

    // The same fix is below the confident matcher's accuracy gate.
    expect(matchNearestGymForPosition({ ...basePosition, accuracyM: DEFAULT_SUGGESTION_MAX_ACCURACY_M }, gyms).status).toBe(
      'low_accuracy'
    );

    const result = findNearbyGymsForPosition({ ...basePosition, accuracyM: DEFAULT_SUGGESTION_MAX_ACCURACY_M }, gyms);
    expect(result).toHaveLength(1);
    expect(result[0].gym.id).toBe('few-hundred-metres-out');
    expect(result[0].distanceM).toBeGreaterThan(DEFAULT_MATCH_RADIUS_M);
  });

  it('suggests nothing without a fix, on a fix too coarse to trust, and on no gym in range', () => {
    const gyms = [gymAt('a-gym', 51.501)];

    expect(findNearbyGymsForPosition({ ...basePosition, accuracyM: null }, gyms)).toEqual([]);
    expect(findNearbyGymsForPosition({ ...basePosition, accuracyM: DEFAULT_SUGGESTION_MAX_ACCURACY_M + 1 }, gyms)).toEqual(
      []
    );
    expect(findNearbyGymsForPosition({ ...basePosition, accuracyM: 50 }, [gymAt('far-away', 51.53)])).toEqual([]);
  });
});
