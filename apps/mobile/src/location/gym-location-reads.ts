import { getCurrentForegroundPositionLazy } from './foreground-location-lazy';
import type { CurrentForegroundPositionResult } from './foreground-location-service';
import {
  DEFAULT_MAX_POSITION_ACCURACY_M,
  matchNearestGymForPosition,
  type GymLocationCandidate,
} from './gym-location-matcher';

/**
 * The two foreground location reads the gym UI makes: the gym sheet's nearby
 * suggestion and the Gyms screen's `Save current location`. Both take the
 * position reader as a parameter, so tests inject one instead of the native
 * module.
 */
export type ReadForegroundPosition = () => Promise<CurrentForegroundPositionResult>;

// How long the gym sheet waits for a fix before giving up on the suggestion;
// the recorder's start-time detection used the same budget.
export const NEARBY_GYM_TIMEOUT_MS = 1500;

const resolveWithTimeout = async <T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise.catch(() => fallback),
      new Promise<T>((resolve) => {
        timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

/**
 * The one gym that confidently matches the current position, or null. Null
 * covers every quiet case: permission denied, services off, a read failure, low
 * accuracy, no gym in range, a tie, and no fix within `timeoutMs`.
 */
export const findNearbyGym = async <T extends GymLocationCandidate>(
  gyms: T[],
  {
    readPosition = getCurrentForegroundPositionLazy,
    timeoutMs = NEARBY_GYM_TIMEOUT_MS,
  }: { readPosition?: ReadForegroundPosition; timeoutMs?: number } = {}
): Promise<T | null> => {
  const lookup = async (): Promise<T | null> => {
    const result = await readPosition();
    if (result.status !== 'success') {
      return null;
    }

    const match = matchNearestGymForPosition(
      {
        latitude: result.position.latitude,
        longitude: result.position.longitude,
        accuracyM: result.position.accuracyM,
      },
      gyms
    );
    if (match.status !== 'matched') {
      return null;
    }

    return gyms.find((gym) => gym.id === match.match.gym.id) ?? null;
  };

  return resolveWithTimeout(lookup(), timeoutMs, null);
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
