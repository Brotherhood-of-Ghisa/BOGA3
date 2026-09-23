import { SEEDED_LOCATIONS, type SessionLocation } from '@/components/session-recorder/types';
import { listLocalGyms, type LocalGymLookupRecord } from '@/src/data';

/**
 * The gyms a session can be at: the recorder's seeded gyms merged with the
 * local `gyms` table. Shared by the recorder's gym picker and the session
 * view's, so both offer the same list.
 */
const SEEDED_LOCATION_NAME_BY_ID = new Map(SEEDED_LOCATIONS.map((location) => [location.id, location.name]));

function mapLocalGymToSessionLocation(gym: LocalGymLookupRecord): SessionLocation {
  return {
    id: gym.id,
    name: gym.name,
    archived: false,
    latitude: gym.latitude,
    longitude: gym.longitude,
    coordinateAccuracyM: gym.coordinateAccuracyM,
    coordinatesUpdatedAt: gym.coordinatesUpdatedAt,
  };
}

export function mergeLocalGymsIntoLocations(
  currentLocations: SessionLocation[],
  localGyms: LocalGymLookupRecord[]
): SessionLocation[] {
  let didChange = false;
  const nextLocations = [...currentLocations];

  for (const localGym of localGyms) {
    const existingIndex = nextLocations.findIndex((location) => location.id === localGym.id);

    if (existingIndex === -1) {
      nextLocations.push(mapLocalGymToSessionLocation(localGym));
      didChange = true;
      continue;
    }

    const existing = nextLocations[existingIndex];
    const seededName = SEEDED_LOCATION_NAME_BY_ID.get(existing.id);
    const mergedLocation: SessionLocation = {
      ...existing,
      name: seededName && existing.name === seededName ? localGym.name : existing.name,
      latitude: localGym.latitude,
      longitude: localGym.longitude,
      coordinateAccuracyM: localGym.coordinateAccuracyM,
      coordinatesUpdatedAt: localGym.coordinatesUpdatedAt,
    };

    if (
      mergedLocation.name !== existing.name ||
      mergedLocation.latitude !== existing.latitude ||
      mergedLocation.longitude !== existing.longitude ||
      mergedLocation.coordinateAccuracyM !== existing.coordinateAccuracyM ||
      mergedLocation.coordinatesUpdatedAt !== existing.coordinatesUpdatedAt
    ) {
      nextLocations[existingIndex] = mergedLocation;
      didChange = true;
    }
  }

  return didChange ? nextLocations : currentLocations;
}

export type SessionGymOption = { id: string; name: string };

/** The session view's gym choices, in the recorder picker's order. */
export const listSessionGymOptions = async (): Promise<SessionGymOption[]> => {
  const localGyms = await listLocalGyms();
  return mergeLocalGymsIntoLocations(SEEDED_LOCATIONS, localGyms)
    .filter((location) => !location.archived)
    .map(({ id, name }) => ({ id, name }));
};
