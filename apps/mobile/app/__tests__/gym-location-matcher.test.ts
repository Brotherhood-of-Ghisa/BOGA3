import {
  DEFAULT_MATCH_RADIUS_M,
  DEFAULT_MAX_POSITION_ACCURACY_M,
  DEFAULT_TIE_THRESHOLD_M,
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
