import { getCurrentForegroundPositionLazy } from './foreground-location-lazy';
import type { CurrentForegroundPositionResult, ForegroundLocationPosition } from './foreground-location-service';
import {
  DEFAULT_MAX_POSITION_ACCURACY_M,
  findNearbyGymsForPosition,
  type GymLocationCandidate,
} from './gym-location-matcher';

/**
 * The two foreground location reads the gym UI makes: the gym sheet's nearby
 * suggestion and the Gyms screen's `Save current location`. Both take the
 * position reader as a parameter, so tests inject one instead of the native
 * module. The sheet's suggestion reads the session's cached position
 * (`src/location/session-position.ts`), not a fresh read.
 */
export type ReadForegroundPosition = () => Promise<CurrentForegroundPositionResult>;

/**
 * The gyms to suggest for the session's cached fix: those within a kilometre,
 * nearest first. `null` position (still acquiring, or the session gave up)
 * and no gym in reach both suggest nothing. Gyms come back as the directory's own objects,
 * so the caller maps them straight onto rows.
 */
export const findNearbyGymSuggestions = <T extends GymLocationCandidate>(
  position: ForegroundLocationPosition | null,
  gyms: T[]
): T[] => {
  if (!position) return [];
  return findNearbyGymsForPosition(position, gyms)
    .map((match) => gyms.find((gym) => gym.id === match.gym.id))
    .filter((gym): gym is T => gym !== undefined);
};

export type GymCoordinates = {
  latitude: number;
  longitude: number;
  accuracyM: number;
  updatedAt: Date;
};

export type GymCoordinatesReadResult =
  | { status: 'success'; coordinates: GymCoordinates }
  | { status: 'error'; message: string };

const failureMessage = (status: CurrentForegroundPositionResult['status']): string => {
  if (status === 'permission_denied') {
    return 'Location permission was denied. Nothing changed.';
  }
  if (status === 'unavailable') {
    return 'Location services are off. Nothing changed.';
  }
  return "Couldn't read your location. Nothing changed.";
};

/**
 * Reads the current position to save as a gym's location. Only a fix at least
 * as accurate as the matcher accepts is returned, so a saved location can
 * always match later.
 */
export const readGymCoordinates = async (
  readPosition: ReadForegroundPosition = getCurrentForegroundPositionLazy
): Promise<GymCoordinatesReadResult> => {
  let result: CurrentForegroundPositionResult;
  try {
    result = await readPosition();
  } catch (error) {
    result = { status: 'read_failure', error };
  }

  if (result.status !== 'success') {
    return { status: 'error', message: failureMessage(result.status) };
  }

  const { position } = result;
  if (
    position.accuracyM === null ||
    !Number.isFinite(position.accuracyM) ||
    position.accuracyM < 0 ||
    position.accuracyM > DEFAULT_MAX_POSITION_ACCURACY_M
  ) {
    return { status: 'error', message: 'Location accuracy is too low right now. Nothing changed.' };
  }

  return {
    status: 'success',
    coordinates: {
      latitude: position.latitude,
      longitude: position.longitude,
      accuracyM: position.accuracyM,
      updatedAt: position.capturedAt,
    },
  };
};
