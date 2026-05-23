export const DEFAULT_MAX_POSITION_ACCURACY_M = 100;
export const DEFAULT_MATCH_RADIUS_M = 150;
export const DEFAULT_TIE_THRESHOLD_M = 25;

export type GymLocationCandidate = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  archived?: boolean;
  deletedAt?: Date | number | string | null;
};

type CoordinateBearingGymLocationCandidate = GymLocationCandidate & {
  latitude: number;
  longitude: number;
};

export type PositionReading = {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
};

export type GymLocationMatch = {
  gym: GymLocationCandidate;
  distanceM: number;
};

export type GymLocationMatchResult =
  | {
      status: 'matched';
      match: GymLocationMatch;
    }
  | {
      status: 'ambiguous';
      matches: GymLocationMatch[];
      closestDistanceM: number;
      tieThresholdM: number;
    }
  | {
      status: 'no_match';
      radiusM: number;
    }
  | {
      status: 'low_accuracy';
      accuracyM: number | null;
      maxAccuracyM: number;
    };

export type MatchNearestGymOptions = {
  maxPositionAccuracyM?: number;
  matchRadiusM?: number;
  tieThresholdM?: number;
};

const EARTH_RADIUS_M = 6_371_000;

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

const isCoordinateInRange = (value: number | null, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

const hasDeletedMarker = (deletedAt: GymLocationCandidate['deletedAt']) => deletedAt !== null && deletedAt !== undefined;

export const haversineDistanceM = (
  from: Pick<PositionReading, 'latitude' | 'longitude'>,
  to: Pick<PositionReading, 'latitude' | 'longitude'>
) => {
  const fromLatRad = degreesToRadians(from.latitude);
  const toLatRad = degreesToRadians(to.latitude);
  const latDeltaRad = degreesToRadians(to.latitude - from.latitude);
  const lonDeltaRad = degreesToRadians(to.longitude - from.longitude);

  const a =
    Math.sin(latDeltaRad / 2) ** 2 +
    Math.cos(fromLatRad) * Math.cos(toLatRad) * Math.sin(lonDeltaRad / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_M * c;
};

const isEligibleGymCandidate = (gym: GymLocationCandidate): gym is CoordinateBearingGymLocationCandidate =>
  gym.archived !== true &&
  !hasDeletedMarker(gym.deletedAt) &&
  isCoordinateInRange(gym.latitude, -90, 90) &&
  isCoordinateInRange(gym.longitude, -180, 180);

export const matchNearestGymForPosition = (
  position: PositionReading,
  gyms: GymLocationCandidate[],
  options: MatchNearestGymOptions = {}
): GymLocationMatchResult => {
  const maxPositionAccuracyM = options.maxPositionAccuracyM ?? DEFAULT_MAX_POSITION_ACCURACY_M;
  const matchRadiusM = options.matchRadiusM ?? DEFAULT_MATCH_RADIUS_M;
  const tieThresholdM = options.tieThresholdM ?? DEFAULT_TIE_THRESHOLD_M;

  if (
    position.accuracyM === null ||
    !Number.isFinite(position.accuracyM) ||
    position.accuracyM < 0 ||
    position.accuracyM > maxPositionAccuracyM
  ) {
    return {
      status: 'low_accuracy',
      accuracyM: position.accuracyM,
      maxAccuracyM: maxPositionAccuracyM,
    };
  }

  const matches = gyms
    .filter(isEligibleGymCandidate)
    .map((gym) => ({
      gym,
      distanceM: haversineDistanceM(position, {
        latitude: gym.latitude,
        longitude: gym.longitude,
      }),
    }))
    .filter((match) => match.distanceM <= matchRadiusM)
    .sort((left, right) => {
      const distanceDelta = left.distanceM - right.distanceM;
      return distanceDelta === 0 ? left.gym.id.localeCompare(right.gym.id) : distanceDelta;
    });

  if (matches.length === 0) {
    return {
      status: 'no_match',
      radiusM: matchRadiusM,
    };
  }

  const closestDistanceM = matches[0].distanceM;
  const tiedMatches = matches.filter((match) => match.distanceM - closestDistanceM <= tieThresholdM);

  if (tiedMatches.length > 1) {
    return {
      status: 'ambiguous',
      matches: tiedMatches,
      closestDistanceM,
      tieThresholdM,
    };
  }

  return {
    status: 'matched',
    match: matches[0],
  };
};
